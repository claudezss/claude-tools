import type { Register } from 'claude-code'

// A starter mod: registers the /__NAME__ slash command.
// API reference: `.claude-plugin/types/claude-code/index.d.ts`, laid by the
// engine the first time it loads this mod from a folder.
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: '__NAME__',
      description: '__DESCRIPTION__',
    })

    return next(e)
  })

  on('command.run', { command: '__NAME__' }, $ => ({
    text: `Hello from ${$.plugin.name}!`,
  }))
}
