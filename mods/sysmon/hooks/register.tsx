import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Usage } from '../types'
import { bar, formatUsage, usageRows } from './parse'
import { detectPlatform, startSampler, type Sampler } from './sources'

// Shows CPU, RAM, GPU and GPU RAM usage in the status line (terminals) and,
// on `/sysmon`, in a live pane (every surface, the Claude apps included).

const PANE = 'sysmon'
const usage = atom({ plugin: 'sysmon', key: 'usage' } as const, {} as Usage)

let sampler: Sampler | undefined

async function start($: EngineInterface, intervalMs: number) {
  if (sampler) return
  const platform = await detectPlatform($)
  sampler = startSampler($, platform, intervalMs, reading => {
    $.ui.status(formatUsage(reading))
    void update($, usage, () => reading)
  })
}

async function stop($: EngineInterface) {
  sampler?.stop()
  sampler = undefined
  $.ui.status(undefined)
  await $.ui.close({ id: PANE })
}

export const register: Register = (on, options) => {
  const intervalSeconds = Math.max(2, Number(options.intervalSeconds) || 5)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sysmon',
      description: 'Show CPU/RAM/GPU usage in a pane; "off" stops the monitor',
      argumentHint: '[on|off]',
    })
    // A headless run (claude -p) has no status line to keep up to date.
    if (e.isInteractive) await start($, intervalSeconds * 1000)

    return next(e)
  })

  on('command.run', { command: 'sysmon' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off') {
      await stop($)
      return { text: 'System monitor off.' }
    }
    await start($, intervalSeconds * 1000)
    if (arg === 'on') return { text: 'System monitor on.' }

    const opened = await $.ui.open({ id: PANE, title: 'System monitor' })
    return { text: opened.isPlaced ? 'System monitor pane opened.' : `System monitor on; the pane waits: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const rows = usageRows(await read($, usage))
    const width = Math.max(8, Math.min(30, e.props.bodyColumns - 16))

    return (
      <Box flexDirection="column">
        {rows.length === 0 && <Text dimColor>Sampling…</Text>}
        {rows.map(row => (
          <Text key={row.label} mono>
            {row.label.padEnd(8)}
            <Text color={row.level}>{bar(row.value, width)}</Text>
            {` ${String(Math.round(row.value)).padStart(3)}%`}
          </Text>
        ))}
        <Text dimColor>{`every ${intervalSeconds}s · /sysmon off to stop`}</Text>
      </Box>
    )
  })
}
