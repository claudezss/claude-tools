import type { EngineInterface, Register } from 'claude-code'

import { formatUsage } from './parse'
import { detectPlatform, startSampler, type Sampler } from './sources'

// Shows CPU, RAM, GPU and GPU RAM usage in the status line, refreshed every
// `intervalSeconds`. `/sysmon` turns it off and on for the session.

let sampler: Sampler | undefined

async function start($: EngineInterface, intervalMs: number) {
  const platform = await detectPlatform($)
  sampler?.stop()
  sampler = startSampler($, platform, intervalMs, usage => $.ui.status(formatUsage(usage)))
}

function stop($: EngineInterface) {
  sampler?.stop()
  sampler = undefined
  $.ui.status(undefined)
}

export const register: Register = (on, options) => {
  const intervalMs = Math.max(2, Number(options.intervalSeconds) || 5) * 1000

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sysmon',
      description: 'Turn the CPU/RAM/GPU usage status line on or off',
    })
    // A headless run (claude -p) has no status line to keep up to date.
    if (e.isInteractive) await start($, intervalMs)

    return next(e)
  })

  on('command.run', { command: 'sysmon' }, async $ => {
    if (sampler) {
      stop($)
      return { text: 'System monitor off.' }
    }
    await start($, intervalMs)
    return { text: 'System monitor on.' }
  })
}
