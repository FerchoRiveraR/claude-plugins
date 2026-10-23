import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'statusline',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

function stubEngine(on: Parameters<Parameters<typeof test>[1]>[1]) {
  on('command.register', () => ({ value: { command: 'tab' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.identity', () => ({ value: { kind: 'subscription', isVerified: false, email: 'me@example.com' } }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000, percent: 21 }, rateLimits: [], cost: { usd: 1.5 } },
  }))
  on('session.authorize', () => ({ value: null }))
  on('settings.read', () => ({ value: {} }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 60000 }))
  on('process.run', (_, e) => ({
    value: {
      exitCode: 0,
      stdout: e.argv[0] === 'gh'
        ? '{"number":5,"baseRefName":"main","url":"https://github.com/o/r/pull/5"}'
        : e.argv.includes('--porcelain=v2')
          ? '# branch.head main\n# branch.ab +2 -0\n'
          : 'main\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
}

test('the tab picker switches the band', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /Credits/ })).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /^default$/ }))?.props).toMatchObject({ bold: true })
  expect((await ui.find({ type: 'Text', text: /me@example.com/ }))?.props).toMatchObject({ dimColor: true })

  await ui.select({ plugin: 'statusline', key: 'tab', value: 'git' })
  expect(await ui.find({ type: 'Text', text: /fetched/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Credits/ })).toBeUndefined()
  expect(await ui.find({ type: 'Link' })).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /^↑2$/ }))?.props).toMatchObject({ bold: true })
  expect((await ui.find({ type: 'Text', text: /^#5$/ }))?.props).toMatchObject({ bold: true, underline: true })
  expect((await ui.find({ type: 'Text', text: /^PR $/ }))?.props).toMatchObject({ bold: true })
  expect((await ui.find({ type: 'Text', text: /fetched/ }))?.props).toMatchObject({ dimColor: true })
  expect(await ui.find({ type: 'Text', text: /↓/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^#5$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^PR $/ })).toBeTruthy()

  await ui.select({ plugin: 'statusline', key: 'tab', value: 'status' })
  expect(await ui.find({ type: 'Text', text: /Credits/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /fetched/ })).toBeUndefined()
  await ui.unmount()
})

test('/tab cycles and takes a name', async ($, on) => {
  stubEngine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect((await $.command.run({ command: 'tab', args: '' })).text).toBe('Statusline tab: Git')
  expect((await $.command.run({ command: 'tab', args: '' })).text).toBe('Statusline tab: Status')
  expect((await $.command.run({ command: 'tab', args: 'git' })).text).toBe('Statusline tab: Git')
})
