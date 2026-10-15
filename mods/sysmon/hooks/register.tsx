import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Power, Usage } from '../types'
import { bar, formatUsage, paneLayout, usageRows } from './parse'
import { detectPlatform, startSampler, type Sampler } from './sources'

// Shows CPU, RAM, GPU and GPU RAM usage in the status line (terminals) and,
// on `/sysmon`, in a live pane (every surface, the Claude apps included).

const PANE = 'sysmon'
const USAGE_TEXT = 'Usage: /sysmon (open the pane), /sysmon on, /sysmon off'
const usage = atom({ plugin: 'sysmon', key: 'usage' } as const, {} as Usage)
// Kept in session state, not a module variable, so a reload honours it.
const power = atom({ plugin: 'sysmon', key: 'power' } as const, 'unset' as Power)

// The running monitor. Set before the platform is detected, so a stop that
// lands meanwhile can tell the start it overtook not to go on.
let current: { sampler?: Sampler } | undefined

async function start($: EngineInterface, intervalMs: number) {
  if (current) return
  const mine: { sampler?: Sampler } = {}
  current = mine
  // A reading from before this start (an earlier run, a reload) is not current.
  await update($, usage, () => ({}))
  const platform = await detectPlatform($)
  if (current !== mine) return
  mine.sampler = startSampler($, platform, intervalMs, reading => {
    $.ui.status(formatUsage(reading))
    void update($, usage, () => reading).catch(() => {})
  })
}

async function stop($: EngineInterface) {
  current?.sampler?.stop()
  current = undefined
  $.ui.status(undefined)
  await update($, usage, () => ({}))
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
    // Fires again on every reload: keep what the person chose. Untouched, start
    // where there is a status line to keep (not `claude -p` or an SDK host).
    const wanted = await read($, power)
    if (wanted === 'on' || (wanted === 'unset' && e.isInteractive)) await start($, intervalSeconds * 1000)

    return next(e)
  })

  on('command.run', { command: 'sysmon' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== '' && arg !== 'on' && arg !== 'off') return { text: USAGE_TEXT }

    await update($, power, () => (arg === 'off' ? 'off' : 'on'))
    if (arg === 'off') {
      await stop($)
      return { text: 'System monitor off.' }
    }
    await start($, intervalSeconds * 1000)
    if (arg === 'on') return { text: 'System monitor on.' }

    const opened = await $.ui.open({ id: PANE, title: 'System monitor' })
    if (opened.isPlaced) return { text: 'System monitor pane opened.' }
    // Nothing can draw the pane or the status line here (a client with no
    // surface attached), so the reply carries the reading itself.
    const reading = formatUsage(await read($, usage))
    return {
      text: reading
        ? `${reading}  (no pane or status line in this client; run /sysmon again to refresh)`
        : 'System monitor on; the first reading takes a second or two. Run /sysmon again to see it.',
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const rows = usageRows(await read($, usage))
    const { barWidth, showDetails } = paneLayout(rows, e.props.bodyColumns)

    return (
      <Box flexDirection="column">
        {rows.length === 0 && <Text dimColor>Sampling…</Text>}
        {rows.map(row => (
          <Text key={row.label} mono>
            {row.label.padEnd(8)}
            <Text color={row.level}>{bar(row.value, barWidth)}</Text>
            {` ${String(Math.round(row.value)).padStart(3)}%`}
            {showDetails && row.detail && <Text dimColor>{`  ${row.detail}`}</Text>}
          </Text>
        ))}
        <Text dimColor>{`every ${intervalSeconds}s · /sysmon off to stop`}</Text>
      </Box>
    )
  })
}
