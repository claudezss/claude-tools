/** One reading; a field is absent when the platform didn't report it. */
export type Usage = {
  cpu?: number
  ram?: number
  gpu?: number
  gpuRam?: number
}

declare module 'claude-code' {
  interface PluginState {
    sysmon: { usage: Usage }
  }
}
