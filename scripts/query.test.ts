#!/usr/bin/env node

// query.test.ts — proves the per-session indexes, their merge and every /events filter against
// crafted per-session WALs under a fake HOME.
//
// The server runs with TZ=UTC so the local day and minute of each fixture record are fixed.

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type CallRecord, catOf, type FirstPage, type Row, type WalRecord } from '../shared/api.ts'
import { startServer } from './test-server.ts'
import { agentTree, createWalIndex, type IndexEntry, lineageOf, matcher } from './wal-index.ts'

const dir = mkdtempSync(join(tmpdir(), 'walquery.'))
const dir2 = mkdtempSync(join(tmpdir(), 'walbudget.'))
const proj = join(dir, '.claude', 'projects', '-tmp-q')
mkdirSync(proj, { recursive: true })
const sid = (n: number): string => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`
// Discovery locates a session by its transcript, so each WAL gets an (empty) one beside it.
const walOf = (id: string): string => join(proj, `${id}.wal.jsonl`)
const session = (id: string, lines?: string[]): void => {
  writeFileSync(join(proj, `${id}.jsonl`), '')
  if (lines) writeFileSync(walOf(id), `${lines.join('\n')}\n`)
}

// Day one ~23:30 lives in S1, day two in S2. Old single-file seqs map onto (sess, seq) by `at`:
// 0–3 are S1's 0–3, 4–7 are S2's 0–3. The whitespace-only line gets no seq; the unparseable one
// (S1 seq 3) inherits S1 seq 2's time.
const S1 = sid(1)
const S2 = sid(2)
session(S1, [
  JSON.stringify({ ts: '2026-09-28T09:00:00.000Z', event: 'SessionStart', session_id: S1, payload: { prompt: 'zażółć gęślą jaźń' } }),
  JSON.stringify({ ts: '2026-09-28T23:30:00.000Z', event: 'PreToolUse', session_id: S1, tool_name: 'Bash' }),
  JSON.stringify({ ts: '2026-09-28T23:30:05.000Z', event: 'PostToolUse', session_id: S1, tool_name: 'Bash', duration_ms: 1500 }),
  '   ',
  'this is not json',
])
session(S2, [
  JSON.stringify({ ts: '2026-09-29T01:00:00.000Z', event: 'PreToolUse', session_id: S2, tool_name: 'Read' }),
  JSON.stringify({ ts: '2026-09-29T01:00:01.000Z', event: 'PostToolUse', session_id: S2, tool_name: 'Read', duration_ms: 20 }),
  JSON.stringify({ ts: '2026-09-29T12:00:00.000Z', event: 'UserPromptSubmit', session_id: S2, payload: { prompt: 'find the needle' } }),
  JSON.stringify({ ts: '2026-09-29T12:00:02.000Z', event: 'PostToolUseFailure', session_id: S2, tool_name: 'Bash', duration_ms: 300 }),
])
// Rows with no `event` fall in 'session', which no event name maps to, so only `cats` can say so.
const NE = sid(13)
session(NE, [
  JSON.stringify({ ts: '2026-10-01T00:00:00.000Z', session_id: NE, tool_name: 'Bash' }),
  JSON.stringify({ ts: '2026-10-01T00:00:01.000Z', event: 'PreToolUse', session_id: NE, tool_name: 'Bash' }),
])
const at = (n: number): string => (n < 4 ? `${S1}:${n}` : `${S2}:${n - 4}`)
const BOTH = `ids=${S1},${S2}`

// MCP log as a third session. Seqs after indexing: 0 find Pre, 1 Bash Pre, 2 find Post,
// 3 call(0,2), 4 add Pre, 5 orphan Pre, 6 add Failure, 7 call(4,6), 8 Bash Post, 9 call(1,8),
// 10 find Post without a Pre, 11 its call row.
const FIND = 'mcp__claude_ai_Todoist__find-tasks'
const ADD = 'mcp__claude_ai_Todoist__add-tasks'
const M1 = sid(3)
const mrec = (min: string, event: string, tool: string, tuid: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ ts: `2026-09-29T10:${min}:00.000Z`, event, session_id: M1, tool_name: tool, tool_use_id: tuid, ...extra })
session(M1, [
  mrec('00', 'PreToolUse', FIND, 'tA', { payload: { tool_input: { searchText: 'milk' } } }),
  mrec('01', 'PreToolUse', 'Bash', 'tB', { payload: { tool_input: { command: 'ls' } } }),
  mrec('02', 'PostToolUse', FIND, 'tA', {
    duration_ms: 120,
    payload: { tool_input: { searchText: 'milk' }, tool_response: [{ type: 'text', text: 'Buy milk' }] },
  }),
  mrec('03', 'PreToolUse', ADD, 'tC', { payload: { tool_input: { content: 'eggs' } } }),
  mrec('04', 'PreToolUse', 'mcp__srv__never', 'tD', { payload: { tool_input: {} } }),
  mrec('05', 'PostToolUseFailure', ADD, 'tC', { duration_ms: 50, payload: { tool_input: { content: 'eggs' }, error: 'boom quota', is_interrupt: false } }),
  mrec('06', 'PostToolUse', 'Bash', 'tB', { duration_ms: 5, payload: { tool_response: 'ok' } }),
  mrec('07', 'PostToolUse', FIND, 'tE', { duration_ms: 9, payload: { tool_response: 'no pre' } }),
])

// A Bash pair whose input only the Pre holds, and a WAL line whose event is a prototype key.
const P1 = sid(14)
const P2 = sid(15)
const PRE = JSON.stringify({
  ts: '2026-09-29T11:00:00.000Z',
  event: 'PreToolUse',
  session_id: P1,
  tool_name: 'Bash',
  tool_use_id: 'tP',
  payload: { tool_input: { command: 'zqx-only-in-the-pre' } },
})
const POST = JSON.stringify({
  ts: '2026-09-29T11:00:05.000Z',
  event: 'PostToolUse',
  session_id: P1,
  tool_name: 'Bash',
  tool_use_id: 'tP',
  duration_ms: 5000,
  payload: { tool_response: 'done' },
})
session(P1, [PRE, POST])
session(P2, [JSON.stringify({ ts: '2026-09-29T11:30:00.000Z', event: 'constructor', session_id: P2, tool_name: 'mcp__s__t' })])

// A transcript with tool calls and no WAL: the observer builds its rows from the transcript alone.
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'projects', '-tmp-proj')
const TR = 'd01c2dfc-0a01-4e1f-825a-5b0462780f18'
copyFileSync(join(FIXTURE, `${TR}.jsonl`), join(proj, `${TR}.jsonl`))

// The same transcript with a WAL of one call and one Stop, so the observer joins tokens onto both rows. From the
// transcript's usage: the reply behind call gsNTiK has output 903 and the next request's prompt is 401 larger than
// that reply's prompt plus its output; the last reply, aMrgGL, has output 41.
const TK = sid(17)
const trLines = readFileSync(join(FIXTURE, `${TR}.jsonl`), 'utf8').split(/(?<=\n)/)
const gsNTiK = /"id":"(toolu_[A-Za-z0-9]*gsNTiK)"/.exec(trLines.join(''))?.[1]
const lastText = (JSON.parse(trLines[18] ?? '{}') as { message?: { content?: { text?: string }[] } }).message?.content?.[0]?.text
if (!gsNTiK || !lastText) throw new Error('fixture lacks the call or the last reply')
writeFileSync(join(proj, `${TK}.jsonl`), trLines.join(''))
writeFileSync(
  walOf(TK),
  `${[
    { ts: '2026-09-30T09:55:55.300Z', event: 'PreToolUse', tool_name: 'Read', tool_use_id: gsNTiK, payload: { tool_input: {} } },
    { ts: '2026-09-30T09:55:55.400Z', event: 'PostToolUse', tool_name: 'Read', tool_use_id: gsNTiK, payload: { tool_response: 'ok' } },
    { ts: '2026-09-30T09:55:58.000Z', event: 'Stop', payload: { last_assistant_message: lastText } },
  ]
    .map((r) => JSON.stringify({ workspace: 'w', ...r }))
    .join('\n')}\n`,
)

// Token filter and order: a hand-made transcript of one call per reply, so each call's Total is its reply's output
// plus the prompt growth to the next reply. Totals: Glob 900, Grep 150 and Read 150 (a tie, both at :02), Bash 50,
// the Stop 5 (output only). Edit's call is in no transcript, and Pre / Post rows never get numbers.
const TO = sid(18)
const osec = (s: number): string => `2026-10-02T10:00:${String(s).padStart(2, '0')}.000Z`
const oreply = (n: number, s: number, prompt: number, out: number, blocks: unknown[], stop: string | null = null): string =>
  JSON.stringify({
    type: 'assistant',
    uuid: `a${n}`,
    timestamp: osec(s),
    message: {
      id: `r${n}`,
      model: 'm',
      stop_reason: stop,
      content: blocks,
      usage: { input_tokens: 1, cache_read_input_tokens: prompt - 1, output_tokens: out },
    },
  })
const ouse = (tuid: string, name: string) => [{ type: 'tool_use', id: tuid, name, input: {} }]
const oresult = (n: number, s: number, tuid: string): string =>
  JSON.stringify({
    type: 'user',
    uuid: `u${n}`,
    timestamp: osec(s),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tuid, content: 'ok' }] },
  })
writeFileSync(
  join(proj, `${TO}.jsonl`),
  `${[
    JSON.stringify({ type: 'user', uuid: 'u0', timestamp: osec(1), message: { role: 'user', content: 'go' } }),
    oreply(1, 2, 1000, 100, ouse('toolu_o1', 'Read')),
    oresult(1, 3, 'toolu_o1'),
    oreply(2, 4, 1150, 100, ouse('toolu_o2', 'Grep')),
    oresult(2, 5, 'toolu_o2'),
    oreply(3, 6, 1300, 120, ouse('toolu_o3', 'Glob')),
    oresult(3, 7, 'toolu_o3'),
    oreply(4, 8, 2200, 30, ouse('toolu_o4', 'Bash')),
    oresult(4, 9, 'toolu_o4'),
    oreply(5, 10, 2250, 5, [{ type: 'text', text: 'done' }], 'end_turn'),
  ].join('\n')}\n`,
)
// `zebra` sits in the inputs of Read, Glob and Edit, so `q` matches their Pre and call rows.
const opre = (s: number, tool: string, n: number, input = {}) => ({
  ts: osec(s),
  event: 'PreToolUse',
  tool_name: tool,
  tool_use_id: `toolu_o${n}`,
  payload: { tool_input: input },
})
const opost = (s: number, tool: string, n: number) => ({
  ts: osec(s),
  event: 'PostToolUse',
  tool_name: tool,
  tool_use_id: `toolu_o${n}`,
  payload: { tool_response: 'ok' },
})
const ZEBRA = { marker: 'zebra' }
writeFileSync(
  walOf(TO),
  `${[
    opre(2, 'Read', 1, ZEBRA),
    opre(2, 'Grep', 2),
    opost(3, 'Read', 1),
    opost(3, 'Grep', 2),
    opre(6, 'Glob', 3, ZEBRA),
    opost(7, 'Glob', 3),
    opre(8, 'Bash', 4),
    opost(9, 'Bash', 4),
    opre(9, 'Edit', 5, ZEBRA),
    opost(9, 'Edit', 5),
    { ts: osec(11), event: 'Stop', payload: { last_assistant_message: 'done' } },
  ]
    .map((r) => JSON.stringify({ workspace: 'w', ...r }))
    .join('\n')}\n`,
)

// Interleaved in time, with a tie across sessions (I1 seq 2 and I2 seq 2 share 00:04).
const I1 = sid(4)
const I2 = sid(5)
const irec = (sec: number, event: string, tool?: string): string =>
  JSON.stringify({ ts: `2026-09-30T00:00:0${sec}.000Z`, event, ...(tool ? { tool_name: tool } : {}) })
session(I1, [irec(1, 'PreToolUse', 'Bash'), irec(3, 'PostToolUse', 'Bash'), irec(4, 'Stop')])
session(I2, [irec(2, 'UserPromptSubmit'), irec(4, 'PreToolUse', 'Read'), irec(4, 'PostToolUse', 'Read'), irec(5, 'Stop')])

// Subagents: G1's ag1 types itself on its first record, G2's ag2 only after an empty agent_type.
const G1 = sid(6)
const G2 = sid(7)
const grec = (min: string, event: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ ts: `2026-09-30T01:${min}:00.000Z`, event, ...extra })
session(G1, [
  grec('00', 'SessionStart'),
  grec('01', 'SubagentStart', { agent_id: 'ag1', agent_type: 'Explore' }),
  grec('02', 'PreToolUse', { agent_id: 'ag1', tool_name: 'Grep' }),
  grec('03', 'Stop'),
])
session(G2, [
  grec('04', 'PreToolUse', { agent_id: 'ag2', agent_type: '', tool_name: 'Read' }),
  grec('05', 'SubagentStop', { agent_id: 'ag2', agent_type: 'Plan' }),
  grec('06', 'Stop'),
])

// Progress summaries: sm1/sm2 never carry a type; ag3's type only arrives on its second record.
const G3 = sid(9)
session(G3, [
  grec('07', 'SubagentStop', { agent_id: 'sm1' }),
  grec('08', 'PreToolUse', { agent_id: 'ag3', agent_type: '', tool_name: 'Read' }),
  grec('09', 'SubagentStop', { agent_id: 'sm2', agent_type: '' }),
  grec('10', 'PostToolUse', { agent_id: 'ag3', agent_type: 'Explore', tool_name: 'Read' }),
  grec('11', 'Stop'),
])

// Spawn tree: main → p1 → c1, and x1 with no Agent call (so under main). sm1 describes c1,
// sm3 p1 (a shell task beside it does not count), sm2 names two subagents so stays with main.
// T2 reuses the id c1, which must not leak across sessions.
const T1 = sid(10)
const T2 = sid(11)
const bg = (...ids: string[]) => ({ background_tasks: ids.map((id) => ({ id, type: id.startsWith('sh') ? 'shell' : 'subagent', status: 'running' })) })
session(T1, [
  grec('20', 'SessionStart'),
  grec('21', 'PostToolUse', { tool_name: 'Agent', payload: { tool_response: { agentId: 'p1', status: 'async_launched' } } }),
  grec('22', 'SubagentStart', { agent_id: 'p1', agent_type: 'general-purpose' }),
  grec('23', 'PostToolUse', { agent_id: 'p1', agent_type: 'general-purpose', tool_name: 'Agent', payload: { tool_response: { agentId: 'c1' } } }),
  grec('24', 'PreToolUse', { agent_id: 'c1', agent_type: 'Explore', tool_name: 'Read' }),
  grec('25', 'SubagentStop', { agent_id: 'sm1', agent_type: '', payload: bg('c1') }),
  grec('26', 'SubagentStop', { agent_id: 'sm2', agent_type: '', payload: bg('p1', 'c1') }),
  grec('27', 'SubagentStop', { agent_id: 'sm3', agent_type: '', payload: bg('sh1', 'p1') }),
  grec('28', 'PreToolUse', { agent_id: 'x1', agent_type: 'Plan', tool_name: 'Grep' }),
  grec('29', 'Stop'),
])
session(T2, [grec('30', 'PreToolUse', { agent_id: 'c1', agent_type: 'Explore', tool_name: 'Read' }), grec('31', 'Stop')])

// A transcript without a WAL yet.
const LATE = sid(8)
session(LATE)

const { server, base: BASE } = await startServer([], { HOME: dir })
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — ${detail}`}`)
  if (!ok) fail = 1
}

const until = async <T>(fn: () => Promise<T>, tries = 60): Promise<T> => {
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch {
      await wait(100)
    }
  }
  throw new Error('timed out')
}

const events = async (qs = ''): Promise<FirstPage> => {
  const r = await fetch(`${BASE}/events?${qs}`)
  if (!r.ok) throw new Error(`status ${r.status}`)
  return (await r.json()) as FirstPage
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const key = (r: Row): string => `${r.sess}:${r.seq}`
const must = <T>(v: T | undefined | null, what = 'value'): T => {
  if (v == null) throw new Error(`missing ${what}`)
  return v
}
const keysOf = async (qs: string): Promise<string[]> => (await events(`${qs}&limit=100`)).rows.map(key)
const expectKeys = async (label: string, qs: string, want: string[]): Promise<void> => {
  const got = await keysOf(qs)
  check(`${label} (${qs})`, same(got, want), `got [${got}], want [${want}]`)
}
// Assertions carried over from the single-file test, in its old seq numbering.
const expectSeqs = (label: string, qs: string, old: number[]): Promise<void> => expectKeys(label, `${BOTH}&${qs}`, old.map(at))
const pageAll = async (qs: string, limit: number) => {
  const seen: string[] = []
  let res = await events(`${qs}&limit=${limit}`)
  for (;;) {
    seen.push(...res.rows.map(key))
    if (res.next === null) return { seen, last: res }
    res = await events(`${qs}&limit=${limit}&before=${res.next}`)
  }
}

try {
  console.log('query.test.ts')

  const all = await until(() => events(BOTH))
  check('head is a position vector over the pick, skipping blank lines', all.head === `${S1}:4,${S2}:4`, all.head)
  check('total counts every row', all.total === 8, String(all.total))
  check('rows are newest first across both sessions', same(all.rows.map(key), [7, 6, 5, 4, 3, 2, 1, 0].map(at)), JSON.stringify(all.rows.map(key)))
  check('facets in first-seen order', same(all.tools, ['Bash', 'Read']) && same(all.sessions, [S1, S2]), JSON.stringify([all.tools, all.sessions]))
  check(
    'events facet in first-seen order',
    same(all.events, ['SessionStart', 'PreToolUse', 'PostToolUse', 'Unparseable', 'UserPromptSubmit', 'PostToolUseFailure']),
    JSON.stringify(all.events),
  )
  check('gens per picked session', Object.keys(all.gens).join() === `${S1},${S2}` && all.gens[S1] !== all.gens[S2], JSON.stringify(all.gens))
  check('next is null when everything fits', all.next === null, String(all.next))
  const r3 = all.rows.find((r) => key(r) === at(3))
  const r2 = must(
    all.rows.find((r) => key(r) === at(2)),
    'row 2',
  )
  check('unparseable row summary', same(r3, { sess: S1, seq: 3, cat: 'fail', t: r2.t, event: 'Unparseable', tool: null, dur: null }), JSON.stringify(r3))
  check(
    'summary shape',
    same(r2, { sess: S1, seq: 2, cat: 'tool', t: Date.parse('2026-09-28T23:30:05.000Z'), event: 'PostToolUse', tool: 'Bash', dur: 1500 }),
    JSON.stringify(r2),
  )

  await expectKeys('ids scopes to one session', `ids=${S1}`, [3, 2, 1, 0].map(at))
  await expectSeqs('cat single', 'cat=tool', [5, 4, 2, 1])
  await expectSeqs('cat list', 'cat=tool,fail', [7, 5, 4, 3, 2, 1])
  await expectSeqs('cat present but empty matches nothing', 'cat=', [])
  await expectSeqs('tool single', 'tool=Read', [5, 4])
  await expectSeqs('tool - is no tool', 'tool=-', [6, 3, 0])
  await expectSeqs('tool list with -', 'tool=Bash,-', [7, 6, 3, 2, 1, 0])
  await expectSeqs('tool present but empty matches nothing', 'tool=', [])
  await expectSeqs('event single', 'event=PreToolUse', [4, 1])
  await expectSeqs('event list', 'event=PreToolUse,UserPromptSubmit', [6, 4, 1])
  await expectSeqs('event present but empty matches nothing', 'event=', [])
  await expectSeqs('cat_not excludes the category', 'cat_not=tool', [7, 6, 3, 0])
  await expectSeqs('tool_not excludes a tool', 'tool_not=Read', [7, 6, 3, 2, 1, 0])
  await expectSeqs('tool_not - excludes the no-tool bucket', 'tool_not=-', [7, 5, 4, 2, 1])
  await expectSeqs('event_not excludes the event', 'event_not=PreToolUse', [7, 6, 5, 3, 2, 0])
  await expectSeqs('tool_not present but empty excludes nothing', 'tool_not=', [7, 6, 5, 4, 3, 2, 1, 0])
  await expectKeys('agent_not keeps a session with no token', `${BOTH}&agent_not=${S1}:*`, [7, 6, 5, 4].map(at))
  await expectSeqs('date_from inclusive', 'date_from=2026-09-29', [7, 6, 5, 4])
  await expectSeqs('date_to inclusive', 'date_to=2026-09-28', [3, 2, 1, 0])
  await expectSeqs('date range of one day', 'date_from=2026-09-29&date_to=2026-09-29', [7, 6, 5, 4])
  await expectSeqs('time window wraps midnight', 'time_from=23:00&time_to=02:00', [5, 4, 3, 2, 1])
  await expectSeqs('time_from only', 'time_from=12:00', [7, 6, 3, 2, 1])
  await expectSeqs('time_to only, inclusive', 'time_to=09:00', [5, 4, 0])
  await expectSeqs('time window of one minute', 'time_from=09:00&time_to=09:00', [0])
  await expectSeqs('min_ms excludes no-duration by default', 'min_ms=100', [7, 2])
  await expectSeqs('min_ms nodur=exclude', 'min_ms=100&nodur=exclude', [7, 2])
  await expectSeqs('min_ms nodur=include', 'min_ms=100&nodur=include', [7, 6, 4, 3, 2, 1, 0])
  await expectSeqs('max_ms inclusive', 'max_ms=300', [7, 5])
  await expectSeqs('min_ms and max_ms', 'min_ms=100&max_ms=500', [7])
  await expectSeqs('max_ms nodur=include', 'max_ms=500&nodur=include', [7, 6, 5, 4, 3, 1, 0])
  await expectSeqs('nodur alone does not filter', 'nodur=exclude', [7, 6, 5, 4, 3, 2, 1, 0])
  await expectSeqs('q substring', 'q=needle', [6])
  await expectSeqs('q case-insensitive', 'q=NEEDLE', [6])
  await expectSeqs('q multibyte case-insensitive', `q=${encodeURIComponent('ZAŻÓŁĆ')}`, [0])
  await expectSeqs('q on an unparseable line', `q=${encodeURIComponent('not json')}`, [3])
  await expectKeys('q combined with ids', `ids=${S1}&q=bash`, [2, 1].map(at))
  await expectSeqs('filters combine', 'cat=tool&tool=Bash&date_from=2026-09-28', [2, 1])
  await expectSeqs('unparseable values count as unset', 'date_from=junk&time_to=25:99&min_ms=abc', [7, 6, 5, 4, 3, 2, 1, 0])
  await expectSeqs('the old session filter is gone', `session=${S1}`, [7, 6, 5, 4, 3, 2, 1, 0])

  await expectSeqs('whitespace-only min_ms counts as unset', 'min_ms=%20', [7, 6, 5, 4, 3, 2, 1, 0])
  const junk = await events(`${BOTH}&before=2.5`)
  check('malformed before is treated as unset', junk.rows.length === 8 && junk.total === 8, JSON.stringify(junk))
  check('server still answers after a bad cursor', (await events(`${BOTH}&before=-1&limit=1`)).rows.length === 1)

  const s2 = await events(`ids=${S2}&limit=1`)
  check('total under a filter', s2.total === 4, String(s2.total))
  check('counts under a filter', same(s2.counts, { fail: 1, turn: 1, tool: 2 }), JSON.stringify(s2.counts))
  const lengthOf = (p: FirstPage): number => Object.values(p.spans).reduce((n, [a, b]) => n + b - a, 0)
  const ts = (s: string): number => Date.parse(`2026-09-${s}Z`)
  check(
    'spans: one session, first to last matching row past the limit',
    same(s2.spans, { [S2]: [ts('29T01:00:00'), ts('29T12:00:02')] }),
    JSON.stringify(s2.spans),
  )
  const summed = lengthOf(all)
  check('spans: two sessions sum their own spans', summed === ts('28T23:30:05') - ts('28T09:00:00') + ts('29T12:00:02') - ts('29T01:00:00'), String(summed))
  const read = await events(`${BOTH}&tool=Read`)
  check(
    'spans: a filter narrows them and drops sessions with no match',
    same(read.spans, { [S2]: [ts('29T01:00:00'), ts('29T01:00:01')] }) && lengthOf(read) === 1000,
    JSON.stringify(read.spans),
  )
  const lone = await events(`${BOTH}&event=UserPromptSubmit`)
  check('spans: one matching row gives 0', lengthOf(lone) === 0 && Object.keys(lone.spans).join() === S2, JSON.stringify(lone.spans))
  check("limit caps rows, next is the last row's cursor", s2.rows.length === 1 && s2.next === `${s2.rows[0]?.t}.${S2}.3`, JSON.stringify([s2.rows, s2.next]))

  const whole = await pageAll(BOTH, 2)
  check('paging returns every row exactly once', same(whole.seen, [7, 6, 5, 4, 3, 2, 1, 0].map(at)), JSON.stringify(whole.seen))
  check(
    'next-page responses carry no totals or pipe',
    !('total' in whole.last) && !('counts' in whole.last) && !('spans' in whole.last) && !('agents' in whole.last) && !('pipe' in whole.last),
    JSON.stringify(whole.last),
  )
  const filtered = await pageAll(`${BOTH}&tool=-`, 2)
  check('paging under a filter', same(filtered.seen, [6, 3, 0].map(at)), JSON.stringify(filtered.seen))
  const b0 = must(
    all.rows.find((r) => key(r) === at(4)),
    'row 4',
  )
  const exact = await events(`${BOTH}&limit=4&before=${b0.t}.${S2}.0`)
  check('exactly-full last page has next null', same(exact.rows.map(key), [3, 2, 1, 0].map(at)) && exact.next === null, JSON.stringify(exact))

  const IB = `ids=${I1},${I2}`
  const merged = await events(IB)
  const iorder = [`${I2}:3`, `${I2}:2`, `${I2}:1`, `${I1}:2`, `${I1}:1`, `${I2}:0`, `${I1}:0`]
  check('merge interleaves by time, ties newest-first by (sess, seq)', same(merged.rows.map(key), iorder), JSON.stringify(merged.rows.map(key)))
  check('merge: id order in the pick does not change the order', same((await events(`ids=${I2},${I1}`)).rows.map(key), iorder))
  for (const n of [1, 2, 3]) {
    const p = await pageAll(IB, n)
    check(`merge: limit=${n} paging has no dupes or gaps`, same(p.seen, iorder), JSON.stringify(p.seen))
  }
  const tools = await pageAll(`${IB}&cat=tool`, 1)
  check('merge: paging under a filter', same(tools.seen, [`${I2}:2`, `${I2}:1`, `${I1}:1`, `${I1}:0`]), JSON.stringify(tools.seen))
  const tie = must(merged.rows[3], 'tie row')
  await expectKeys('merge: cursor on a cross-session tie', `${IB}&before=${tie.t}.${I1}.2`, [`${I1}:1`, `${I2}:0`, `${I1}:0`])

  const GB = `ids=${G1},${G2}`
  const leaf = (id: string, type: string | null, summaries = 0, children: unknown[] = []) => ({ id, type, summaries, children })
  await expectKeys("agent=<sess>:main matches that session's rows without agent_id", `${GB}&agent=${G1}:main`, [`${G1}:3`, `${G1}:0`])
  await expectKeys('main of both sessions', `${GB}&agent=${G1}:main,${G2}:main`, [`${G2}:2`, `${G1}:3`, `${G1}:0`])
  await expectKeys('agent=<sess>:<id> matches one subagent', `${GB}&agent=${G1}:ag1`, [`${G1}:2`, `${G1}:1`])
  await expectKeys('agent from the second session', `${GB}&agent=${G2}:ag2`, [`${G2}:1`, `${G2}:0`])
  await expectKeys('<sess>:* is the whole session', `${GB}&agent=${G2}:*`, [`${G2}:2`, `${G2}:1`, `${G2}:0`])
  await expectKeys('only unscoped (stale) ids: no agent filter', `${GB}&agent=ag1,main`, [
    `${G2}:2`,
    `${G2}:1`,
    `${G2}:0`,
    `${G1}:3`,
    `${G1}:2`,
    `${G1}:1`,
    `${G1}:0`,
  ])
  await expectKeys('a stale id beside a valid token is ignored', `${GB}&agent=main,${G1}:ag1`, [`${G1}:2`, `${G1}:1`])
  await expectKeys('agent present but empty matches nothing', `${GB}&agent=`, [])
  await expectKeys('cat=subagent is SubagentStart and SubagentStop', `${GB}&cat=subagent`, [`${G2}:1`, `${G1}:1`])
  await expectKeys('event=SubagentStart lists only spawns', `${GB}&event=SubagentStart`, [`${G1}:1`])
  await expectKeys('agent combines with other filters', `${GB}&agent=${G1}:ag1,${G2}:ag2&tool=Read`, [`${G2}:0`])
  const g = await events(GB)
  check(
    'agents facet: a tree per session with rows',
    same(g.agents, [
      { sess: G1, main: leaf('main', null, 0, [leaf('ag1', 'Explore')]) },
      { sess: G2, main: leaf('main', null, 0, [leaf('ag2', 'Plan')]) },
    ]),
    JSON.stringify(g.agents),
  )
  check('agents facet ignores the filter', same((await events(`${GB}&agent=${G2}:ag2`)).agents, g.agents))
  check(
    "untyped subagents count as main's summaries; a type arriving later wins",
    same((await events(`ids=${G3}`)).agents, [{ sess: G3, main: leaf('main', null, 2, [leaf('ag3', 'Explore')]) }]),
    JSON.stringify((await events(`ids=${G3}`)).agents),
  )
  await expectKeys('summaries:main matches every untyped subagent, not one typed later', `ids=${G3}&agent=${G3}:summaries:main`, [`${G3}:2`, `${G3}:0`])
  await expectKeys('summaries:main plus main', `ids=${G3}&agent=${G3}:summaries:main,${G3}:main`, [`${G3}:4`, `${G3}:2`, `${G3}:0`])

  const TB = `ids=${T1},${T2}`
  const t = (...n: number[]) => n.map((x) => `${T1}:${x}`)
  const tree = await events(TB)
  check(
    'tree: parent from the Agent call, nested spawn, summaries on the agent they describe',
    same(tree.agents, [
      { sess: T1, main: leaf('main', null, 1, [leaf('p1', 'general-purpose', 1, [leaf('c1', 'Explore', 1)]), leaf('x1', 'Plan')]) },
      { sess: T2, main: leaf('main', null, 0, [leaf('c1', 'Explore')]) },
    ]),
    JSON.stringify(tree.agents),
  )
  await expectKeys('tree: an agent token is its own rows only', `${TB}&agent=${T1}:p1`, t(3, 2))
  await expectKeys('tree: a subtree token takes descendants and their summaries', `${TB}&agent=${T1}:p1*`, t(7, 5, 4, 3, 2))
  await expectKeys('tree: a leaf subtree is the leaf and its summaries', `${TB}&agent=${T1}:c1*`, t(5, 4))
  await expectKeys('tree: summaries of one agent', `${TB}&agent=${T1}:summaries:c1`, t(5))
  await expectKeys('tree: unattributed summaries', `${TB}&agent=${T1}:summaries:main`, t(6))
  await expectKeys('tree: main alone', `${TB}&agent=${T1}:main`, t(9, 1, 0))
  await expectKeys('tree: main* is the whole session', `${TB}&agent=${T1}:main*`, t(9, 8, 7, 6, 5, 4, 3, 2, 1, 0))
  await expectKeys('tree: a shared id string stays in its session', `${TB}&agent=${T2}:c1`, [`${T2}:0`])
  await expectKeys('tree: and the other way round', `${TB}&agent=${T1}:c1`, t(4))
  await expectKeys('tree: tokens across sessions combine', `${TB}&agent=${T1}:summaries:c1,${T2}:*`, [`${T2}:1`, `${T2}:0`, ...t(5)])
  const tp = await pageAll(`${TB}&agent=${T1}:p1*,${T2}:c1`, 2)
  check('tree: paging under a subtree token has no dupes or gaps', same(tp.seen, [`${T2}:0`, ...t(7, 5, 4, 3, 2)]), JSON.stringify(tp.seen))
  check('tree: facet ignores the agent filter', same((await events(`${TB}&agent=${T1}:x1`)).agents, tree.agents))

  {
    // A 3000-deep spawn chain d0 → … → d2999 under main, plus a spawn cycle y0 → y1 → y0.
    const D = 3000
    const sess = sid(12)
    const agents = new Map<string, string | null>([['main', null]])
    const parents = new Map<string, string | null>([
      ['d0', null],
      ['y0', 'y1'],
      ['y1', 'y0'],
    ])
    for (let i = 0; i < D; i++) agents.set(`d${i}`, 'Explore')
    for (let i = 1; i < D; i++) parents.set(`d${i}`, `d${i - 1}`)
    agents.set('y0', 'Plan').set('y1', 'Plan')
    const ix = { id: sess, agents, parents, about: new Map<string, string>(), links: 0 }
    const row = (agent: string) => ({ agent, minute: 0 }) as IndexEntry
    const hit = matcher(new URLSearchParams(`agent=${sess}:d0*`))
    // Minimum of three runs: host load inflates one run, rarely all three.
    // An O(depth²)-per-row regression costs about 3000 times more, so 5 s still catches it.
    let n = 0
    let ms = Infinity
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now()
      n = 0
      for (let i = 0; i < D; i++) if (hit(row(`d${i}`), ix, () => '')) n++
      ms = Math.min(ms, performance.now() - t0)
    }
    check('lineage: a subtree token reaches every row of a deep chain', n === D, String(n))
    check(`lineage: ${D} rows of a ${D}-deep chain match in under 5s, best of 3 (O(depth) per row)`, ms < 5000, `${ms.toFixed(0)}ms`)
    check('lineage: a spawn cycle ends at main', lineageOf(ix, 'y0').up === null && lineageOf(ix, 'y1').up === null)
    check(
      'lineage: cycle members match only their own subtree',
      hit(row('y0'), ix, () => '') === false && matcher(new URLSearchParams(`agent=${sess}:y1*`))(row('y1'), ix, () => '') === true,
    )
    const kids = agentTree(ix).children.map((c) => c.id)
    check('lineage: the tree hangs the chain and both cycle members off main', same(kids, ['d0', 'y0', 'y1']), JSON.stringify(kids))
    parents.set('y1', 'd5')
    ix.links++
    check('lineage: a new link recorded invalidates the cache', lineageOf(ix, 'y1').up?.id === 'd5' && hit(row('y1'), ix, () => ''))
  }

  const status = async (path: string) => (await fetch(`${BASE}${path}`)).status
  const withWal = [S1, S2, NE, M1, P1, P2, I1, I2, G1, G2, G3, T1, T2, TK, TO]
  for (const qs of ['ids=', '']) {
    const every = await events(`${qs}${qs ? '&' : ''}limit=500`)
    const rowSess = [...new Set(every.rows.map((r) => r.sess))].sort()
    check(
      `empty pick (${qs || 'no ids'}) is every session with a WAL`,
      same(rowSess, [...withWal].sort()) && same([...every.sessions].sort(), [...withWal].sort()),
      JSON.stringify([rowSess, every.sessions]),
    )
    check(
      `empty pick (${qs || 'no ids'}) skips a transcript-only session`,
      !every.sessions.includes(LATE) && !every.unknown.includes(LATE) && every.unknown.length === 0,
      JSON.stringify([every.sessions, every.unknown]),
    )
  }
  const one = await events(`ids=${T1}&limit=500`)
  check(
    'facets are scoped to a one-session pick',
    same(
      one.agents.map((a) => a.sess),
      [T1],
    ) &&
      same(one.sessions, [T1]) &&
      one.rows.every((r) => r.sess === T1) &&
      same(one.tools, ['Agent', 'Read', 'Grep']) &&
      !one.tools.includes('Bash') &&
      !one.events.includes('UserPromptSubmit'),
    JSON.stringify([one.agents.map((a) => a.sess), one.sessions, one.tools, one.events]),
  )
  const ne = await events(`ids=${NE}&limit=500`)
  check(
    'cats include session for a row with no event',
    same(ne.cats, ['tool', 'session']) && ne.events.every((e) => catOf(e) !== 'session'),
    JSON.stringify([ne.cats, ne.events]),
  )
  const m1 = await events(`ids=${M1}&limit=500`)
  check(
    'cats are scoped to the pick and ignore the filter',
    !ne.cats.includes('mcp') && same(m1.cats, ['tool', 'mcp', 'fail']) && same((await events(`ids=${M1}&cat=fail`)).cats, m1.cats),
    JSON.stringify([ne.cats, m1.cats]),
  )
  check('invalid id is 400', (await status('/events?ids=../etc')) === 400)
  const partial = await events(`ids=${S1},${sid(99)}&limit=3`)
  check('unknown id is skipped and reported', same(partial.unknown, [sid(99)]) && partial.head === `${S1}:4` && partial.total === 4, JSON.stringify(partial))
  const later = await events(`ids=${S1},${sid(99)}&limit=1&before=${partial.next}`)
  check('a later page reports it too', same(later.unknown, [sid(99)]) && later.rows.length === 1, JSON.stringify(later))
  const twice = await events(`ids=${S1},${S1}`)
  check('a repeated id is picked once', twice.head === `${S1}:4` && twice.total === 4, JSON.stringify({ head: twice.head, total: twice.total }))

  // Re-read: the sessions picked since `all` may have evicted S1/S2's indexes, giving them new gens.
  const cur = await events(BOTH)
  const record = async (id: string, seq: number, gen = cur.gens[id]) => fetch(`${BASE}/record?id=${id}&seq=${seq}&gen=${gen}`)
  const rec5 = (await (await record(S2, 1)).json()) as WalRecord
  check('/record reads the right line of its session', rec5.tool_name === 'Read' && rec5.duration_ms === 20, JSON.stringify(rec5))
  const rec7 = (await (await record(S2, 3)).json()) as WalRecord
  check('/record of the last line', rec7.event === 'PostToolUseFailure', JSON.stringify(rec7))
  const rec0 = (await (await record(S1, 0)).json()) as WalRecord
  check('/record keeps multibyte text intact', rec0.payload?.prompt === 'zażółć gęślą jaźń', JSON.stringify(rec0))
  const rec3 = (await (await record(S1, 3)).json()) as WalRecord
  check('/record of an unparseable line', rec3.event === 'Unparseable' && rec3.payload?.line === 'this is not json', JSON.stringify(rec3))
  check('/record out of range is 404', (await record(S1, 99)).status === 404)
  check('/record with a stale gen is 409', (await record(S2, 1, must(cur.gens[S2]) - 1)).status === 409)
  check('/record with an invalid id is 400', (await status(`/record?id=nope&seq=0&gen=${cur.gens[S1]}`)) === 400)
  check('/record of an unknown session is 404', (await status(`/record?id=${sid(99)}&seq=0&gen=1`)) === 404)

  // fetch() normalises `%2e%2e` away before sending, so the guard only sees a raw path via node:http.
  const rawStatus = (path: string) =>
    new Promise<number | undefined>((ok, fail) => {
      const req = request({ host: '127.0.0.1', port: new URL(BASE).port, path }, (r) => {
        r.resume()
        ok(r.statusCode)
      })
      req.on('error', fail).end()
    })
  check('static: encoded traversal is refused', (await status('/%2e%2e/package.json')) === 404 && (await rawStatus('/..%2f..%2fpackage.json')) === 404)
  check('static: malformed escape is refused', (await status('/%E0%A4%A')) === 404)
  check('static: unknown file is 404', (await status('/nope.js')) === 404)
  const home = await fetch(`${BASE}/`)
  const html = await home.text()
  check(
    'static: / serves the built page',
    home.status === 200 && (home.headers.get('content-type') ?? '').startsWith('text/html') && html.includes('id="root"'),
    `${home.status}`,
  )
  const asset = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1]
  check(
    'static: built script is served as JavaScript',
    !!asset && (await fetch(`${BASE}${asset}`)).headers.get('content-type')?.startsWith('text/javascript') === true,
    String(asset),
  )

  const MB = `ids=${M1}`
  const mk = (seq: number): string => `${M1}:${seq}`
  const m = await events(MB)
  const row = (seq: number): Row =>
    must(
      m.rows.find((r) => r.seq === seq),
      `row ${seq}`,
    )
  check('mcp: head counts a call row per Post', m.head === `${M1}:12` && m.total === 12, `${m.head} ${m.total}`)
  check('mcp: Pre is marked request', row(0).mcp === 'request' && row(0).cat === 'tool' && !('err' in row(0)), JSON.stringify(row(0)))
  check('mcp: Post is marked response', row(2).mcp === 'response' && !('virtual' in row(2)), JSON.stringify(row(2)))
  check('mcp: Failure is a response with an error flag', row(6).mcp === 'response' && row(6).err === true && row(6).cat === 'fail', JSON.stringify(row(6)))
  check('mcp: non-mcp tool rows carry no marker', !('mcp' in row(1)) && !('mcp' in row(8)), JSON.stringify([row(1), row(8)]))
  check(
    "mcp: call row follows its Post, at its Pre's time",
    same(row(3), { sess: M1, seq: 3, cat: 'mcp', t: row(0).t, event: 'MCP call', tool: FIND, dur: 120, virtual: { pre: 0, post: 2 } }),
    JSON.stringify(row(3)),
  )
  check(
    'mcp: failed call row carries err',
    row(7).event === 'MCP call' && row(7).err === true && row(7).dur === 50 && same(row(7).virtual, { pre: 4, post: 6 }),
    JSON.stringify(row(7)),
  )
  check('mcp: orphan Pre stays a plain request row', row(5).mcp === 'request' && !m.rows.some((r) => r.virtual?.pre === 5), JSON.stringify(row(5)))
  check(
    'mcp: Post without a Pre gets a call row at the Post time, with no virtual',
    row(10).mcp === 'response' && row(11).event === 'MCP call' && row(11).t === row(10).t && !('virtual' in row(11)),
    JSON.stringify([row(10), row(11)]),
  )
  check('mcp: counts include the mcp category', m.counts.mcp === 2, JSON.stringify(m.counts))
  await expectKeys('mcp: cat filter', `${MB}&cat=mcp`, [11, 3].map(mk))
  await expectKeys('mcp: tool filter includes the call row', `${MB}&tool=${FIND}`, [11, 10, 2, 3, 0].map(mk))
  await expectKeys('mcp: q matches the call row through its Post', `${MB}&q=quota`, [6, 7].map(mk))
  await expectKeys('mcp: cursor before the call row', `${MB}&before=${row(3).t}.${M1}.3`, [0].map(mk))
  await expectKeys('mcp: cursor after the call row', `${MB}&before=${row(4).t}.${M1}.4`, [2, 9, 1, 3, 0].map(mk))
  const mseen = await pageAll(MB, 1)
  check('mcp: limit=1 paging returns every seq once', same(mseen.seen, [11, 10, 8, 6, 5, 7, 4, 2, 9, 1, 3, 0].map(mk)), JSON.stringify(mseen.seen))
  check('mcp: pairing survives a merge with another session', (await events(`ids=${M1},${S1}&cat=mcp`)).total === 2)

  // Loose on purpose: one shape covers the plain record and the paired call record.
  interface Part {
    event?: string
    payload: { tool_input: { searchText: string }; tool_response: [{ text: string }]; error?: string }
  }
  interface CallBody {
    virtual?: boolean
    event?: string
    pre: Part
    post: Part
  }
  const mrecord = async (seq: number) => (await (await record(M1, seq, m.gens[M1])).json()) as CallBody
  const call = await mrecord(3)
  check(
    'mcp: /record of a call row pairs both records',
    call.virtual === true && call.pre.payload.tool_input.searchText === 'milk' && call.post.payload.tool_response[0].text === 'Buy milk',
    JSON.stringify(call),
  )
  const failed = await mrecord(7)
  check(
    'mcp: /record of a failed call carries the error',
    failed.pre.event === 'PreToolUse' && failed.post.payload.error === 'boom quota',
    JSON.stringify(failed),
  )
  const plain = await mrecord(2)
  check('mcp: /record of a raw Post is the plain record', plain.event === 'PostToolUse' && !('virtual' in plain), JSON.stringify(plain))

  const p1 = await events(`ids=${P1}`)
  const preRow = must(
    p1.rows.find((r) => r.event === 'PreToolUse'),
    'Pre row',
  )
  const calls = p1.rows.filter((r) => r.event === 'Tool call')
  check(
    'call row: one per Bash pair, cat tool, at the Pre time, pointing at the Pre and Post',
    calls.length === 1 && calls[0]?.cat === 'tool' && calls[0]?.t === preRow.t && same(calls[0]?.virtual, { pre: 0, post: 1 }),
    JSON.stringify(p1.rows),
  )
  const pRecord = async (id: string, gen: number | undefined, seq: number) => (await (await record(id, seq, gen)).json()) as Record<string, unknown>
  const callBody = await pRecord(P1, p1.gens[P1], must(calls[0], 'call row').seq)
  check(
    '/record of a call row pairs the WAL records and carries the call',
    callBody.virtual === true &&
      same(callBody.pre, JSON.parse(PRE)) &&
      same(callBody.post, JSON.parse(POST)) &&
      (callBody.call as CallRecord | undefined)?.tuid === 'tP',
    JSON.stringify(callBody),
  )
  check('/record of an ev row is the plain WAL record', same(await pRecord(P1, p1.gens[P1], 0), JSON.parse(PRE)))

  await expectKeys('search: a derived key is not searched', `ids=${P1}&q=woff`, [])
  await expectKeys(
    'search: text only in a call input matches its Pre row and call row',
    `ids=${P1}&q=zqx-only`,
    [2, 0].map((n) => `${P1}:${n}`),
  )

  const noWal = await events(`ids=${TR}&limit=500`)
  check(
    'no WAL: the transcript gives Tool call and UserPromptSubmit rows',
    noWal.rows.some((r) => r.event === 'Tool call') && noWal.rows.some((r) => r.event === 'UserPromptSubmit'),
    JSON.stringify(noWal.events),
  )
  const trBytes = statSync(join(proj, `${TR}.jsonl`)).size
  check(
    'no WAL: pipe reports the transcript bytes read and nothing stale',
    same(noWal.pipe[TR], { done: trBytes, total: trBytes, stale: null }),
    JSON.stringify(noWal.pipe),
  )
  const noWalCall = await pRecord(
    TR,
    noWal.gens[TR],
    must(
      noWal.rows.find((r) => r.event === 'Tool call'),
      'transcript call row',
    ).seq,
  )
  check('no WAL: /record of a call row is { call } with no virtual', same(Object.keys(noWalCall), ['call']), JSON.stringify(noWalCall))

  const joined = await until(async () => {
    const page = await events(`ids=${TK}&limit=500`)
    if (!page.rows.some((r) => r.out !== undefined && r.event === 'Stop')) throw new Error('no tokens yet')
    return page
  })
  const tokCall = joined.rows.find((r) => r.event === 'Tool call')
  const tokStop = joined.rows.find((r) => r.event === 'Stop')
  check('tokens: a call row returns out and res', tokCall?.out === 903 && tokCall.res === 401, JSON.stringify(tokCall))
  check('tokens: a Stop row returns out and no res', tokStop?.out === 41 && !('res' in tokStop), JSON.stringify(tokStop))
  check(
    'tokens: the two tok entries take seqs but are in no row, total, count, event or cat',
    joined.head === `${TK}:6` &&
      joined.rows.length === 4 &&
      joined.total === 4 &&
      same(joined.counts, { turn: 1, tool: 3 }) &&
      same(joined.events, ['PreToolUse', 'PostToolUse', 'Tool call', 'Stop']) &&
      same(joined.cats, ['tool', 'turn']),
    JSON.stringify([joined.head, joined.total, joined.counts, joined.events, joined.cats]),
  )
  const rowSeqs = new Set(joined.rows.map((r) => r.seq))
  const tokSeq = [0, 1, 2, 3, 4, 5].find((n) => !rowSeqs.has(n))
  const tokRecord = await record(TK, must(tokSeq, 'a seq in no row'), joined.gens[TK])
  check(
    'tokens: /record of a tok entry is 404 no such record',
    tokRecord.status === 404 && (await tokRecord.text()) === 'no such record',
    String(tokRecord.status),
  )

  const hand = join(dir, 'hand-target.jsonl')
  const handCall = {
    k: 'call',
    tuid: 'th',
    t: 1,
    end: 2,
    dur: 1,
    tool: 'Read',
    mcp: false,
    err: false,
    agent: null,
    agentType: null,
    input: {},
    response: 'ok',
  }
  writeFileSync(hand, [handCall, { k: 'tok', tuid: 'th', out: 10, res: 7 }, { k: 'tok', tuid: 'th', out: 12 }].map((r) => `${JSON.stringify(r)}\n`).join(''))
  const twoToks = createWalIndex(sid(19), hand).entries[0]
  check('tokens: the last tok sets out and res, a res it lacks to null', twoToks?.out === 12 && twoToks.res === null, JSON.stringify(twoToks))

  // `<event> <tool>:<Total>`, `-` for no numbers.
  const lab = (r: Row): string => `${r.event}${r.tool ? ` ${r.tool}` : ''}:${r.out === undefined ? '-' : r.out + (r.res ?? 0)}`
  const OB = `ids=${TO}`
  const timed = await until(async () => {
    const page = await events(`${OB}&limit=500`)
    if (page.rows.filter((r) => r.out !== undefined).length < 5) throw new Error('no tokens yet')
    return page
  })
  const labOf = new Map(timed.rows.map((r) => [key(r), lab(r)]))
  const labels = (keys: string[]): string[] => keys.map((k) => labOf.get(k) ?? k)
  const TIME = [
    'Stop:5',
    'Tool call Edit:-',
    'PostToolUse Edit:-',
    'PreToolUse Edit:-',
    'PostToolUse Bash:-',
    'Tool call Bash:50',
    'PreToolUse Bash:-',
    'PostToolUse Glob:-',
    'Tool call Glob:900',
    'PreToolUse Glob:-',
    'PostToolUse Grep:-',
    'PostToolUse Read:-',
    'Tool call Grep:150',
    'Tool call Read:150',
    'PreToolUse Grep:-',
    'PreToolUse Read:-',
  ]
  const TOKS = ['Tool call Glob:900', 'Tool call Grep:150', 'Tool call Read:150', 'Tool call Bash:50', 'Stop:5', ...TIME.filter((l) => l.endsWith(':-'))]
  const expectLabels = async (label: string, qs: string, want: string[]): Promise<void> => {
    const got = labels(await keysOf(`${OB}&${qs}`))
    check(`${label} (${qs})`, same(got, want), `got [${got}], want [${want}]`)
  }
  check('tokens order: the fixture rows in time order', same(timed.rows.map(lab), TIME), JSON.stringify(timed.rows.map(lab)))
  await expectLabels('min_tok excludes rows with no numbers by default', 'min_tok=150', ['Tool call Glob:900', 'Tool call Grep:150', 'Tool call Read:150'])
  await expectLabels('max_tok is inclusive', 'max_tok=150', ['Stop:5', 'Tool call Bash:50', 'Tool call Grep:150', 'Tool call Read:150'])
  await expectLabels('max_tok on an output-only Total', 'max_tok=5', ['Stop:5'])
  await expectLabels('min_tok and max_tok', 'min_tok=50&max_tok=150', ['Tool call Bash:50', 'Tool call Grep:150', 'Tool call Read:150'])
  await expectLabels(
    'min_tok notok=include keeps rows with no numbers',
    'min_tok=150&notok=include',
    TIME.filter((l) => l.endsWith(':-') || Number(l.split(':').pop()) >= 150),
  )
  await expectLabels('notok alone does not filter', 'notok=include', TIME)

  for (const n of [1, 2, 5]) {
    const sorted = await pageAll(`${OB}&sort=tokens`, n)
    check(
      `sort=tokens: limit=${n} pages give one sorted list, ties by time then seq, no data last`,
      same(labels(sorted.seen), TOKS),
      JSON.stringify(labels(sorted.seen)),
    )
  }
  const ZQ = ['Tool call Glob:900', 'Tool call Read:150', 'Tool call Edit:-', 'PreToolUse Edit:-', 'PreToolUse Glob:-', 'PreToolUse Read:-']
  for (const [qs, want] of [
    ['tool=Read,Grep,Edit', TOKS.filter((l) => /(Read|Grep|Edit):/.test(l))],
    ['q=zebra', ZQ],
    ['tool=Read,Edit&q=zebra', ZQ.filter((l) => /(Read|Edit):/.test(l))],
  ] as const) {
    for (const n of [1, 2]) {
      const got = labels((await pageAll(`${OB}&sort=tokens&${qs}`, n)).seen)
      check(`sort=tokens with ${qs}, limit=${n}`, same(got, want), JSON.stringify(got))
    }
  }
  const qFirst = await events(`${OB}&sort=tokens&q=zebra&limit=2`)
  check('sort=tokens with q: the first page counts every match', qFirst.total === ZQ.length, String(qFirst.total))
  check('no sort: time order paged', same(labels((await pageAll(OB, 3)).seen), TIME), JSON.stringify(labels((await pageAll(OB, 3)).seen)))

  const proto = await events(`ids=${P2}`)
  check(
    'prototype key: an event named constructor is a session row with no mcp marker',
    proto.rows.length === 1 && proto.rows[0]?.cat === 'session' && !('mcp' in (proto.rows[0] ?? {})),
    JSON.stringify(proto.rows),
  )

  const empty = await events(`ids=${LATE}`)
  check(
    'missing WAL: /events answers with nothing',
    empty.total === 0 && empty.head === `${LATE}:0` && empty.rows.length === 0 && same(empty.sessions, []),
    JSON.stringify(empty),
  )
  writeFileSync(walOf(LATE), `${JSON.stringify({ ts: '2026-09-30T10:00:00.000Z', event: 'SessionStart', session_id: LATE })}\n`)
  const first = await events(`ids=${LATE}`)
  check('missing WAL: a file created later is picked up', first.total === 1 && first.rows[0]?.event === 'SessionStart', JSON.stringify(first))

  // Budget 0 reads one chunk per request, so a WAL of many chunks needs many requests.
  const BUDGET = sid(16)
  const PAIRS = 1500
  const pad = 'x'.repeat(150)
  const wal: string[] = []
  for (let i = 0; i < PAIRS; i++) {
    const base = { session_id: BUDGET, tool_name: 'Bash', tool_use_id: `b${i}`, payload: { pad } }
    const sec = String(i % 60).padStart(2, '0')
    wal.push(JSON.stringify({ ts: `2026-09-29T09:${sec}:00.000Z`, event: 'PreToolUse', ...base }))
    wal.push(JSON.stringify({ ts: `2026-09-29T09:${sec}:01.000Z`, event: 'PostToolUse', duration_ms: 1, ...base }))
  }
  const proj2 = join(dir2, '.claude', 'projects', '-tmp-b')
  mkdirSync(proj2, { recursive: true })
  writeFileSync(join(proj2, `${BUDGET}.jsonl`), '')
  writeFileSync(join(proj2, `${BUDGET}.wal.jsonl`), `${wal.join('\n')}\n`)
  if (statSync(join(proj2, `${BUDGET}.wal.jsonl`)).size < 8 * 64 * 1024) throw new Error('budget WAL is under 8 chunks')
  const WANT = PAIRS * 3

  const budgeted = async (label: string, base: string): Promise<void> => {
    const get = async (): Promise<FirstPage> => {
      const r = await fetch(`${base}/events?ids=${BUDGET}&limit=1`)
      if (!r.ok) throw new Error(`status ${r.status}`)
      return (await r.json()) as FirstPage
    }
    const firstPage = await get()
    const first = firstPage.pipe[BUDGET]
    check(`${label}: the first page is partial`, first !== undefined && first.done < first.total, JSON.stringify(firstPage.pipe))
    let page = firstPage
    for (let i = 0; i < 100 && page.pipe[BUDGET]?.done !== page.pipe[BUDGET]?.total; i++) page = await get()
    check(
      `${label}: repeated requests complete it, with a row per WAL line and call`,
      page.pipe[BUDGET]?.done === page.pipe[BUDGET]?.total && page.total === WANT,
      JSON.stringify([page.pipe, page.total]),
    )
  }
  // No background build: its first tick would race the first request and could finish the WAL before it.
  const env2 = { HOME: dir2, WAL_SYNC_BUDGET_MS: '0', WAL_NO_BUILD: '1' }
  const second = await startServer([], env2)
  try {
    await budgeted('budget 0', second.base)
  } finally {
    second.server.kill()
    await new Promise((r) => second.server.once('exit', r))
  }
  const third = await startServer([], env2)
  try {
    await budgeted('budget 0, restarted over the built target', third.base)
  } finally {
    third.server.kill()
  }
} catch (err) {
  console.log(`  FAIL harness error — ${(err as Error).message}`)
  fail = 1
} finally {
  server.kill()
  rmSync(dir, { recursive: true, force: true })
  rmSync(dir2, { recursive: true, force: true })
}

console.log(fail ? '\nFAILED' : '\nall checks passed')
process.exit(fail)
