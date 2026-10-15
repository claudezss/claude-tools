// Captured-shape output of each platform's tools, trimmed to what the parsers read.

// Two logical cores.
export const PROC_STAT_1 = 'cpu  100 0 100 800 0 0 0 0 0 0\ncpu0 50 0 50 400 0 0 0 0 0 0\ncpu1 50 0 50 400 0 0 0 0 0 0\nintr 0\n'
export const PROC_STAT_2 = 'cpu  200 0 200 1600 0 0 0 0 0 0\ncpu0 100 0 100 800 0 0 0 0 0 0\ncpu1 100 0 100 800 0 0 0 0 0 0\nintr 0\n'

// 16 GiB of RAM, 12 GiB in use.
export const MEMINFO = `MemTotal:       16777216 kB
MemFree:         2097152 kB
MemAvailable:    4194304 kB
Buffers:          100000 kB
`

export const NVIDIA_SMI = '37, 1024, 8192\n55, 4096, 8192\n'

export const MAC_TOP = `Processes: 600 total, 2 running, 598 sleeping, 3000 threads
2026/10/15 10:00:00
Load Avg: 1.50, 1.60, 1.70
CPU usage: 3.0% user, 2.0% sys, 95.0% idle
SharedLibs: 500M resident, 100M data, 50M linkedit.
PhysMem: 15G used (2G wired, 1G compressor), 1G unused.

Processes: 600 total, 2 running, 598 sleeping, 3000 threads
2026/10/15 10:00:01
Load Avg: 1.50, 1.60, 1.70
CPU usage: 10.50% user, 9.50% sys, 80.0% idle
SharedLibs: 500M resident, 100M data, 50M linkedit.
PhysMem: 15G used (2G wired, 1G compressor), 1G unused.
`

// 16 GiB of 16 KiB pages = 1048576 pages; app + wired + compressed = 524288.
export const MAC_MEM_BYTES = 17179869184
export const MAC_VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               10000.
Pages active:                            300000.
Pages inactive:                          290000.
Pages speculative:                         5000.
Pages throttled:                              0.
Pages wired down:                        150000.
Pages purgeable:                          10000.
"Translation faults":                 123456789.
File-backed pages:                       250000.
Anonymous pages:                         340000.
Pages stored in compressor:              200000.
Pages occupied by compressor:             44288.
`

export const MAC_IOREG_APPLE = `+-o AGXAcceleratorG13X  <class AGXAcceleratorG13X, id 0x100000abc, registered, matched, active, busy 0 (0 ms), retain 50>
    {
      "PerformanceStatistics" = {"In use system memory (driver)"=0,"Alloc system memory"=1234,"Tiler Utilization %"=5,"Renderer Utilization %"=12,"Device Utilization %"=12,"In use system memory"=1717986918}
    }
`

export const MAC_IOREG_AMD = `+-o AMDRadeonX6000_AMDNavi10GraphicsAccelerator  <class AMDRadeonX6000_AMDNavi10GraphicsAccelerator>
    {
      "PerformanceStatistics" = {"vramFreeBytes"=6442450944,"Device Utilization %"=30,"vramUsedBytes"=2147483648}
    }
`

// 16 GiB of RAM, 12 GiB in use.
export const WINDOWS_GENERIC =
  '{"cpu":25,"cores":8,"memTotalKb":16777216,"memFreeKb":4194304,"gpuUtil":40,"gpuMemUsed":2147483648,"gpuMemTotal":8589934592,"gpuCount":1}'
export const WINDOWS_NVIDIA = `{"cpu":25,"cores":8,"memTotalKb":16777216,"memFreeKb":4194304,"nvidiaSmi":${JSON.stringify(NVIDIA_SMI.trim())}}`
export const WINDOWS_NO_GPU = '{"cpu":3,"cores":4,"memTotalKb":8388608,"memFreeKb":6291456}'
