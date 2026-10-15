import { describe, expect, test } from 'claude-code/testing'

import {
  bar,
  countProcStatCpus,
  cpuBetween,
  formatUsage,
  gib,
  parseIoreg,
  parseMacSysctl,
  parseMacTopCpu,
  parseMeminfo,
  parseNvidiaSmi,
  parseProcStat,
  parseVmStat,
  parseWindowsSample,
  paneLayout,
  usageRows,
} from '../hooks/parse'
import { encodePowerShell, windowsScript } from '../hooks/sources'
import * as F from './fixtures/fixtures'

const GIB = 1024 ** 3

describe('linux', () => {
  test('cpu is busy time between two /proc/stat readings', () => {
    const before = parseProcStat(F.PROC_STAT_1)!
    const after = parseProcStat(F.PROC_STAT_2)!
    expect(cpuBetween(before, after)).toBe(20)
  })

  test('cores are the per-cpu lines', () => {
    expect(countProcStatCpus(F.PROC_STAT_1)).toBe(2)
    expect(countProcStatCpus('cpu  1 2 3 4\n')).toBe(undefined)
  })

  test('ram is MemTotal less MemAvailable', () => {
    expect(parseMeminfo(F.MEMINFO)).toEqual({ ram: 75, ramUsed: 12 * GIB, ramTotal: 16 * GIB })
  })

  test('unreadable input gives nothing', () => {
    expect(parseProcStat('')).toBe(undefined)
    expect(parseMeminfo('MemTotal: 1 kB\n')).toEqual({})
  })
})

describe('nvidia-smi', () => {
  test('averages utilization, counts GPUs and pools memory', () => {
    expect(parseNvidiaSmi(F.NVIDIA_SMI)).toEqual({
      gpu: 46,
      gpuCount: 2,
      gpuRam: 31.25,
      gpuRamUsed: 5 * GIB,
      gpuRamTotal: 16 * GIB,
    })
  })

  test('tolerates unsupported fields', () => {
    expect(parseNvidiaSmi('[N/A], 512, 2048\n')).toEqual({
      gpu: undefined,
      gpuCount: 1,
      gpuRam: 25,
      gpuRamUsed: 0.5 * GIB,
      gpuRamTotal: 2 * GIB,
    })
    expect(parseNvidiaSmi('')).toBe(undefined)
    expect(parseNvidiaSmi('[N/A], [N/A], [N/A]\n50, 1024, 4096\n')).toEqual(expect.objectContaining({ gpu: 50, gpuCount: 2 }))
  })
})

describe('macos', () => {
  test('cpu comes from the last top sample', () => {
    expect(parseMacTopCpu(F.MAC_TOP)).toBe(20)
  })

  test('a decimal-comma locale still parses', () => {
    expect(parseMacTopCpu('CPU usage: 10,50% user, 9,50% sys, 80,00% idle')).toBe(20)
  })

  test('sysctl gives memory size and cores', () => {
    expect(parseMacSysctl(`${F.MAC_MEM_BYTES}\n10\n`)).toEqual({ memBytes: F.MAC_MEM_BYTES, cpuCores: 10 })
  })

  test('ram counts app, wired and compressed pages', () => {
    expect(parseVmStat(F.MAC_VM_STAT, F.MAC_MEM_BYTES)).toEqual({ ram: 50, ramUsed: 8 * GIB, ramTotal: 16 * GIB })
  })

  test('apple silicon gpu ram is its share of system memory', () => {
    const gpu = parseIoreg(F.MAC_IOREG_APPLE, F.MAC_MEM_BYTES)!
    expect(gpu.gpu).toBe(12)
    expect(gpu.gpuCount).toBe(1)
    expect(Math.round(gpu.gpuRam!)).toBe(10)
    expect(gpu.gpuRamTotal).toBe(F.MAC_MEM_BYTES)
  })

  test('a discrete gpu reports its own vram', () => {
    expect(parseIoreg(F.MAC_IOREG_AMD, F.MAC_MEM_BYTES)).toEqual({
      gpu: 30,
      gpuCount: 1,
      gpuRam: 25,
      gpuRamUsed: 2 * GIB,
      gpuRamTotal: 8 * GIB,
    })
  })

  test('two accelerators: busiest one, discrete vram only', () => {
    const both = parseIoreg(F.MAC_IOREG_APPLE + F.MAC_IOREG_AMD, F.MAC_MEM_BYTES)!
    expect(both.gpu).toBe(30)
    expect(both.gpuCount).toBe(2)
    expect(both.gpuRamTotal).toBe(8 * GIB)
  })

  test('no accelerator gives nothing', () => {
    expect(parseIoreg('', F.MAC_MEM_BYTES)).toBe(undefined)
  })
})

describe('windows', () => {
  test('generic gpu counters', () => {
    expect(parseWindowsSample(F.WINDOWS_GENERIC)).toEqual({
      cpu: 25,
      cpuCores: 8,
      ram: 75,
      ramUsed: 12 * GIB,
      ramTotal: 16 * GIB,
      gpu: 40,
      gpuCount: 1,
      gpuRam: 25,
      gpuRamUsed: 2 * GIB,
      gpuRamTotal: 8 * GIB,
    })
  })

  test('nvidia-smi output wins when present', () => {
    expect(parseWindowsSample(F.WINDOWS_NVIDIA)).toEqual(
      expect.objectContaining({ cpu: 25, cpuCores: 8, ram: 75, gpu: 46, gpuCount: 2, gpuRam: 31.25 }),
    )
  })

  test('no gpu', () => {
    expect(parseWindowsSample(F.WINDOWS_NO_GPU)).toEqual({
      cpu: 3,
      cpuCores: 4,
      ram: 25,
      ramUsed: 2 * GIB,
      ramTotal: 8 * GIB,
      gpu: undefined,
      gpuCount: undefined,
    })
  })

  test('a non-JSON line is skipped', () => {
    expect(parseWindowsSample('WARNING: something')).toBe(undefined)
  })

  test('the script is sent as UTF-16LE base64', () => {
    expect(encodePowerShell('ab')).toBe(btoa('a\0b\0'))
    expect(windowsScript(5)).toContain('Start-Sleep -Seconds 5')
  })
})

describe('display', () => {
  test('the status line carries the totals', () => {
    expect(formatUsage(parseWindowsSample(F.WINDOWS_GENERIC)!)).toBe(
      'CPU 25% (8 cores) · RAM 75% (12.0/16.0 GB) · GPU 40% (1 GPU) · GPU RAM 25% (2.0/8.0 GB)',
    )
    expect(formatUsage({ cpu: 5, cpuCores: 1, gpu: 10, gpuCount: 2 })).toBe('CPU 5% (1 core) · GPU 10% (2 GPUs)')
  })

  test('leaves out what was not reported', () => {
    expect(formatUsage({ ram: 50 })).toBe('RAM 50%')
    expect(formatUsage({ cpuCores: 4 })).toBe(undefined)
    expect(formatUsage({ ram: 50, gpu: Number.NaN })).toBe('RAM 50%')
  })

  test('rows keep display order and color by level', () => {
    expect(usageRows({ gpuRam: 95, cpu: 10, cpuCores: 4, ram: 75 })).toEqual([
      { label: 'CPU', value: 10, level: 'success', detail: '4 cores' },
      { label: 'RAM', value: 75, level: 'warning' },
      { label: 'GPU RAM', value: 95, level: 'error' },
    ])
  })

  test('sizes in GB', () => {
    expect(gib(16 * GIB)).toBe('16.0')
    expect(gib(0.7 * GIB)).toBe('0.7')
    expect(gib(128 * GIB)).toBe('128')
  })

  test('pane rows fit their width, dropping details before the bar gets too short', () => {
    const rows = usageRows({ cpu: 5, cpuCores: 4, ram: 4, ramUsed: 0.6 * GIB, ramTotal: 15.7 * GIB })
    const fits = (columns: number) => {
      const { barWidth, showDetails } = paneLayout(rows, columns)
      const widest = 8 + barWidth + 5 + (showDetails ? '  0.6/15.7 GB'.length : 0)
      return { showDetails, fits: widest <= columns }
    }
    expect(fits(44)).toEqual({ showDetails: true, fits: true })
    expect(fits(30)).toEqual({ showDetails: false, fits: true })
    expect(paneLayout(rows, 200).barWidth).toBe(30)
  })

  test('bars fill in eighths and keep their width', () => {
    expect(bar(0, 10)).toBe(' '.repeat(10))
    expect(bar(100, 10)).toBe('█'.repeat(10))
    expect(bar(50, 10)).toBe('█████     ')
    expect(bar(55, 10)).toBe('█████▌    ')
    expect(bar(150, 4)).toBe('████')
  })
})
