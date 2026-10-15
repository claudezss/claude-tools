import { expect, test } from 'claude-code/testing'

test('/__NAME__ answers', async $ => {
  const { text } = await $.command.run({
    command: '__NAME__',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })

  expect(text).toBe('Hello from __NAME__!')
})
