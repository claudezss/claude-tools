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
  expect(statuses.at(-1)).toBe('RAM 75% (12.0/16.0 GB)')

  await clock.advance(1000)
  expect(statuses.at(-1)).toBe('CPU 20% (2 cores) · RAM 75% (12.0/16.0 GB)')
})

test('linux with an nvidia gpu', async ($, on) => {
  const { clock, statuses } = engine(on)
  on('process.run', (_, e) => (e.argv[0] === 'uname' ? ok('Linux\n') : e.argv[0] === 'nvidia-smi' ? ok(F.NVIDIA_SMI) : missing))
  on('fs.read', (_, e) => linuxFiles(e.path))

  await $.session.start(session)
  await clock.settle()
  expect(statuses.at(-1)).toBe('RAM 75% (12.0/16.0 GB) · GPU 46% (2 GPUs) · GPU RAM 31% (5.0/16.0 GB)')
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
  expect(statuses.at(-1)).toBe('RAM 75% (12.0/16.0 GB) · GPU 64% (1 GPU) · GPU RAM 25% (2.0/8.0 GB)')
})

test('macos', async ($, on) => {
  const { clock, statuses } = engine(on)
  on('process.run', (_, e) => {
    switch (e.argv[0]) {
      case 'uname': return ok('Darwin\n')
      case 'sysctl': return ok(`${F.MAC_MEM_BYTES}\n10\n`)
      case 'top': return ok(F.MAC_TOP)
      case 'vm_stat': return ok(F.MAC_VM_STAT)
      case 'ioreg': return ok(F.MAC_IOREG_APPLE)
      default: return missing
    }
  })

  await $.session.start(session)
  await clock.settle()
  expect(statuses.at(-1)).toBe('CPU 20% (10 cores) · RAM 50% (8.0/16.0 GB) · GPU 12% (1 GPU) · GPU RAM 10% (1.6/16.0 GB)')
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
  expect(statuses).toContain('CPU 25% (8 cores) · RAM 75% (12.0/16.0 GB) · GPU 40% (1 GPU) · GPU RAM 25% (2.0/8.0 GB)')
  expect(statuses.at(-1)).toBe('CPU 25% (8 cores) · RAM 75% (12.0/16.0 GB) · GPU 46% (2 GPUs) · GPU RAM 31% (5.0/16.0 GB)')
})

test('/sysmon opens the pane, /sysmon off stops everything, /sysmon on restarts', async ($, on) => {
  const { clock, statuses } = engine(on)
  const panes: string[] = []
  on('ui.open', (_, e) => {
    panes.push(`open ${e.id}`)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_, e) => {
    panes.push(`close ${e.id}`)
    return { value: undefined }
  })
  on('process.run', (_, e) => (e.argv[0] === 'uname' ? ok('Linux\n') : missing))
  on('fs.read', (_, e) => linuxFiles(e.path))
  const sysmon = (args: string) =>
    $.command.run({ command: 'sysmon', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

  await $.session.start(session)
  await clock.settle()

  expect((await sysmon('')).text).toBe('System monitor pane opened.')
  expect(panes).toEqual(['open sysmon'])

  expect((await sysmon('off')).text).toBe('System monitor off.')
  expect(panes).toEqual(['open sysmon', 'close sysmon'])
  expect(statuses.at(-1)).toBe(undefined)
  await clock.advance(10_000)
  expect(statuses.at(-1)).toBe(undefined)

  expect((await sysmon('on')).text).toBe('System monitor on.')
  await clock.settle()
  expect(statuses.at(-1)).toBe('RAM 75% (12.0/16.0 GB)')
  expect(panes).toHaveLength(2)
})

test('/sysmon replies with the reading where no pane can be drawn', async ($, on) => {
  const { clock } = engine(on)
  on('ui.open', () => ({ value: { isPlaced: false as const, reason: 'no-surface: no surface is attached' } }))
  on('process.run', (_, e) => (e.argv[0] === 'uname' ? ok('Linux\n') : missing))
  on('fs.read', (_, e) => linuxFiles(e.path))
  const sysmon = () =>
    $.command.run({ command: 'sysmon', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

  await $.session.start({ ...session, isInteractive: false })
  expect((await sysmon()).text).toBe('System monitor on; the first reading takes a second or two. Run /sysmon again to see it.')
  await clock.settle()
  expect((await sysmon()).text).toBe('RAM 75% (12.0/16.0 GB)  (no pane or status line in this client; run /sysmon again to refresh)')
})

test('/sysmon off holds across a reload; on restarts without a status-line surface', async ($, on) => {
  const { clock, statuses } = engine(on)
  on('ui.close', () => ({ value: undefined }))
  on('process.run', (_, e) => (e.argv[0] === 'uname' ? ok('Linux\n') : missing))
  on('fs.read', (_, e) => linuxFiles(e.path))
  const sysmon = (args: string) =>
    $.command.run({ command: 'sysmon', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

  await $.session.start(session)
  await clock.settle()
  await sysmon('off')
  const seen = statuses.length
  // A reload fires session.start again; the person's "off" stands.
  await $.session.start(session)
  await clock.advance(10_000)
  expect(statuses.length).toBe(seen)

  await sysmon('on')
  await clock.settle()
  const resumed = statuses.length
  expect(resumed).toBeGreaterThan(seen)
  // An SDK host (not interactive) reloads too: "on" restarts there.
  await sysmon('off')
  await sysmon('on')
  await $.session.start({ ...session, isInteractive: false })
  await clock.advance(5_000)
  expect(statuses.length).toBeGreaterThan(resumed)
})

test('/sysmon after off does not report the old reading', async ($, on) => {
  const { clock } = engine(on)
  on('ui.open', () => ({ value: { isPlaced: false as const, reason: 'no-surface' } }))
  on('ui.close', () => ({ value: undefined }))
  on('process.run', (_, e) => (e.argv[0] === 'uname' ? ok('Linux\n') : missing))
  on('fs.read', (_, e) => linuxFiles(e.path))
  const sysmon = (args: string) =>
    $.command.run({ command: 'sysmon', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

  await $.session.start(session)
  await clock.settle()
  await sysmon('off')
  expect((await sysmon('')).text).toBe('System monitor on; the first reading takes a second or two. Run /sysmon again to see it.')
})

test('a stop during start leaves nothing running', async ($, on) => {
  const { clock, statuses } = engine(on)
  on('ui.close', () => ({ value: undefined }))
  let releaseUname = () => {}
  on('process.run', (_, e) =>
    e.argv[0] === 'uname' ? new Promise(resolve => (releaseUname = () => resolve(ok('Linux\n')))) : missing,
  )
  on('fs.read', (_, e) => linuxFiles(e.path))
  const sysmon = (args: string) =>
    $.command.run({ command: 'sysmon', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

  await $.session.start({ ...session, isInteractive: false })
  const starting = sysmon('on')
  await clock.settle()
  await sysmon('off')
  releaseUname()
  await starting
  await clock.advance(20_000)
  expect(statuses.filter(text => text !== undefined)).toHaveLength(0)
})

test('/sysmon with an unknown argument explains itself', async ($, on) => {
  engine(on)
  await $.session.start({ ...session, isInteractive: false })
  const { text } = await $.command.run({
    command: 'sysmon',
    args: 'foo',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  expect(text).toBe('Usage: /sysmon (open the pane), /sysmon on, /sysmon off')
})

test('a headless run starts nothing', async ($, on) => {
  const { clock, statuses } = engine(on)

  await $.session.start({ ...session, isInteractive: false })
  await clock.advance(10_000)
  expect(statuses).toHaveLength(0)
})
