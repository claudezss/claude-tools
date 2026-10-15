// Per-platform samplers: each reads usage every `intervalMs` and hands it to
// `onUsage`. Linux and macOS poll; Windows keeps one PowerShell loop running,
// since starting PowerShell per sample would cost more CPU than it measures.

import type { EngineInterface } from 'claude-code'

import {
  cpuBetween,
  parseIoreg,
  parseMacTopCpu,
  parseMeminfo,
  parseNvidiaSmi,
  parseProcStat,
  parseVmStat,
  parseWindowsSample,
  type CpuTimes,
  type Usage,
} from './parse'

export type Platform = 'linux' | 'macos' | 'windows'
export type Sampler = { stop: () => void }
type OnUsage = (usage: Usage) => void

const NVIDIA_SMI = ['nvidia-smi', '--query-gpu=utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits']
const AMD_CARDS = ['card0', 'card1', 'card2', 'card3']

export async function detectPlatform($: EngineInterface): Promise<Platform> {
  if ((await $.env.get('OS')) === 'Windows_NT') return 'windows'
  const uname = await $.process.run(['uname', '-s']).catch(() => undefined)
  return uname?.stdout.trim() === 'Darwin' ? 'macos' : 'linux'
}

export function startSampler($: EngineInterface, platform: Platform, intervalMs: number, onUsage: OnUsage): Sampler {
  return platform === 'windows' ? streamWindows($, intervalMs, onUsage) : poll(intervalMs, sampleUnix($, platform), onUsage, $)
}

/** Runs `sample` now and every `intervalMs`, skipping a tick while one is still running. */
function poll(intervalMs: number, sample: Promise<() => Promise<Usage>>, onUsage: OnUsage, $: EngineInterface): Sampler {
  let isStopped = false
  let isBusy = false
  const tick = async () => {
    if (isStopped || isBusy) return
    isBusy = true
    try {
      const usage = await (await sample)()
      if (!isStopped) onUsage(usage)
    } finally {
      isBusy = false
    }
  }
  void tick()
  // Linux CPU is a difference between two readings, so take the second soon.
  const first = $.clock.after(1000, () => void tick())
  const timer = $.clock.every(intervalMs, () => void tick())
  return {
    stop: () => {
      isStopped = true
      first.cancel()
      timer.cancel()
    },
  }
}

async function run($: EngineInterface, argv: readonly string[]): Promise<string | undefined> {
  const result = await $.process.run(argv, { timeoutMs: 10_000 }).catch(() => undefined)
  return result?.exitCode === 0 ? result.stdout : undefined
}

async function read($: EngineInterface, path: string): Promise<string | undefined> {
  const text = await $.fs.read(path).catch(() => undefined)
  return typeof text === 'string' ? text : undefined
}

/** Finds the GPU source once, then returns the per-sample reader. */
async function sampleUnix($: EngineInterface, platform: 'linux' | 'macos'): Promise<() => Promise<Usage>> {
  const hasNvidia = (await run($, NVIDIA_SMI)) !== undefined
  const nvidia = async () => parseNvidiaSmi((await run($, NVIDIA_SMI)) ?? '')

  if (platform === 'macos') {
    const memBytes = Number((await run($, ['sysctl', '-n', 'hw.memsize'])) ?? Number.NaN)
    return async () => {
      const [top, vmStat, gpu] = await Promise.all([
        run($, ['top', '-l', '2', '-n', '0', '-s', '1']),
        run($, ['vm_stat']),
        hasNvidia ? nvidia() : run($, ['ioreg', '-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator']).then(text => parseIoreg(text ?? '', memBytes)),
      ])
      return { cpu: parseMacTopCpu(top ?? ''), ram: parseVmStat(vmStat ?? '', memBytes), ...gpu }
    }
  }

  let amdCard: string | undefined
  if (!hasNvidia) {
    for (const card of AMD_CARDS) {
      const busy = await read($, `/sys/class/drm/${card}/device/gpu_busy_percent`)
      if (busy !== undefined && /^\s*\d+\s*$/.test(busy)) {
        amdCard = card
        break
      }
    }
  }
  const amd = async (card: string): Promise<Usage> => {
    const base = `/sys/class/drm/${card}/device`
    const [busy, used, total] = await Promise.all(
      ['gpu_busy_percent', 'mem_info_vram_used', 'mem_info_vram_total'].map(file => read($, `${base}/${file}`)),
    )
    const vramUsed = Number(used)
    const vramTotal = Number(total)
    const gpu = Number(busy)
    return {
      gpu: busy !== undefined && Number.isFinite(gpu) ? gpu : undefined,
      gpuRam: Number.isFinite(vramUsed) && vramTotal > 0 ? (vramUsed / vramTotal) * 100 : undefined,
    }
  }

  let previous: CpuTimes | undefined
  return async () => {
    const [stat, meminfo, gpu] = await Promise.all([
      read($, '/proc/stat'),
      read($, '/proc/meminfo'),
      hasNvidia ? nvidia() : amdCard ? amd(amdCard) : undefined,
    ])
    const times = parseProcStat(stat ?? '')
    const cpu = previous && times ? cpuBetween(previous, times) : undefined
    previous = times ?? previous
    return { cpu, ram: parseMeminfo(meminfo ?? ''), ...gpu }
  }
}

/**
 * The PowerShell loop: one compressed JSON object per line. NVIDIA cards go
 * through nvidia-smi; any other GPU through the GPU performance counters
 * (Task Manager's: the busiest engine, and dedicated memory against the
 * adapter's size in the registry).
 */
export function windowsScript(intervalSeconds: number): string {
  return `
$ErrorActionPreference = 'SilentlyContinue'
$nvidia = [bool](Get-Command nvidia-smi)
$vram = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' |
  ForEach-Object { $_.'HardwareInformation.qwMemorySize' } | Measure-Object -Maximum).Maximum
while ($true) {
  # One statement per value: a query that fails leaves only its own value out.
  $cpu = (Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average
  $os = Get-CimInstance Win32_OperatingSystem
  $s = [ordered]@{ cpu = $cpu; memTotalKb = $os.TotalVisibleMemorySize; memFreeKb = $os.FreePhysicalMemory }
  if ($nvidia) {
    $s.nvidiaSmi = (& ${NVIDIA_SMI.join(' ')}) -join "\`n"
  } else {
    $engines = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine
    if ($engines) {
      $s.gpuUtil = ($engines | Group-Object { $_.Name -replace '^pid_\\d+_', '' } |
        ForEach-Object { ($_.Group | Measure-Object UtilizationPercentage -Sum).Sum } | Measure-Object -Maximum).Maximum
      $s.gpuMemUsed = (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory |
        Measure-Object DedicatedUsage -Maximum).Maximum
      if ($vram) { $s.gpuMemTotal = $vram }
    }
  }
  [Console]::Out.WriteLine(($s | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  Start-Sleep -Seconds ${intervalSeconds}
}
`
}

/** PowerShell's -EncodedCommand: base64 of the script as UTF-16LE, so no quoting survives the command line. */
export function encodePowerShell(script: string): string {
  let bytes = ''
  for (const char of script) {
    const code = char.charCodeAt(0)
    bytes += String.fromCharCode(code & 0xff, code >> 8)
  }
  return btoa(bytes)
}

function streamWindows($: EngineInterface, intervalMs: number, onUsage: OnUsage): Sampler {
  let isStopped = false
  let stream: ReturnType<EngineInterface['process']['spawn']> | undefined
  let retry: { cancel: () => void } | undefined
  const argv = [
    'powershell',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    encodePowerShell(windowsScript(Math.max(1, Math.round(intervalMs / 1000)))),
  ]

  const start = async () => {
    if (isStopped) return
    let buffer = ''
    try {
      stream = $.process.spawn({ argv })
      for await (const { stream: from, text } of stream) {
        if (isStopped) break
        if (from !== 'stdout') continue
        buffer += text
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const usage = parseWindowsSample(line.trim())
          if (usage) onUsage(usage)
        }
      }
    } catch {
      // PowerShell couldn't start or died; retried below.
    }
    if (!isStopped) retry = $.clock.after(30_000, () => void start())
  }
  void start()

  return {
    stop: () => {
      isStopped = true
      retry?.cancel()
      // Ends the loop, which kills PowerShell; the isStopped check covers a pending read.
      void stream?.return?.({ code: null, signal: null })
    },
  }
}
