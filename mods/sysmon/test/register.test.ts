import type { On, ProcessRunResult } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import * as F from './fixtures/fixtures'

// Hooks on a call to `$` answer `{ value }`.
const result = (exitCode: number, stdout: string): { value: ProcessRunResult } => ({
  value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})
const ok = (stdout: string) => result(0, stdout)
const missing = result(127, '')
const session = { cwd: '/work', surface: 'terminal', isInteractive: true } as const

const linuxFiles = (path: string) =>
  path === '/proc/stat' ? { value: F.PROC_STAT_1 } : path === '/proc/meminfo' ? { value: F.MEMINFO } : { deny: `ENOENT: ${path}` }

/** Stands in for the engine's own session start and command registry, and records the status line. */
function engine(on: On, env: Record<string, string> = {}) {
  const statuses: (string | undefined)[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  mock.env(on, env)
  return { clock: mock.clock(on), statuses }
}

test('linux: ram first, cpu once there are two readings', async ($, on) => {
  const { clock, statuses } = engine(on)
  on('process.run', (_, e) => (e.argv[0] === 'uname' ? ok('Linux\n') : missing))
  let reads = 0
  on('fs.read', (_, e) => {
    if (e.path === '/proc/stat') return { value: reads++ === 0 ? F.PROC_STAT_1 : F.PROC_STAT_2 }
    if (e.path === '/proc/meminfo') return { value: F.MEMINFO }
    return { deny: `ENOENT: ${e.path}` }
  })

  await $.session.start(session)
  await clock.settle()
  expect(statuses.at(-1)).toBe('RAM 75%')

  await clock.advance(1000)
  expect(statuses.at(-1)).toBe('CPU 20% · RAM 75%')
})

test('linux with an nvidia gpu', async ($, on) => {
  const { clock, statuses } = engine(on)
  on('process.run', (_, e) => (e.argv[0] === 'uname' ? ok('Linux\n') : e.argv[0] === 'nvidia-smi' ? ok(F.NVIDIA_SMI) : missing))
  on('fs.read', (_, e) => linuxFiles(e.path))

  await $.session.start(session)
  await clock.settle()
  expect(statuses.at(-1)).toBe('RAM 75% · GPU 46% · GPU RAM 31%')
})

test('linux with an amd gpu', async ($, on) => {
  const { clock, statuses } = engine(on)
  on('process.run', (_, e) => (e.argv[0] === 'uname' ? ok('Linux\n') : missing))
  const amd: Record<string, string> = {
    '/sys/class/drm/card1/device/gpu_busy_percent': '64\n',
    '/sys/class/drm/card1/device/mem_info_vram_used': '2147483648\n',
    '/sys/class/drm/card1/device/mem_info_vram_total': '8589934592\n',
  }
  on('fs.read', (_, e) => (amd[e.path] !== undefined ? { value: amd[e.path]! } : linuxFiles(e.path)))

  await $.session.start(session)
  await clock.settle()
  expect(statuses.at(-1)).toBe('RAM 75% · GPU 64% · GPU RAM 25%')
})

test('macos', async ($, on) => {
  const { clock, statuses } = engine(on)
  on('process.run', (_, e) => {
    switch (e.argv[0]) {
      case 'uname': return ok('Darwin\n')
      case 'sysctl': return ok(`${F.MAC_MEM_BYTES}\n`)
      case 'top': return ok(F.MAC_TOP)
      case 'vm_stat': return ok(F.MAC_VM_STAT)
      case 'ioreg': return ok(F.MAC_IOREG_APPLE)
      default: return missing
    }
  })

  await $.session.start(session)
  await clock.settle()
  expect(statuses.at(-1)).toBe('CPU 20% · RAM 50% · GPU 12% · GPU RAM 10%')
})

test('windows streams samples from one powershell', async ($, on) => {
  const { clock, statuses } = engine(on, { OS: 'Windows_NT' })
  const spawned: string[][] = []
  on('process.spawn', async function* (_, e) {
    spawned.push([...e.argv])
    // A line split across two pieces, as a pipe may deliver it.
    yield { stream: 'stdout' as const, text: F.WINDOWS_GENERIC.slice(0, 20) }
    yield { stream: 'stdout' as const, text: `${F.WINDOWS_GENERIC.slice(20)}\r\n${F.WINDOWS_NVIDIA}\r\n` }
    return { value: { code: 0, signal: null } }
  })

  await $.session.start(session)
  await clock.settle()
  expect(spawned).toHaveLength(1)
  expect(spawned[0]!.slice(0, 4)).toEqual(['powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand'])
  expect(statuses).toContain('CPU 25% · RAM 75% · GPU 40% · GPU RAM 25%')
  expect(statuses.at(-1)).toBe('CPU 25% · RAM 75% · GPU 46% · GPU RAM 31%')
})

test('/sysmon turns it off and on', async ($, on) => {
  const { clock, statuses } = engine(on)
  on('process.run', (_, e) => (e.argv[0] === 'uname' ? ok('Linux\n') : missing))
  on('fs.read', (_, e) => linuxFiles(e.path))

  await $.session.start(session)
  await clock.settle()
  const run = () =>
    $.command.run({ command: 'sysmon', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

  expect((await run()).text).toBe('System monitor off.')
  expect(statuses.at(-1)).toBe(undefined)
  await clock.advance(10_000)
  expect(statuses.at(-1)).toBe(undefined)

  expect((await run()).text).toBe('System monitor on.')
  await clock.settle()
  expect(statuses.at(-1)).toBe('RAM 75%')
})

test('a headless run starts nothing', async ($, on) => {
  const { clock, statuses } = engine(on)

  await $.session.start({ ...session, isInteractive: false })
  await clock.advance(10_000)
  expect(statuses).toHaveLength(0)
})
