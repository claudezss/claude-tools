// Pure parsers for each platform's tool output. No `$` here, so they can be
// tested directly against captured output.

import type { Usage } from '../types'

export type { Usage }

/** Cumulative CPU time from the first line of Linux's /proc/stat. */
export type CpuTimes = { idle: number; total: number }

const percent = (part: number, whole: number) =>
  whole > 0 && Number.isFinite(part) ? Math.min(100, Math.max(0, (part / whole) * 100)) : undefined

const num = (text: string | undefined) => {
  const value = Number.parseFloat(text ?? '')
  return Number.isFinite(value) ? value : undefined
}

// --- Linux -----------------------------------------------------------------

export function parseProcStat(text: string): CpuTimes | undefined {
  const line = text.split('\n').find(l => l.startsWith('cpu '))
  if (!line) return undefined
  // user nice system idle iowait irq softirq steal (guest is already in user)
  const fields = line.trim().split(/\s+/).slice(1, 9).map(Number)
  if (fields.length < 4 || fields.some(n => !Number.isFinite(n))) return undefined
  const [, , , idle = 0, iowait = 0] = fields
  return { idle: idle + iowait, total: fields.reduce((a, b) => a + b, 0) }
}

export function cpuBetween(before: CpuTimes, after: CpuTimes): number | undefined {
  const total = after.total - before.total
  return total > 0 ? percent(total - (after.idle - before.idle), total) : undefined
}

export function parseMeminfo(text: string): number | undefined {
  const field = (name: string) => num(text.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'))?.[1])
  const total = field('MemTotal')
  const available = field('MemAvailable')
  return total === undefined || available === undefined ? undefined : percent(total - available, total)
}

// --- NVIDIA (every platform) -------------------------------------------------

/** Lines of `nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits`. */
export function parseNvidiaSmi(text: string): Pick<Usage, 'gpu' | 'gpuRam'> | undefined {
  const gpus = text
    .split('\n')
    .map(line => line.split(',').map(cell => num(cell.trim())))
    .filter(cells => cells.length === 3 && cells.some(c => c !== undefined))
  if (gpus.length === 0) return undefined

  const utils = gpus.map(([util]) => util).filter((u): u is number => u !== undefined)
  let used = 0
  let total = 0
  for (const [, u, t] of gpus) {
    if (u !== undefined && t !== undefined) {
      used += u
      total += t
    }
  }
  return {
    gpu: utils.length > 0 ? utils.reduce((a, b) => a + b, 0) / utils.length : undefined,
    gpuRam: percent(used, total),
  }
}

// --- macOS -------------------------------------------------------------------

/** The CPU line of the last sample in `top -l 2 -n 0 -s 1` (the first sample is unreliable). */
export function parseMacTopCpu(text: string): number | undefined {
  const idles = [...text.matchAll(/CPU usage:.*?([\d.]+)% idle/g)]
  const idle = num(idles.at(-1)?.[1])
  return idle === undefined ? undefined : Math.min(100, Math.max(0, 100 - idle))
}

/**
 * Memory used as Activity Monitor counts it (app + wired + compressed), from
 * `vm_stat` and `sysctl -n hw.memsize`.
 */
export function parseVmStat(text: string, memBytes: number): number | undefined {
  const pageSize = num(text.match(/page size of (\d+) bytes/)?.[1])
  const pages = (name: string) => num(text.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'))?.[1])
  const wired = pages('Pages wired down')
  const compressed = pages('Pages occupied by compressor') ?? 0
  const anonymous = pages('Anonymous pages')
  const app = anonymous !== undefined ? anonymous - (pages('Pages purgeable') ?? 0) : pages('Pages active')
  if (pageSize === undefined || wired === undefined || app === undefined) return undefined
  return percent((app + wired + compressed) * pageSize, memBytes)
}

/**
 * GPU use from `ioreg -r -d 1 -w 0 -c IOAccelerator`. Apple silicon shares
 * system memory, so its GPU RAM is the GPU's share of `memBytes`; a discrete
 * GPU reports its own VRAM.
 */
export function parseIoreg(text: string, memBytes: number): Pick<Usage, 'gpu' | 'gpuRam'> | undefined {
  const stat = (name: string) => num(text.match(new RegExp(`"${name}"=(\\d+)`))?.[1])
  const gpu = stat('Device Utilization %') ?? stat('GPU Activity\\(%\\)')
  const vramUsed = stat('vramUsedBytes')
  const vramFree = stat('vramFreeBytes')
  const shared = stat('In use system memory')
  const gpuRam =
    vramUsed !== undefined && vramFree !== undefined
      ? percent(vramUsed, vramUsed + vramFree)
      : shared !== undefined
        ? percent(shared, memBytes)
        : undefined
  return gpu === undefined && gpuRam === undefined ? undefined : { gpu, gpuRam }
}

// --- Windows -----------------------------------------------------------------

/** One JSON line written by the PowerShell sampler in sources.ts. */
export function parseWindowsSample(line: string): Usage | undefined {
  let sample: Record<string, unknown>
  try {
    sample = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof sample !== 'object' || sample === null) return undefined
  const field = (key: string) => (typeof sample[key] === 'number' ? (sample[key] as number) : undefined)

  const memTotal = field('memTotalKb')
  const memFree = field('memFreeKb')
  const usage: Usage = {
    cpu: field('cpu'),
    ram: memTotal !== undefined && memFree !== undefined ? percent(memTotal - memFree, memTotal) : undefined,
  }

  const nvidia = typeof sample.nvidiaSmi === 'string' ? parseNvidiaSmi(sample.nvidiaSmi) : undefined
  if (nvidia) return { ...usage, ...nvidia }

  const gpu = field('gpuUtil')
  const used = field('gpuMemUsed')
  const total = field('gpuMemTotal')
  return {
    ...usage,
    gpu: gpu === undefined ? undefined : Math.min(100, gpu),
    gpuRam: used !== undefined && total !== undefined ? percent(used, total) : undefined,
  }
}

// --- Display -----------------------------------------------------------------

export type Row = { label: string; value: number; level: 'success' | 'warning' | 'error' }

/** The reported values, in display order, with a level for coloring. */
export function usageRows(usage: Usage): Row[] {
  const fields: [string, number | undefined][] = [
    ['CPU', usage.cpu],
    ['RAM', usage.ram],
    ['GPU', usage.gpu],
    ['GPU RAM', usage.gpuRam],
  ]
  return fields.flatMap(([label, value]) =>
    value === undefined || !Number.isFinite(value)
      ? []
      : [{ label, value, level: value >= 90 ? 'error' : value >= 70 ? 'warning' : 'success' } as const],
  )
}

/** The status line: `CPU 12% · RAM 48% · GPU 30% · GPU RAM 21%`. */
export function formatUsage(usage: Usage): string | undefined {
  const parts = usageRows(usage).map(({ label, value }) => `${label} ${Math.round(value)}%`)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/** A bar `width` cells wide, filled in eighths: `█████▍    `. */
export function bar(value: number, width: number): string {
  const eighths = Math.round((Math.min(100, Math.max(0, value)) / 100) * width * 8)
  const partial = eighths % 8 === 0 ? '' : ' ▏▎▍▌▋▊▉'[eighths % 8]!
  return ('█'.repeat(Math.floor(eighths / 8)) + partial).padEnd(width, ' ')
}
