import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'statusline',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const USAGE = JSON.stringify({ extra_usage: { is_enabled: true, monthly_limit: 50000, used_credits: 46193.0 } })

test('enterprise fills Left from the monthly limit and skips prepaid', async ($, on) => {
  const urls: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.identity', () => ({ value: { kind: 'subscription', isVerified: false, email: 'me@example.com' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 21 }, rateLimits: [], cost: { usd: 1.5 } } }))
  on('session.authorize', () => ({ value: { handle: 'h' } }))
  on('http.fetch', (_, e) => {
    urls.push(e.url)
    return { value: { ok: true, status: 200, text: USAGE } }
  })
  on('settings.read', () => ({ value: {} }))
  on('env.get', () => ({ value: undefined }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1000000 }))
  on('process.run', (_, e) => ({
    value: {
      exitCode: 0,
      stdout: e.argv[0] === 'claude' ? '{"email":"me@example.com","orgId":"org1","subscriptionType":"enterprise"}' : '',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /^Credits 92%$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^Left \$38\.07$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^Used \$461\.93$/ })).toBeTruthy()
  expect(urls.some(u => u.includes('prepaid'))).toBe(false)
  await ui.unmount()
})

test('effort comes from CLAUDE_EFFORT before the first turn, not the stale settings value', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('env.get', (_, e) => ({ value: e.name === 'CLAUDE_EFFORT' ? 'medium' : undefined }))
  on('session.identity', () => ({ value: { kind: 'subscription', isVerified: false, email: 'me@example.com' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 0 }, rateLimits: [], cost: { usd: 0 } } }))
  on('session.authorize', () => ({ value: undefined }))
  on('settings.read', (_, e) => ({ value: e.key === 'modelSettings' ? { 'claude-haiku-5-5': { effortLevel: 'medium' } } : { model: 'haiku', effortLevel: 'xhigh' } }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /^Haiku$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^medium$/ })).toBeTruthy()
  await ui.unmount()
})
