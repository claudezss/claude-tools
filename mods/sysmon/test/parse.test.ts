import { describe, expect, test } from 'claude-code/testing'

import {
  bar,
  cpuBetween,
  formatUsage,
  parseIoreg,
  parseMacTopCpu,
  parseMeminfo,
  parseNvidiaSmi,
  parseProcStat,
  parseVmStat,
  parseWindowsSample,
  usageRows,
} from '../hooks/parse'
import { encodePowerShell, windowsScript } from '../hooks/sources'
import * as F from './fixtures/fixtures'

describe('linux', () => {
  test('cpu is busy time between two /proc/stat readings', () => {
    const before = parseProcStat(F.PROC_STAT_1)!
    const after = parseProcStat(F.PROC_STAT_2)!
    expect(cpuBetween(before, after)).toBe(20)
  })

  test('ram is MemTotal less MemAvailable', () => {
    expect(parseMeminfo(F.MEMINFO)).toBe(75)
  })

  test('unreadable input gives nothing', () => {
    expect(parseProcStat('')).toBe(undefined)
    expect(parseMeminfo('MemTotal: 1 kB\n')).toBe(undefined)
  })
})

describe('nvidia-smi', () => {
  test('averages utilization and pools memory across GPUs', () => {
    expect(parseNvidiaSmi(F.NVIDIA_SMI)).toEqual({ gpu: 46, gpuRam: 31.25 })
  })

  test('tolerates unsupported fields', () => {
    expect(parseNvidiaSmi('[N/A], 512, 2048\n')).toEqual({ gpu: undefined, gpuRam: 25 })
    expect(parseNvidiaSmi('')).toBe(undefined)
  })
})

describe('macos', () => {
  test('cpu comes from the last top sample', () => {
    expect(parseMacTopCpu(F.MAC_TOP)).toBe(20)
  })

  test('ram counts app, wired and compressed pages', () => {
    expect(parseVmStat(F.MAC_VM_STAT, F.MAC_MEM_BYTES)).toBe(50)
  })

  test('apple silicon gpu ram is its share of system memory', () => {
    const gpu = parseIoreg(F.MAC_IOREG_APPLE, F.MAC_MEM_BYTES)!
    expect(gpu.gpu).toBe(12)
    expect(Math.round(gpu.gpuRam!)).toBe(10)
  })

  test('a discrete gpu reports its own vram', () => {
    expect(parseIoreg(F.MAC_IOREG_AMD, F.MAC_MEM_BYTES)).toEqual({ gpu: 30, gpuRam: 25 })
  })

  test('no accelerator gives nothing', () => {
    expect(parseIoreg('', F.MAC_MEM_BYTES)).toBe(undefined)
  })
})

describe('windows', () => {
  test('generic gpu counters', () => {
    expect(parseWindowsSample(F.WINDOWS_GENERIC)).toEqual({ cpu: 25, ram: 75, gpu: 40, gpuRam: 25 })
  })

  test('nvidia-smi output wins when present', () => {
    expect(parseWindowsSample(F.WINDOWS_NVIDIA)).toEqual({ cpu: 25, ram: 75, gpu: 46, gpuRam: 31.25 })
  })

  test('no gpu', () => {
    expect(parseWindowsSample(F.WINDOWS_NO_GPU)).toEqual({ cpu: 3, ram: 25, gpu: undefined, gpuRam: undefined })
  })

  test('a non-JSON line is skipped', () => {
    expect(parseWindowsSample('WARNING: something')).toBe(undefined)
  })

  test('the script is sent as UTF-16LE base64', () => {
    expect(encodePowerShell('ab')).toBe(btoa('a\0b\0'))
    expect(windowsScript(5)).toContain('Start-Sleep -Seconds 5')
  })
})

test('format leaves out what was not reported', () => {
  expect(formatUsage({ cpu: 12.4, ram: 48.6, gpu: 30, gpuRam: 21.2 })).toBe('CPU 12% · RAM 49% · GPU 30% · GPU RAM 21%')
  expect(formatUsage({ ram: 50 })).toBe('RAM 50%')
  expect(formatUsage({})).toBe(undefined)
  expect(formatUsage({ ram: 50, gpu: Number.NaN })).toBe('RAM 50%')
})

test('rows keep display order and color by level', () => {
  expect(usageRows({ gpuRam: 95, cpu: 10, ram: 75 })).toEqual([
    { label: 'CPU', value: 10, level: 'success' },
    { label: 'RAM', value: 75, level: 'warning' },
    { label: 'GPU RAM', value: 95, level: 'error' },
  ])
})

test('bars fill in eighths and keep their width', () => {
  expect(bar(0, 10)).toBe(' '.repeat(10))
  expect(bar(100, 10)).toBe('█'.repeat(10))
  expect(bar(50, 10)).toBe('█████     ')
  expect(bar(55, 10)).toBe('█████▌    ')
  expect(bar(150, 4)).toBe('████')
})
