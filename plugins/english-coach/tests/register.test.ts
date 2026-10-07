import { expect, mock, test } from 'claude-code/testing'

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const said = (text: string) => ({ value: { isAnswered: true, text, usage } })
const found = (mistakes: unknown[]) => said(JSON.stringify({ mistakes }))
const PROSE = 'Can you explain me how the units are consumed here please'

function world(on: any, replies: unknown[], env: Record<string, string> = {}, ledger?: unknown) {
  const clock = mock.clock(on)
  mock.env(on, env)
  const w = { clock, prompts: [] as string[], systems: [] as string[], logs: [] as string[], ledger: ledger as any }
  on('store.get', () => ({ value: w.ledger }))
  on('store.set', ($: any, e: any) => {
    w.ledger = e.value
    return { value: undefined }
  })
  on('model.complete', ($: any, e: any) => {
    w.prompts.push(e.prompt)
    w.systems.push(e.system)
    return replies.shift() ?? found([])
  })
  on('ui.log', ($: any, e: any) => {
    if (e.to !== 'debug') w.logs.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', ($: any, e: any) => ({ text: e.text }))
  return w
}
const submit = ($: any, text: string, origin: any = { kind: 'composer' }) => $.prompt.submit({ text, wait: false, origin })

test('a real mistake: prompt passes unchanged, hint drawn after, ledger feeds the next call', async ($, on) => {
  const w = world(on, [
    found([{ wrong: 'explain me', fix: 'explain to me' }]),
    found([{ wrong: 'explain me', fix: 'explain\u001b[2J to me' }]),
  ])
  const r = await submit($, PROSE)
  expect(r).toMatchObject({ text: PROSE })
  expect(r.context).toBeUndefined()
  expect(w.prompts.length).toBe(0)
  await w.clock.settle()
  expect(w.systems[0]).toContain('Spanish')
  expect(w.logs).toEqual(['explain me → explain to me'])
  await submit($, PROSE, { kind: 'bridge' })
  await w.clock.settle()
  expect(w.prompts[1]).toContain('explain me → explain to me')
  expect(w.logs[1]).not.toContain('\u001b')
})

test('clean, prose, failed and refused replies stay silent', async ($, on) => {
  const w = world(on, [
    found([]),
    said('Sure! Units are consumed per CPT code.'),
    { value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage } },
    { deny: 'model blocked by policy' },
  ])
  for (let i = 0; i < 4; i++) {
    await submit($, PROSE)
    await w.clock.settle()
  }
  expect(w.prompts.length).toBe(4)
  expect(w.logs).toEqual([])
  expect(w.ledger).toBeUndefined()
})

test('slash, short, pasted-harness and non-user prompts make no model call', async ($, on) => {
  const w = world(on, [])
  await submit($, '/render foo bar baz qux quux')
  await submit($, 'ok thanks')
  await submit($, `${PROSE} <task-notification>done</task-notification>`)
  for (const origin of [{ kind: 'sdk' }, { kind: 'task-notification' }, { kind: 'unclassified' }, { kind: 'plugin', name: 'other' }])
    await submit($, PROSE, origin)
  await w.clock.settle()
  expect(w.prompts.length).toBe(0)
  await submit($, PROSE)
  await w.clock.settle()
  expect(w.prompts.length).toBe(1)
})

test('gates drop fabricated, smuggled, oversized, empty and link-bearing hints', async ($, on) => {
  const w = world(on, [
    found([{ wrong: 'totally fabricated fragment', fix: 'x' }]),
    found([{ wrong: 'explain\nfabricated claim', fix: 'x' }]),
    found([{ wrong: 'units', fix: 'y'.repeat(121) }]),
    found([{ wrong: '  ', fix: 'x' }]),
    found([{ wrong: 'explain me', fix: 'see https://evil.example' }]),
  ])
  for (let i = 0; i < 5; i++) {
    await submit($, PROSE)
    await w.clock.settle()
  }
  expect(w.prompts.length).toBe(5)
  expect(w.logs).toEqual([])
  expect(w.ledger).toBeUndefined()
})

test('ledger keeps the newest 200, feeds the last 20, caps a hint at 5 pairs, honors the language', async ($, on) => {
  const old = Array.from({ length: 200 }, (_, i) => [{ wrong: `w${i}`, fix: `f${i}` }])
  const six = ['Can', 'you', 'explain', 'how', 'units', 'here'].map(wrong => ({ wrong, fix: wrong.toUpperCase() }))
  const w = world(on, [found(six)], { ENGLISH_COACH_NATIVE_LANG: 'Portuguese' }, old)
  await submit($, PROSE)
  await w.clock.settle()
  expect(w.systems[0]).toContain('Portuguese')
  expect(w.prompts[0]).toContain('w199 → f199')
  expect(w.prompts[0]).toContain('w180 → f180')
  expect(w.prompts[0]).not.toContain('w179 → f179')
  expect(w.logs[0].split(' · ').length).toBe(5)
  expect(w.ledger.length).toBe(200)
  expect(w.ledger[0]).toEqual([{ wrong: 'w1', fix: 'f1' }])
  expect(w.ledger[199].length).toBe(5)
})

const PANE = {
  plugin: 'english-coach',
  component: 'Pane',
  requestId: 'english',
  viewport: { columns: 100, rows: 30 },
  props: {
    title: 'English coach · recurring mistakes',
    isFocused: true,
    bodyColumns: 60,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 15 },
    view: {},
  },
} as const

test('/english registers, opens a pane, and lists mistakes by count', async ($, on) => {
  let ledger: unknown = [
    [{ wrong: 'explain me', fix: 'explain to me' }],
    [{ wrong: 'depend of', fix: 'depend on' }],
    [{ wrong: 'Depend of', fix: 'depend on' }, { wrong: 'depend of', fix: 'depend on' }],
  ]
  const registered: any[] = []
  const opened: any[] = []
  on('store.get', () => ({ value: ledger }))
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($: any, e: any) => {
    registered.push(e)
    return { value: undefined }
  })
  on('ui.open', ($: any, e: any) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect(registered).toMatchObject([{ name: 'english', immediate: true }])
  expect(await $.command.run({ command: 'english', args: '' })).toEqual({})
  expect(opened).toMatchObject([{ id: 'english', focus: true, closeOnEscape: true }])

  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /×/ })).toMatchObject({ children: ['  3×  depend of → depend on'] })
  expect(await ui.find({ type: 'Text', text: '  1×  explain me → explain to me' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '3 entries · esc to close' })).toBeDefined()
  await ui.unmount()

  ledger = undefined
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'No mistakes recorded yet.' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '0 entries · esc to close' })).toBeDefined()
})
