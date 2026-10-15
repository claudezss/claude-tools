// Pure parsers for each platform's tool output. No `$` here, so they can be
// tested directly against captured output.

import type { Usage } from '../types'

export type { Usage }

type Ram = Pick<Usage, 'ram' | 'ramUsed' | 'ramTotal'>
type Gpu = Pick<Usage, 'gpu' | 'gpuCount' | 'gpuRam' | 'gpuRamUsed' | 'gpuRamTotal'>

/** Cumulative CPU time from the first line of Linux's /proc/stat. */
export type CpuTimes = { idle: number; total: number }

const KIB = 1024
const MIB = 1024 * 1024

const percent = (part: number, whole: number) =>
  whole > 0 && Number.isFinite(part) ? Math.min(100, Math.max(0, (part / whole) * 100)) : undefined

const num = (text: string | undefined) => {
  const value = Number.parseFloat(text ?? '')
  return Number.isFinite(value) ? value : undefined
}

export const ramOf = (used: number, total: number): Ram =>
  total > 0 && Number.isFinite(used) ? { ram: percent(used, total), ramUsed: used, ramTotal: total } : {}

export const gpuRamOf = (used: number, total: number): Gpu =>
  total > 0 && Number.isFinite(used) ? { gpuRam: percent(used, total), gpuRamUsed: used, gpuRamTotal: total } : {}

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

/** Logical cores: the per-core `cpuN` lines of /proc/stat. */
export function countProcStatCpus(text: string): number | undefined {
  const count = text.match(/^cpu\d+\s/gm)?.length ?? 0
  return count > 0 ? count : undefined
}

export function cpuBetween(before: CpuTimes, after: CpuTimes): number | undefined {
  const total = after.total - before.total
  return total > 0 ? percent(total - (after.idle - before.idle), total) : undefined
}

export function parseMeminfo(text: string): Ram {
  const field = (name: string) => num(text.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'))?.[1])
  const total = field('MemTotal')
  const available = field('MemAvailable')
  return total === undefined || available === undefined ? {} : ramOf((total - available) * KIB, total * KIB)
}

// --- NVIDIA (every platform) -------------------------------------------------

/** Lines of `nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits`. */
export function parseNvidiaSmi(text: string): Gpu | undefined {
  const gpus = text
    .split('\n')
    .map(line => line.split(',').map(cell => num(cell.trim())))
    .filter(cells => cells.length === 3)
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
    gpuCount: gpus.length,
    ...gpuRamOf(used * MIB, total * MIB),
  }
}

// --- macOS -------------------------------------------------------------------

/** The CPU line of the last sample in `top -l 2 -n 0 -s 1` (the first sample is unreliable). */
export function parseMacTopCpu(text: string): number | undefined {
  const idles = [...text.matchAll(/CPU usage:.*?([\d.,]+)% idle/g)]
  const idle = num(idles.at(-1)?.[1]?.replace(',', '.'))
  return idle === undefined ? undefined : Math.min(100, Math.max(0, 100 - idle))
}

/** `sysctl -n hw.memsize hw.logicalcpu`: one value per line. */
export function parseMacSysctl(text: string): { memBytes?: number; cpuCores?: number } {
  const [memBytes, cpuCores] = text.trim().split('\n').map(line => num(line.trim()))
  return { memBytes, cpuCores }
}

/**
 * Memory used as Activity Monitor counts it (app + wired + compressed), from
 * `vm_stat` and the machine's memory size.
 */
export function parseVmStat(text: string, memBytes: number): Ram {
  const pageSize = num(text.match(/page size of (\d+) bytes/)?.[1])
  const pages = (name: string) => num(text.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'))?.[1])
  const wired = pages('Pages wired down')
  const compressed = pages('Pages occupied by compressor') ?? 0
  const anonymous = pages('Anonymous pages')
  const app = anonymous !== undefined ? anonymous - (pages('Pages purgeable') ?? 0) : pages('Pages active')
  if (pageSize === undefined || wired === undefined || app === undefined) return {}
  return ramOf((app + wired + compressed) * pageSize, memBytes)
}

/**
 * GPU use from `ioreg -r -d 1 -w 0 -c IOAccelerator`, one statistics block per
 * GPU. Discrete GPUs report their own VRAM; Apple silicon shares system
 * memory, so there GPU RAM is the GPU's share of `memBytes`.
 */
export function parseIoreg(text: string, memBytes: number): Gpu | undefined {
  const blocks = [...text.matchAll(/"PerformanceStatistics" = \{([^}]*)\}/g)].map(match => {
    const stat = (name: string) => num(match[1]!.match(new RegExp(`"${name}"=(\\d+)`))?.[1])
    return {
      util: stat('Device Utilization %') ?? stat('GPU Activity\\(%\\)'),
      vramUsed: stat('vramUsedBytes'),
      vramFree: stat('vramFreeBytes'),
      shared: stat('In use system memory'),
    }
  })
  if (blocks.length === 0) return undefined

  const utils = blocks.map(b => b.util).filter((u): u is number => u !== undefined)
  const discrete = blocks.filter(b => b.vramUsed !== undefined && b.vramFree !== undefined)
  const shared = blocks.filter(b => b.shared !== undefined)
  const memory =
    discrete.length > 0
      ? gpuRamOf(
          discrete.reduce((sum, b) => sum + b.vramUsed!, 0),
          discrete.reduce((sum, b) => sum + b.vramUsed! + b.vramFree!, 0),
        )
      : shared.length > 0
        ? gpuRamOf(
            shared.reduce((sum, b) => sum + b.shared!, 0),
            memBytes,
          )
        : {}
  return { gpu: utils.length > 0 ? Math.max(...utils) : undefined, gpuCount: blocks.length, ...memory }
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
    cpuCores: field('cores'),
    ...(memTotal !== undefined && memFree !== undefined ? ramOf((memTotal - memFree) * KIB, memTotal * KIB) : {}),
  }

  const nvidia = typeof sample.nvidiaSmi === 'string' ? parseNvidiaSmi(sample.nvidiaSmi) : undefined
  if (nvidia) return { ...usage, ...nvidia }

  const gpu = field('gpuUtil')
  const used = field('gpuMemUsed')
  const total = field('gpuMemTotal')
  return {
    ...usage,
    gpu: gpu === undefined ? undefined : Math.min(100, gpu),
    gpuCount: field('gpuCount'),
    ...(used !== undefined && total !== undefined ? gpuRamOf(used, total) : {}),
  }
}

// --- Display -----------------------------------------------------------------

export type Row = { label: string; value: number; level: 'success' | 'warning' | 'error'; detail?: string }

/** Bytes as GiB, one decimal under 100: `15.7`, `128`. */
export function gib(bytes: number): string {
  const value = bytes / 1024 ** 3
  return value < 100 ? value.toFixed(1) : value.toFixed(0)
}

const plural = (count: number | undefined, one: string, many: string) =>
  count === undefined ? undefined : `${count} ${count === 1 ? one : many}`
const usedOfTotal = (used: number | undefined, total: number | undefined) =>
  used === undefined || total === undefined ? undefined : `${gib(used)}/${gib(total)} GB`

/** The reported values, in display order, with a level for coloring and the totals behind them. */
export function usageRows(usage: Usage): Row[] {
  const fields: [string, number | undefined, string | undefined][] = [
    ['CPU', usage.cpu, plural(usage.cpuCores, 'core', 'cores')],
    ['RAM', usage.ram, usedOfTotal(usage.ramUsed, usage.ramTotal)],
    ['GPU', usage.gpu, plural(usage.gpuCount, 'GPU', 'GPUs')],
    ['GPU RAM', usage.gpuRam, usedOfTotal(usage.gpuRamUsed, usage.gpuRamTotal)],
  ]
  return fields.flatMap(([label, value, detail]) =>
    value === undefined || !Number.isFinite(value)
      ? []
      : [{ label, value, level: value >= 90 ? 'error' : value >= 70 ? 'warning' : 'success', ...(detail ? { detail } : {}) } as const],
  )
}

/** The status line: `CPU 12% (8 cores) · RAM 48% (7.7/16.0 GB) · GPU 30% (1 GPU) · GPU RAM 21% (5.0/24.0 GB)`. */
export function formatUsage(usage: Usage): string | undefined {
  const parts = usageRows(usage).map(
    ({ label, value, detail }) => `${label} ${Math.round(value)}%${detail ? ` (${detail})` : ''}`,
  )
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/**
 * How a pane row fits `columns`: the label (8), the bar, " 100%" (5), and the
 * details ("  12.0/16.0 GB") only while they leave the bar at least 8 cells.
 */
export function paneLayout(rows: Row[], columns: number): { barWidth: number; showDetails: boolean } {
  const detailWidth = Math.max(0, ...rows.map(row => (row.detail ? row.detail.length + 2 : 0)))
  const room = columns - 13
  const showDetails = room - detailWidth >= 8
  return { barWidth: Math.max(4, Math.min(30, showDetails ? room - detailWidth : room)), showDetails }
}

/** A bar `width` cells wide, filled in eighths: `█████▍    `. */
export function bar(value: number, width: number): string {
  const eighths = Math.round((Math.min(100, Math.max(0, value)) / 100) * width * 8)
  const partial = eighths % 8 === 0 ? '' : ' ▏▎▍▌▋▊▉'[eighths % 8]!
  return ('█'.repeat(Math.floor(eighths / 8)) + partial).padEnd(width, ' ')
}
