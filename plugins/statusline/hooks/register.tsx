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

type GitLine = { left: string[]; repo: { text: string; href?: string }; fetched: string; arrows: string }

// owner/repo from the origin remote and the page it lives at, else the folder's name.
async function readRepo($: EngineInterface): Promise<{ text: string; href?: string }> {
  const url = await $.process.run(['git', 'remote', 'get-url', 'origin'], { timeoutMs: 3000 })
  const m = /^(?:[a-z+]+:\/\/(?:[^@/]+@)?|[^@/]+@)([^/:]+)[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(url.stdout.trim())
  if (url.exitCode === 0 && m) return { text: m[2] ?? '—', href: `https://${m[1]}/${m[2]}` }

  const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { timeoutMs: 3000 })

  return { text: top.stdout.trim().split('/').pop() || '—' }
}

// The Git tab's first line: the branch, then only what differs: changed lines and dirty.
async function readGitDetail($: EngineInterface, now: number): Promise<GitLine | undefined> {
  try {
    const st = await $.process.run(['git', 'status', '--porcelain=v2', '--branch'], { timeoutMs: 3000 })
    if (st.exitCode !== 0) return undefined

    const lines = st.stdout.split('\n')
    const branch = lines.find(l => l.startsWith('# branch.head '))?.slice(14) ?? 'detached'
    const isDirty = lines.some(l => /^[12?] /.test(l))
    // `branch.ab` is there only when the branch has an upstream; print just the sides that differ.
    const ab = /^# branch\.ab \+(\d+) -(\d+)/.exec(lines.find(l => l.startsWith('# branch.ab ')) ?? '')
    const arrows = [ab?.[1] && ab[1] !== '0' ? `↑${ab[1]}` : '', ab?.[2] && ab[2] !== '0' ? `↓${ab[2]}` : ''].filter(Boolean).join(' ')
    const diff = await $.process.run(['git', 'diff', 'HEAD', '--shortstat'], { timeoutMs: 3000 })
    const added = /(\d+) insertion/.exec(diff.stdout)?.[1] ?? '0'
    const removed = /(\d+) deletion/.exec(diff.stdout)?.[1] ?? '0'
    const hasLines = added !== '0' || removed !== '0'

    return {
      left: [branch, ...(hasLines ? [`+${added}/-${removed}`] : []), ...(isDirty ? ['dirty'] : []), ...(arrows ? [arrows] : [])],
      repo: await readRepo($),
      fetched: await readFetched($, now),
      arrows,
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

// The Git tab's second line, left: the branch's pull request if it has one, then its merge status, checks, review and assignees (else author).
type Part = { text: string; href?: string; prefix?: string; tone?: 'bright' | 'dim' }
type PrLine = { head: Part[]; tail: Part[] }

const REVIEW: Record<string, string> = {
  APPROVED: '✓ approved',
  CHANGES_REQUESTED: '✗ changes requested',
  REVIEW_REQUIRED: '… review required',
}

function checksText(rollup: unknown): string | undefined {
  const checks = (Array.isArray(rollup) ? rollup : []) as { conclusion?: string; state?: string; status?: string }[]
  if (checks.length === 0) return undefined

  const failed = checks.filter(c => /FAIL|ERROR|CANCEL|TIMED/i.test(c.conclusion ?? c.state ?? '')).length
  const running = checks.filter(c => (c.status && c.status !== 'COMPLETED') || c.state === 'PENDING').length

  return failed ? `✗ ${failed} failing` : running ? `… ${running} running` : '✓ checks'
}

// ready to merge, bypass (blocked, but an admin may merge anyway) or unable to merge; nothing while GitHub is still working it out.
async function mergeText($: EngineInterface, state: unknown, number: number): Promise<string | undefined> {
  if (state === 'CLEAN' || state === 'UNSTABLE' || state === 'HAS_HOOKS') return '✓ ready to merge'
  if (state === 'UNKNOWN' || typeof state !== 'string') return undefined
  if (state === 'BLOCKED' || state === 'BEHIND') {
    const [owner, name] = (await readRepo($)).text.split('/')
    const r = await $.process.run(
      [
        'gh', 'api', 'graphql',
        '-f', 'query=query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){viewerCanMergeAsAdmin}}}',
        '-f', `o=${owner}`, '-f', `r=${name}`, '-F', `n=${number}`,
      ],
      { timeoutMs: 15000 },
    )
    try {
      if (r.exitCode === 0 && JSON.parse(r.stdout)?.data?.repository?.pullRequest?.viewerCanMergeAsAdmin === true) return '! bypass'
    } catch {
      // unreadable answer: fall through to unable to merge
    }
  }

  return '✗ unable to merge'
}

async function readPr($: EngineInterface, branch: string | undefined): Promise<PrLine> {
  try {
    if (!branch || branch === 'detached') return { head: [], tail: [] }

    // Only the open pull request of the branch: merged and closed ones are not shown.
    const r = await $.process.run(
      [
        'gh', 'pr', 'list', '--head', branch, '--state', 'open', '--limit', '1', '--json',
        'number,url,author,assignees,reviewDecision,statusCheckRollup,mergeStateStatus,isDraft',
      ],
      { timeoutMs: 15000 },
    )
    if (r.exitCode !== 0) $.ui.log(`gh pr list: exit ${r.exitCode}: ${r.stderr.trim().slice(0, 200)}`, { to: 'debug' })
    const pr = r.exitCode === 0 ? JSON.parse(r.stdout)?.[0] : undefined
    if (pr?.number === undefined) return { head: [], tail: [] }

    const assignees = (Array.isArray(pr.assignees) ? pr.assignees : [])
      .map((a: { login?: unknown }) => a.login)
      .filter((l: unknown): l is string => typeof l === 'string')
    const who = assignees.length > 0 ? assignees.join(', ') : typeof pr.author?.login === 'string' ? pr.author.login : undefined
    const merge = pr.isDraft ? undefined : await mergeText($, pr.mergeStateStatus, pr.number)
    const checks = checksText(pr.statusCheckRollup)
    const review = REVIEW[String(pr.reviewDecision ?? '')]

    return {
      head: [{ prefix: pr.isDraft ? 'Draft PR ' : 'PR ', text: `#${pr.number}`, tone: 'bright', href: typeof pr.url === 'string' ? pr.url : undefined }],
      tail: [merge, checks, review, who].filter((t): t is string => t !== undefined).map(text => ({ text })),
    }
  } catch (err) {
    $.ui.log(`gh pr list failed: ${String(err).slice(0, 200)}`, { to: 'debug' })

    return { head: [], tail: [] }
  }
}

function redraw($: EngineInterface) {
  return update($, tick, n => n + 1)
}

export const register: Register = on => {
  let model: string | undefined
  let effort: string | undefined
  let email: string | undefined
  let extra: Extra | undefined
  let extraAt = 0
  let orgId: string | undefined
  let plan: string | undefined
  let detail: GitLine | undefined
  let detailAt = 0
  let pr: PrLine = { head: [], tail: [] }
  let prAt = 0
  let prBranch: string | undefined

  on('session.start', async ($, e, next) => {
    $.clock.every(REFRESH_MS, () => redraw($))
    const id = await $.session.identity()
    email = id.deny === undefined ? id.email : undefined

    try {
      const auth = await $.process.run(['claude', 'auth', 'status'], { timeoutMs: 10000 })
      const status = JSON.parse(auth.stdout)
      email ??= typeof status?.email === 'string' ? status.email : undefined
      orgId = typeof status?.orgId === 'string' ? status.orgId : undefined
      plan = typeof status?.subscriptionType === 'string' ? status.subscriptionType : undefined
    } catch {
      plan = undefined
    }

    return next(e)
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

    const { Box, Link, Select, Text } = $.ui.resolve(e)
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

          if (plan === 'enterprise') {
            const { spent, limit } = extra ?? {}
            if (spent !== undefined && typeof limit === 'number') extra = { ...extra, balance: Math.max(0, limit - spent) }
          } else if (orgId) {
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
    if (selected === 'git' && now - detailAt > GIT_EVERY_MS) {
      detailAt = now
      detail = await readGitDetail($, now)
    }
    if (selected === 'git' && (now - prAt > PR_EVERY_MS || detail?.left[0] !== prBranch)) {
      prAt = now
      prBranch = detail?.left[0]
      pr = await readPr($, detail?.left[0])
    }
    const five = usage.rateLimits.find(r => r.kind === 'five_hour')
    const resets = five?.resetsAt ? Date.parse(five.resetsAt) - now : undefined
    const mail = email

    const bright = (text: string): Part => ({ text, tone: 'bright' })
    const left = [bright(pretty(shownModel)), bright(effort ?? '—'), bright(style ?? 'default')]
    const right = [
      resets !== undefined ? `resets ${span(resets)}` : undefined,
      five ? `${Math.round(five.percentUsed)}% used` : undefined,
      usage.cost ? `$${usage.cost.usd.toFixed(2)}` : undefined,
      usage.context.percent !== undefined ? `ctx ${usage.context.percent}%` : undefined,
      span(now - usage.startedAt),
    ].filter((s): s is string => s !== undefined)

    const row = (items: Part[] | string[]) =>
      items.flatMap((item, i) => {
        const part = typeof item === 'string' ? { text: item } : item

        return [
          i > 0 ? <Text key={`s${i}`} dimColor>{' | '}</Text> : null,
          part.prefix ? (
            <Text key={`p${i}`} bold={part.tone === 'bright'} dimColor={part.tone === 'dim'}>
              {part.prefix}
            </Text>
          ) : null,
          part.href ? (
            <Link key={`t${i}`} href={part.href}>
              <Text underline bold={part.tone === 'bright'} dimColor={part.tone === 'dim'}>
                {part.text}
              </Text>
            </Link>
          ) : (
            <Text
              key={`t${i}`}
              underline={part.prefix !== undefined}
              bold={part.tone === 'bright'}
              dimColor={part.tone === 'dim'}
            >
              {part.text}
            </Text>
          ),
        ]
      })

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
          {row(line.left.map(bright))}
          <Box flexGrow={1} />
          {line.repo.href ? (
            <Link href={line.repo.href}>
              <Text underline>{line.repo.text}</Text>
            </Link>
          ) : (
            <Text>{line.repo.text}</Text>
          )}
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
              {row([...pr.head, ...pr.tail])}
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
            {mail ? <Text dimColor>{mail}</Text> : null}
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

