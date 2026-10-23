import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const tick = atom({ plugin: 'statusline', key: 'tick' } as const, 0)
const tab = atom({ plugin: 'statusline', key: 'tab' } as const, 'status')

const TABS = [
  { id: 'status', label: 'Status' },
  { id: 'git', label: 'Git' },
] as const

const REFRESH_MS = 30000
const EXTRA_EVERY_MS = 300000
const CREDITS_URL = 'https://api.anthropic.com/api/oauth/organizations'
const GIT_EVERY_MS = 5000
const PR_EVERY_MS = 60000
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

type Extra = { spent?: number; limit?: number | null; balance?: number }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const money = (v: number | undefined) => (v === undefined ? '—' : `$${v.toFixed(2)}`)
const BALANCE_KEYS = ['balance', 'current_balance', 'prepaid_balance', 'credit_balance', 'remaining_credits']

const parseJson = (text: string) => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// The endpoint reports credits in cents; a null monthly limit is "Unlimited".
function parseExtra(text: string): { extra?: Extra; keys: string } {
  try {
    const x = JSON.parse(text)?.extra_usage
    if (!x || x.is_enabled === false) return { keys: x ? 'disabled' : 'no extra_usage' }
    const found = BALANCE_KEYS.map(k => num(x[k])).find(v => v !== undefined)
    const cents = (v: number | undefined) => (v === undefined ? undefined : v / 100)
    return {
      keys: Object.keys(x).join(','),
      extra: {
        spent: cents(num(x.used_credits)),
        limit: x.monthly_limit === null ? null : cents(num(x.monthly_limit)),
        balance: cents(found),
      },
    }
  } catch {
    return { keys: 'unparseable' }
  }
}

const pretty = (model: string | undefined) => {
  if (!model) return '—'
  const m = model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
  return m
    .split('-')
    .map(p => (/^\d+$/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ')
    .replace(/(\d) (\d)/, '$1.$2')
}

const span = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60000))
  const d = Math.floor(m / 1440)
  const hh = Math.floor((m % 1440) / 60)
  const mm = m % 60
  if (d > 0) return `${d}d ${hh}h`
  return hh > 0 ? `${hh}h ${String(mm).padStart(2, '0')}m` : `${mm}m`
}

// Empty outside a git repository; else the branch and the line changes against HEAD.
async function readGit($: EngineInterface): Promise<string[]> {
  try {
    return await readGitUnsafe($)
  } catch {
    return []
  }
}

async function readGitUnsafe($: EngineInterface): Promise<string[]> {
  const head = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 3000 })
  if (head.exitCode !== 0) return []

  let branch = head.stdout.trim()
  if (branch === 'HEAD') {
    const sha = await $.process.run(['git', 'rev-parse', '--short', 'HEAD'], { timeoutMs: 3000 })
    branch = sha.exitCode === 0 ? sha.stdout.trim() : 'detached'
  }

  const diff = await $.process.run(['git', 'diff', 'HEAD', '--shortstat'], { timeoutMs: 3000 })
  const added = /(\d+) insertion/.exec(diff.stdout)?.[1] ?? '0'
  const removed = /(\d+) deletion/.exec(diff.stdout)?.[1] ?? '0'

  return [branch, `+${added}/-${removed}`]
}

type GitLine = { left: string[]; repo: string; fetched: string }

// owner/repo from the origin remote, else the folder's name.
async function readRepo($: EngineInterface): Promise<string> {
  const url = await $.process.run(['git', 'remote', 'get-url', 'origin'], { timeoutMs: 3000 })
  const slug = /[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(url.stdout.trim())?.[1]
  if (url.exitCode === 0 && slug) return slug

  const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { timeoutMs: 3000 })

  return top.stdout.trim().split('/').pop() || '—'
}

// The Git tab's first line: the branch, then only what differs: changed lines and dirty.
async function readGitDetail($: EngineInterface, now: number): Promise<GitLine | undefined> {
  try {
    const st = await $.process.run(['git', 'status', '--porcelain=v2', '--branch'], { timeoutMs: 3000 })
    if (st.exitCode !== 0) return undefined

    const lines = st.stdout.split('\n')
    const branch = lines.find(l => l.startsWith('# branch.head '))?.slice(14) ?? 'detached'
    const isDirty = lines.some(l => /^[12?] /.test(l))
    const diff = await $.process.run(['git', 'diff', 'HEAD', '--shortstat'], { timeoutMs: 3000 })
    const added = /(\d+) insertion/.exec(diff.stdout)?.[1] ?? '0'
    const removed = /(\d+) deletion/.exec(diff.stdout)?.[1] ?? '0'
    const hasLines = added !== '0' || removed !== '0'

    return {
      left: [branch, ...(hasLines ? [`+${added}/-${removed}`] : []), ...(isDirty ? ['dirty'] : [])],
      repo: await readRepo($),
      fetched: await readFetched($, now),
    }
  } catch {
    return undefined
  }
}

// When the last `git fetch` or `git pull` ran, from the mtime of FETCH_HEAD.
async function readFetched($: EngineInterface, now: number): Promise<string> {
  try {
    const dir = await $.process.run(['git', 'rev-parse', '--absolute-git-dir'], { timeoutMs: 3000 })
    const stat = await $.fs.stat(`${dir.stdout.trim()}/FETCH_HEAD`)

    return `fetched ${span(now - stat.mtimeMs)} ago`
  } catch {
    return 'never fetched'
  }
}

// The Git tab's second line: the branch's pull request if it has one, and how far it is from its base on origin if it differs.
async function readPr($: EngineInterface): Promise<string[]> {
  try {
    const r = await $.process.run(['gh', 'pr', 'view', '--json', 'number,baseRefName'], { timeoutMs: 15000 })
    const pr = r.exitCode === 0 ? JSON.parse(r.stdout) : undefined
    let base: string | undefined = pr?.baseRefName
    if (!base) {
      const head = await $.process.run(['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { timeoutMs: 3000 })
      base = head.exitCode === 0 ? head.stdout.trim().replace(/^origin\//, '') : 'main'
    }

    const cmp = await $.process.run(['git', 'rev-list', '--left-right', '--count', `HEAD...origin/${base}`], { timeoutMs: 3000 })
    const [ahead = '0', behind = '0'] = cmp.exitCode === 0 ? cmp.stdout.trim().split(/\s+/) : []
    const arrows = [ahead !== '0' ? `↑${ahead}` : '', behind !== '0' ? `↓${behind}` : ''].filter(Boolean).join(' ')

    return [...(pr?.number !== undefined ? [`PR #${pr.number}`] : []), ...(arrows ? [arrows] : [])]
  } catch {
    return []
  }
}

function redraw($: EngineInterface) {
  return update($, tick, n => n + 1)
}

export const register: Register = (on, options) => {
  let model: string | undefined
  let effort: string | undefined
  let email: string | undefined
  let extra: Extra | undefined
  let extraAt = 0
  let orgId: string | undefined
  let git: string[] = []
  let gitAt = 0
  let detail: GitLine | undefined
  let detailAt = 0
  let pr: string[] = []
  let prAt = 0

  on('session.start', async ($, e, next) => {
    $.clock.every(REFRESH_MS, () => redraw($))
    await $.command.register({
      name: 'tab',
      description: 'Switch the statusline tab (no argument: next tab)',
      argumentHint: '[status|git]',
      immediate: true,
    })
    const id = await $.session.identity()
    email = id.deny === undefined ? id.email : undefined

    if (email === undefined) {
      try {
        const auth = await $.process.run(['claude', 'auth', 'status'], { timeoutMs: 10000 })
        const status = JSON.parse(auth.stdout)
        email = typeof status?.email === 'string' ? status.email : undefined
        orgId = typeof status?.orgId === 'string' ? status.orgId : undefined
      } catch {
        email = undefined
      }
    }

    return next(e)
  })

  on('command.run', { command: 'tab' }, async ($, e) => {
    const asked = TABS.find(t => t.id === e.args.trim().toLowerCase())
    const current = await read($, tab)
    const next = asked ?? TABS[(TABS.findIndex(t => t.id === current) + 1) % TABS.length] ?? TABS[0]
    await update($, tab, () => next.id)

    return { text: `Statusline tab: ${next.label}` }
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      model = e.model
      effort = typeof e.effort === 'number' ? String(e.effort) : e.effort
      await redraw($)
    }

    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await redraw($)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await read($, tick)

    if (e.props.hasSurvey || e.surface === 'mobile') return next(e)

    const { Box, Select, Text } = $.ui.resolve(e)
    const selected = await read($, tab)
    const usage = await $.session.usage()
    const now = await $.clock.now()
    const style = (await $.settings.read({ key: 'outputStyle' })) as string | undefined
    const shownModel = model ?? ((await $.settings.read({ key: 'model' })) as string | undefined)
    if (now - extraAt > EXTRA_EVERY_MS) {
      extraAt = now
      try {
        const auth = await $.session.authorize()
        if (auth) {
          const r = await $.http.fetch(USAGE_URL, {
            headers: { 'anthropic-beta': 'oauth-2025-04-20' },
            auth: auth.handle,
          })
          const parsed = r.ok ? parseExtra(r.text) : { extra: undefined, keys: 'request failed' }
          extra = parsed.extra
          $.ui.log(`extra usage: status ${r.status}, keys: ${parsed.keys}`, { to: 'debug' })

          if (orgId) {
            const c = await $.http.fetch(`${CREDITS_URL}/${orgId}/prepaid/credits`, {
              headers: { 'anthropic-beta': 'oauth-2025-04-20' },
              auth: auth.handle,
            })
            const cents = c.ok ? num(parseJson(c.text)?.amount) : undefined
            $.ui.log(`prepaid credits: status ${c.status}`, { to: 'debug' })
            if (cents !== undefined) extra = { ...extra, balance: cents / 100 }
          }
        }
      } catch {
        $.ui.log('extra usage: request failed', { to: 'debug' })
      }
    }
    if (now - gitAt > GIT_EVERY_MS) {
      gitAt = now
      git = await readGit($)
    }
    if (selected === 'git' && now - detailAt > GIT_EVERY_MS) {
      detailAt = now
      detail = await readGitDetail($, now)
    }
    if (selected === 'git' && now - prAt > PR_EVERY_MS) {
      prAt = now
      pr = await readPr($)
    }
    const five = usage.rateLimits.find(r => r.kind === 'five_hour')
    const resets = five?.resetsAt ? Date.parse(five.resetsAt) - now : undefined
    const mail = typeof options.email === 'string' && options.email ? options.email : email

    const left = [
      pretty(shownModel),
      effort ?? '—',
      style ?? 'default',
      ...git,
    ]
    const right = [
      resets !== undefined ? `resets ${span(resets)}` : undefined,
      five ? `${Math.round(five.percentUsed)}% used` : undefined,
      usage.cost ? `$${usage.cost.usd.toFixed(2)}` : undefined,
      usage.context.percent !== undefined ? `ctx ${usage.context.percent}%` : undefined,
      span(now - usage.startedAt),
    ].filter((s): s is string => s !== undefined)

    const row = (items: string[]) =>
      items.flatMap((s, i) => [
        i > 0 ? <Text key={`s${i}`} dimColor>{' | '}</Text> : null,
        <Text key={`t${i}`}>{s}</Text>,
      ])

    const total = (extra?.spent ?? 0) + (extra?.balance ?? 0)
    const credited =
      extra?.spent !== undefined && extra.balance !== undefined && total > 0
        ? `${Math.round((extra.spent / total) * 100)}%`
        : '—'
    const tabs = (
      <Select
        key="tab"
        autoFocus
        label="Tab"
        value={selected}
        options={TABS.map(t => ({ value: t.id, label: t.label }))}
        onSelect={value => update($, tab, () => (value === 'git' ? 'git' : 'status'))}
      />
    )
    const second = [`Credits ${credited}`, `Left ${money(extra?.balance)}`, `Used ${money(extra?.spent)}`]

    const oneLine = (line: GitLine | undefined, empty: string) =>
      line ? (
        <Box flexDirection="row">
          {row(line.left)}
          <Box flexGrow={1} />
          <Text>{line.repo}</Text>
        </Box>
      ) : (
        <Text dimColor>{empty}</Text>
      )

    const content =
      selected === 'git' ? (
        <Box flexDirection="column">
          {oneLine(detail, 'not a git repository')}
          {detail ? (
            <Box flexDirection="row">
              {row(pr)}
              <Box flexGrow={1} />
              <Text dimColor>{detail.fetched}</Text>
            </Box>
          ) : null}
        </Box>
      ) : (
        <Box flexDirection="column">
          <Box flexDirection="row">
            {row(left)}
            <Box flexGrow={1} />
            {row(right)}
          </Box>
          <Box flexDirection="row">
            {row(second)}
            <Box flexGrow={1} />
            {mail ? <Text>{mail}</Text> : null}
          </Box>
        </Box>
      )

    return (
      <Box flexDirection="column">
        {tabs}
        {content}
      </Box>
    )
  })
}
