/** One reading; a field is absent when the platform didn't report it. Sizes are bytes. */
export type Usage = {
  /** Percent busy across all logical cores. */
  cpu?: number
  /** Logical cores. */
  cpuCores?: number
  /** Percent of RAM in use. */
  ram?: number
  ramUsed?: number
  ramTotal?: number
  /** Percent busy: the average across GPUs, or the busiest engine. */
  gpu?: number
  gpuCount?: number
  /** Percent of GPU memory in use (on Apple silicon, the GPU's share of system memory). */
  gpuRam?: number
  gpuRamUsed?: number
  gpuRamTotal?: number
}

/** What the person last asked for with /sysmon; `unset` until they do. Survives a reload. */
export type Power = 'on' | 'off' | 'unset'

declare module 'claude-code' {
  interface PluginState {
    sysmon: { usage: Usage; power: Power }
  }
}
