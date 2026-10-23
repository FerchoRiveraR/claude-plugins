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

const OPEN_PR = '[{"number":5,"url":"https://github.com/o/r/pull/5","author":{"login":"octo"},"assignees":[],"mergeStateStatus":"CLEAN","reviewDecision":"REVIEW_REQUIRED","statusCheckRollup":[{"conclusion":"SUCCESS","status":"COMPLETED"}],"isDraft":false}]'

function stubEngine(on: Parameters<Parameters<typeof test>[1]>[1], gh = OPEN_PR) {
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
        ? gh
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
  expect(await ui.find({ type: 'Text', text: /^octo$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^✓ ready to merge$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^✓ checks$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^… review required$/ })).toBeTruthy()
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

test('a draft PR says so, and no open PR draws nothing', async ($, on) => {
  stubEngine(on, OPEN_PR.replace('"isDraft":false', '"isDraft":true'))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const draft = await $.ui.mount(BAND)
  await draft.select({ plugin: 'statusline', key: 'tab', value: 'git' })
  expect(await draft.find({ type: 'Text', text: /^Draft PR $/ })).toBeTruthy()
  expect(await draft.find({ type: 'Text', text: /merge/ })).toBeUndefined()
  await draft.unmount()
})

test('a branch with no open PR draws no PR', async ($, on) => {
  stubEngine(on, '[]')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  await ui.select({ plugin: 'statusline', key: 'tab', value: 'git' })
  expect(await ui.find({ type: 'Text', text: /^#5$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /fetched/ })).toBeTruthy()
  await ui.unmount()
})
