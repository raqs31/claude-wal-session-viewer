#!/usr/bin/env node
// live-tail.test.ts — proves the viewer actually follows growing per-session WALs.
//
// Exercises the paths a header check cannot reach: appended lines reaching a connected client,
// two files growing at once arriving in time order, a record written in two parts arriving once
// and intact, a truncated, replaced or deleted WAL freezing its target, and the per-client filter
// on live rows, and the token patches and held rows a `tok` record makes.

import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { get, type IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FirstPage, Row, WalRecord } from '../shared/api.ts'
import { startServer } from './test-server.ts'

const dir = mkdtempSync(join(tmpdir(), 'waltail.'))
const proj = join(dir, '.claude', 'projects', '-tmp-live')
mkdirSync(proj, { recursive: true })
const L1 = 'bbbbbbbb-0000-4000-8000-000000000001'
const L2 = 'bbbbbbbb-0000-4000-8000-000000000002'
const wal1 = join(proj, `${L1}.wal.jsonl`)
const wal2 = join(proj, `${L2}.wal.jsonl`)
// Sessions for the empty-pick stream check only, so no other check counts their rows.
const L3 = 'bbbbbbbb-0000-4000-8000-000000000003'
const L4 = 'bbbbbbbb-0000-4000-8000-000000000004'
const wal3 = join(proj, `${L3}.wal.jsonl`)
const wal4 = join(proj, `${L4}.wal.jsonl`)
for (const id of [L1, L2, L3, L4]) writeFileSync(join(proj, `${id}.jsonl`), '')

let clock = Date.now()
// Strictly increasing timestamps, so the merge order is known regardless of wall-clock ties.
const rec = (o: Record<string, unknown>): string => `${JSON.stringify({ ts: new Date(++clock).toISOString(), ...o })}\n`
writeFileSync(wal1, rec({ event: 'SessionStart', session_id: L1 }))
writeFileSync(wal3, rec({ event: 'SessionStart', session_id: L3 }))
writeFileSync(wal4, rec({ event: 'SessionStart', session_id: L4 }))

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

const BOTH = `ids=${L1},${L2}`
const events = async (qs = BOTH): Promise<FirstPage> => {
  const r = await fetch(`${BASE}/events?${qs}`)
  if (!r.ok) throw new Error(`status ${r.status}`)
  return (await r.json()) as FirstPage
}
const record = async (p: FirstPage, r: Row | undefined): Promise<WalRecord> =>
  (await (await fetch(`${BASE}/record?id=${r?.sess}&seq=${r?.seq}&gen=${p.gens[r?.sess ?? '']}`)).json()) as WalRecord
const gensOf = (p: FirstPage): string =>
  Object.entries(p.gens)
    .map(([id, g]) => `${id}:${g}`)
    .join(',')
// The stream query for "everything after this page", as the page builds it.
const after = (p: FirstPage, qs = BOTH): string => `${qs}&after=${p.head}&gens=${gensOf(p)}`
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const must = <T>(v: T | undefined | null, what = 'value'): T => {
  if (v == null) throw new Error(`missing ${what}`)
  return v
}

// Frames are buffered to the blank line that ends them: `id:` and `data:` can arrive in separate
// chunks.
interface Stream {
  rows: Row[]
  resets: number
  // The data of each `stale` frame, as sent.
  stale: string[]
  // Every frame with an event or data: `retry` lines are not counted.
  frames: number
  lastId: string | null
  unknown: string[] | null
  // The patches of every `tokens` frame, in order, and how many of those frames carried an `id:` line.
  tokens: Pick<Row, 'sess' | 'seq' | 'out' | 'res'>[]
  tokenIds: number
  res?: IncomingMessage
}
const streams: Stream[] = []
const open = (qs: string, headers: Record<string, string> = {}): Promise<Stream> =>
  new Promise((resolve, reject) => {
    const s: Stream = { rows: [], resets: 0, stale: [], frames: 0, lastId: null, unknown: null, tokens: [], tokenIds: 0 }
    const req = get(`${BASE}/events-stream?${qs}`, { headers }, (res) => {
      s.res = res
      let pending = ''
      res.setEncoding('utf8')
      res.on('data', (c) => {
        pending += c
        for (let end = pending.indexOf('\n\n'); end !== -1; end = pending.indexOf('\n\n')) {
          const frame = pending.slice(0, end)
          pending = pending.slice(end + 2)
          const f: Record<string, string> = Object.fromEntries(
            frame.split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trimStart()]),
          )
          if (f.event !== undefined || f.data !== undefined) s.frames++
          if (f.event === 'reset') s.resets++
          else if (f.event === 'stale') s.stale.push(must(f.data, 'stale event data'))
          else if (f.event === 'unknown') s.unknown = JSON.parse(must(f.data, 'unknown event data')) as string[]
          else if (f.event === 'tokens') {
            s.tokens.push(...(JSON.parse(must(f.data, 'tokens event data')) as Stream['tokens']))
            if (f.id !== undefined) s.tokenIds++
          } else if (f.data) {
            s.rows.push(...(JSON.parse(f.data) as Row[]))
            s.lastId = f.id ?? null
          }
        }
      })
      streams.push(s)
      resolve(s)
    })
    req.on('error', reject)
  })

try {
  console.log('live-tail.test.ts')

  const first = await until(() => events())
  check('first page returns the seeded event', first.rows.length === 1 && first.head === `${L1}:1,${L2}:0`, JSON.stringify(first))

  const s = await open(after(first))
  await wait(400)
  check('no replay of pre-existing events', s.rows.length === 0, `got ${s.rows.length}`)
  const ZERO = '0'.repeat(36)
  const lone = await open(`ids=${L1},${ZERO}`)
  await wait(300)
  check('a stream opens with an unknown event naming the skipped ids', lone.unknown?.join() === ZERO, JSON.stringify(lone.unknown))

  appendFileSync(wal1, rec({ event: 'PreToolUse', tool_name: 'Bash' }))
  await wait(700)
  check('appended event reaches the client', s.rows.length === 1, `got ${s.rows.length}`)
  check('first streamed row is the next one (no gap)', s.rows[0]?.sess === L1 && s.rows[0]?.seq === 1, JSON.stringify(s.rows[0]))
  check('frame id is the position vector', s.lastId === `${L1}:2,${L2}:0`, `id ${s.lastId}`)
  check('appended event is intact', (await record(first, s.rows[0])).tool_name === 'Bash')

  // Both files grow between two ticks; the frame interleaves them by time.
  appendFileSync(wal2, rec({ event: 'UserPromptSubmit', session_id: L2 }))
  appendFileSync(wal1, rec({ event: 'PostToolUse', tool_name: 'Bash', duration_ms: 3 }))
  appendFileSync(wal2, rec({ event: 'PreToolUse', tool_name: 'Read' }) + rec({ event: 'PostToolUse', tool_name: 'Read', duration_ms: 4 }))
  appendFileSync(wal1, rec({ event: 'Stop' }))
  await wait(700)
  const got = s.rows
    .slice(1)
    .map((r) => `${r.sess === L1 ? 'a' : 'b'}${r.seq}`)
    .join()
  check('two files growing at once reach one stream in time order', got === 'b0,a2,b1,b2,a3', got)
  check('rows of both files are intact', (await record(first, s.rows[1])).event === 'UserPromptSubmit' && (await record(first, s.rows[4])).duration_ms === 4)
  check('frame id advances both positions', s.lastId === `${L1}:4,${L2}:3`, `id ${s.lastId}`)
  check('/events head agrees with the stream', (await events()).head === s.lastId)

  // A record caught mid-write must not arrive split in two.
  const half = rec({ event: 'PostToolUse', tool_name: 'Read', duration_ms: 42 })
  appendFileSync(wal2, half.slice(0, 30))
  await wait(600)
  check('partial line is held back', s.rows.length === 6, `got ${s.rows.length}`)
  appendFileSync(wal2, half.slice(30))
  await wait(700)
  check('completed line arrives once', s.rows.length === 7, `got ${s.rows.length}`)
  check('reassembled line is intact', (await record(first, s.rows[6])).duration_ms === 42)

  // The browser reconnects with the original URL; Last-Event-ID must stop the replay.
  const again = await open(after(first), { 'last-event-id': must(s.lastId, 'last event id') })
  await wait(600)
  check('Last-Event-ID resume replays nothing', again.rows.length === 0, `got ${again.rows.length}`)
  const behind = await open(after(first), { 'last-event-id': `${L1}:4,${L2}:2` })
  await wait(600)
  check(
    'Last-Event-ID resume sends only what that position lacks',
    behind.rows.map((r) => `${r.sess === L1 ? 'a' : 'b'}${r.seq}`).join() === 'b2,b3',
    JSON.stringify(behind.rows),
  )

  const reads = await open(after(await events(), `${BOTH}&tool=Read`))
  const needle = await open(after(await events(), `${BOTH}&q=${encodeURIComponent('żółw')}`))
  const only2 = await open(after(await events(`ids=${L2}`), `ids=${L2}`))
  appendFileSync(wal1, rec({ event: 'PreToolUse', tool_name: 'Bash', payload: { cmd: 'zażółć' } }))
  appendFileSync(wal2, rec({ event: 'PreToolUse', tool_name: 'Read', payload: { file: 'ŻÓŁW.md' } }))
  await wait(700)
  check('tool=Read stream gets the Read row only', reads.rows.map((r) => r.tool).join() === 'Read', JSON.stringify(reads.rows))
  check('q stream gets the matching row only', needle.rows.map((r) => r.tool).join() === 'Read', JSON.stringify(needle.rows))
  check('unfiltered streams get both rows', s.rows.length === 9 && again.rows.length === 2, `${s.rows.length}, ${again.rows.length}`)
  check('a one-session stream gets only its rows', only2.rows.length === 1 && only2.rows[0]?.sess === L2, JSON.stringify(only2.rows))

  const notRead = await open(after(await events(), `${BOTH}&tool_not=Read`))
  appendFileSync(wal2, rec({ event: 'PreToolUse', tool_name: 'Read' }) + rec({ event: 'PreToolUse', tool_name: 'Glob' }) + rec({ event: 'Stop' }))
  await wait(700)
  check(
    'tool_not stream drops Read and passes a tool absent at open and the no-tool row',
    notRead.rows.map((r) => r.tool ?? '-').join() === 'Glob,-',
    JSON.stringify(notRead.rows),
  )

  const agents = await open(after(await events(), `${BOTH}&agent=${L2}:ag9`))
  const other = await open(after(await events(), `${BOTH}&agent=${L1}:ag9`))
  appendFileSync(wal2, rec({ event: 'SubagentStart', agent_id: 'ag9', agent_type: 'Explore' }) + rec({ event: 'Stop' }))
  await wait(700)
  check('agent filter applies to live rows', agents.rows.map((r) => r.event).join() === 'SubagentStart', JSON.stringify(agents.rows))
  check('an agent token is scoped to its session', other.rows.length === 0, JSON.stringify(other.rows))

  // A subtree token resolves per row, so an agent spawned after the stream opened falls inside it.
  const sub = await open(after(await events(), `${BOTH}&agent=${L2}:ag9*`))
  appendFileSync(
    wal2,
    rec({ event: 'PostToolUse', agent_id: 'ag9', agent_type: 'Explore', tool_name: 'Agent', payload: { tool_response: { agentId: 'kid' } } }) +
      rec({ event: 'PreToolUse', agent_id: 'kid', agent_type: 'Plan', tool_name: 'Read' }) +
      rec({ event: 'SubagentStop', agent_id: 'sum', agent_type: '', payload: { background_tasks: [{ id: 'kid', type: 'subagent', status: 'running' }] } }) +
      rec({ event: 'Stop' }),
  )
  await wait(700)
  check(
    'subtree filter streams a later-spawned child and its summary',
    sub.rows.map((r) => r.event).join() === 'PostToolUse,PreToolUse,SubagentStop',
    JSON.stringify(sub.rows),
  )

  // Pre and Post land in separate ticks, so the pairing has to survive between tail() calls.
  const FIND = 'mcp__claude_ai_Todoist__find-tasks'
  const mcpAll = await open(after(await events()))
  const mcpOnly = await open(after(await events(), `${BOTH}&cat=mcp`))
  appendFileSync(wal1, rec({ event: 'PreToolUse', tool_name: FIND, tool_use_id: 'live1', payload: { tool_input: { searchText: 'milk' } } }))
  await wait(700)
  check(
    'mcp Pre arrives alone, marked request',
    mcpAll.rows.length === 1 && mcpAll.rows[0]?.mcp === 'request' && mcpOnly.rows.length === 0,
    JSON.stringify(mcpAll.rows),
  )
  appendFileSync(
    wal1,
    rec({ event: 'PostToolUse', tool_name: FIND, tool_use_id: 'live1', duration_ms: 7, payload: { tool_response: [{ type: 'text', text: 'Buy milk' }] } }),
  )
  await wait(700)
  const byEvent = (rows: Row[], event: string): Row | undefined => rows.find((r) => r.event === event)
  const [pre, post, call] = ['PreToolUse', 'PostToolUse', 'MCP call'].map((e) => byEvent(mcpAll.rows, e))
  check('Post and its call row arrive once', mcpAll.rows.length === 3 && [pre, post, call].every((r) => r !== undefined), JSON.stringify(mcpAll.rows))
  check(
    'streamed call row pairs the streamed seqs',
    call?.sess === L1 && call?.seq === (post?.seq ?? NaN) + 1 && call?.virtual?.pre === pre?.seq && call?.virtual?.post === post?.seq,
    JSON.stringify(call),
  )
  check(
    'cat=mcp stream gets only the call row',
    mcpOnly.rows.map((r) => r.event).join() === 'MCP call' && mcpOnly.rows[0]?.seq === call?.seq,
    JSON.stringify(mcpOnly.rows),
  )

  // A session of its own per case: once a target is frozen, later WAL writes never reach Events.
  let made = 4
  const session = (...records: string[]): { id: string; wal: string } => {
    const id = `bbbbbbbb-0000-4000-8000-${String(++made).padStart(12, '0')}`
    const wal = join(proj, `${id}.wal.jsonl`)
    writeFileSync(join(proj, `${id}.jsonl`), '')
    writeFileSync(wal, records.join(''))
    return { id, wal }
  }
  const trio = (): string[] => [
    rec({ event: 'SessionStart' }),
    rec({ event: 'PreToolUse', tool_name: 'Bash' }),
    rec({ event: 'PostToolUse', tool_name: 'Bash', duration_ms: 2 }),
  ]
  const staleOf = (id: string, reason: string): string => JSON.stringify({ sess: id, reason })

  // Truncation freezes the target of that session only: no reset, and the rows stay.
  const cut = session(...trio())
  const cutBefore = await until(() => events(`ids=${cut.id}`))
  const cutStream = await open(after(cutBefore, `ids=${cut.id}`))
  await wait(400)
  writeFileSync(cut.wal, rec({ event: 'SessionEnd' }))
  await wait(700)
  check(
    'truncation sends one stale frame and no reset',
    cutStream.stale.join() === staleOf(cut.id, 'wal shrank') && cutStream.resets === 0,
    JSON.stringify([cutStream.stale, cutStream.resets]),
  )
  check('a stream not over the truncated file gets neither', only2.stale.length === 0 && only2.resets === 0, JSON.stringify([only2.stale, only2.resets]))
  const cutAfter = await events(`ids=${cut.id}`)
  check(
    're-query keeps the gen, head and rows of the truncated file, and reports it stale',
    cutAfter.gens[cut.id] === cutBefore.gens[cut.id] &&
      cutAfter.head === cutBefore.head &&
      same(cutAfter.rows, cutBefore.rows) &&
      cutAfter.pipe[cut.id]?.stale === 'wal shrank',
    JSON.stringify([cutAfter.gens, cutAfter.head, cutAfter.pipe]),
  )

  // /events can detect the truncation before the tick does; the stream must still hear of it.
  const race = session(...trio())
  const raceBefore = await until(() => events(`ids=${race.id}`))
  const raceStream = await open(after(raceBefore, `ids=${race.id}`))
  await wait(400)
  writeFileSync(race.wal, rec({ event: 'Stop' }))
  const raced = await events(`ids=${race.id}`)
  await wait(600)
  check(
    'truncation found by /events still sends one stale frame and no reset',
    raced.pipe[race.id]?.stale === 'wal shrank' && raceStream.stale.join() === staleOf(race.id, 'wal shrank') && raceStream.resets === 0,
    JSON.stringify([raced.pipe, raceStream.stale, raceStream.resets]),
  )

  // A reconnect opens after the truncation was seen, with the first page's vector: it still hears of it.
  const late = session(...trio())
  const latePage = await until(() => events(`ids=${late.id}`))
  writeFileSync(late.wal, rec({ event: 'Stop' }))
  await events(`ids=${late.id}`)
  const lateStream = await open(after(latePage, `ids=${late.id}`))
  await wait(600)
  check(
    'a stream opened after the truncation was seen sends one stale frame and no reset',
    lateStream.stale.join() === staleOf(late.id, 'wal shrank') && lateStream.resets === 0,
    JSON.stringify([lateStream.stale, lateStream.resets]),
  )

  // Replaced by rename with a longer file: the size never shrinks, only the inode tells.
  const swap = session(...trio())
  const swapBefore = await until(() => events(`ids=${swap.id}`))
  const swapStream = await open(after(swapBefore, `ids=${swap.id}`))
  await wait(400)
  const tmp = join(proj, 'rotate.tmp')
  writeFileSync(tmp, [...trio(), rec({ event: 'Stop' }), rec({ event: 'SessionEnd' })].join(''))
  renameSync(tmp, swap.wal)
  await wait(700)
  const swapped = await events(`ids=${swap.id}`)
  check(
    'a WAL replaced by rename sends one stale frame and no reset, and its rows stay',
    swapStream.stale.join() === staleOf(swap.id, 'wal replaced') &&
      swapStream.resets === 0 &&
      same(swapped.rows, swapBefore.rows) &&
      swapped.pipe[swap.id]?.stale === 'wal replaced',
    JSON.stringify([swapStream.stale, swapStream.resets, swapped.rows.length, swapped.pipe]),
  )

  // A deleted WAL leaves the rows and says nothing, and must not crash the server.
  const gone = session(...trio())
  const goneBefore = await until(() => events(`ids=${gone.id}`))
  const goneStream = await open(after(goneBefore, `ids=${gone.id}`))
  await wait(400)
  rmSync(gone.wal)
  await wait(700)
  check('a deleted WAL sends no frame', goneStream.frames === 0, `frames ${goneStream.frames}`)
  const goneAfter = await events(`ids=${gone.id}`)
  check(
    'a deleted WAL keeps its rows and is not stale',
    same(goneAfter.rows, goneBefore.rows) && goneAfter.head === goneBefore.head && goneAfter.pipe[gone.id]?.stale === null,
    JSON.stringify([goneAfter.rows.length, goneAfter.head, goneAfter.pipe]),
  )

  // Token patches: a transcript whose replies hold the calls, so the observer joins numbers onto the call rows. A
  // reply's prompt is its input plus cache read; a call's numbers are its reply's output and the prompt growth to the
  // next reply. Call t1: out 100, res 1300 - 1000 - 100 = 200 (Total 300). Call t2: out 10, res 1330 - 1300 - 10 = 20.
  const stamp = (): string => new Date(++clock).toISOString()
  const line = (o: Record<string, unknown>): string => `${JSON.stringify({ timestamp: stamp(), ...o })}\n`
  const reply = (n: number, prompt: number, out: number, content: unknown[]): string =>
    line({
      type: 'assistant',
      uuid: `ta${n}`,
      message: { id: `tr${n}`, model: 'm', stop_reason: null, content, usage: { input_tokens: 1, cache_read_input_tokens: prompt - 1, output_tokens: out } },
    })
  const use = (tuid: string, name: string): unknown[] => [{ type: 'tool_use', id: tuid, name, input: {} }]
  const result = (n: number, tuid: string): string =>
    line({ type: 'user', uuid: `tu${n}`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tuid, content: 'ok' }] } })
  const tpre = (tuid: string, tool: string): string => rec({ event: 'PreToolUse', tool_name: tool, tool_use_id: tuid, payload: { tool_input: {} } })
  const tpost = (tuid: string, tool: string): string => rec({ event: 'PostToolUse', tool_name: tool, tool_use_id: tuid, payload: { tool_response: 'ok' } })
  const tk = session(rec({ event: 'SessionStart' }), tpre('toolu_t1', 'Read'))
  const tr = join(proj, `${tk.id}.jsonl`)
  writeFileSync(tr, line({ type: 'user', uuid: 'tu0', message: { role: 'user', content: 'go' } }) + reply(1, 1000, 100, use('toolu_t1', 'Read')))
  const tkq = `ids=${tk.id}`
  const BIG = `${tkq}&min_tok=250`
  const tkPage = await until(() => events(tkq))
  const plain = await open(after(tkPage, tkq))
  const big = await open(after(tkPage, BIG))
  await wait(400)
  // Sent before the Post lands, so the call row's `t` (its Pre's) is older than this row's.
  appendFileSync(tk.wal, rec({ event: 'Notification', payload: { message: 'wait' } }))
  await wait(700)
  appendFileSync(tk.wal, tpost('toolu_t1', 'Read'))
  appendFileSync(tr, result(1, 'toolu_t1'))
  await wait(700)
  const note = plain.rows.find((r) => r.event === 'Notification')
  const call1 = plain.rows.find((r) => r.event === 'Tool call')
  check(
    'a late call row arrives after a row it is older than',
    note !== undefined && call1 !== undefined && plain.rows.indexOf(call1) > plain.rows.indexOf(note) && call1.t < note.t,
    JSON.stringify(plain.rows),
  )
  check(
    'a call row arrives without numbers',
    call1 !== undefined && call1.out === undefined && plain.tokens.length === 0,
    JSON.stringify([call1, plain.tokens]),
  )
  check('with min_tok, a row with no numbers yet is held back', big.rows.length === 0, JSON.stringify(big.rows))
  const beforeTok = must(plain.lastId, 'last event id')
  appendFileSync(tr, reply(2, 1300, 10, use('toolu_t2', 'Bash')))
  await wait(700)
  const patch1 = { sess: tk.id, seq: call1?.seq, out: 100, res: 200 }
  check('a tokens frame follows once the next request lands', same(plain.tokens, [patch1]), JSON.stringify(plain.tokens))
  check(
    'tokens frames carry no id and send no row',
    plain.tokenIds === 0 && plain.lastId === beforeTok && plain.rows.length === 3,
    JSON.stringify([plain.tokenIds, plain.lastId, plain.rows]),
  )
  const held = (s: Stream): string => s.rows.map((r) => `${r.seq}:${r.event}:${r.out}:${r.res}`).join()
  check('with min_tok, the row arrives once its tok makes it match', held(big) === `${call1?.seq}:Tool call:100:200`, held(big))

  // The browser reconnects with the original URL and the id of the last row frame, which is before the tok.
  const replay = await open(after(tkPage, tkq), { 'last-event-id': beforeTok })
  const replayBig = await open(after(tkPage, BIG), { 'last-event-id': beforeTok })
  await wait(700)
  check(
    'a reconnect with Last-Event-ID before a tok still gets its patch',
    same(replay.tokens, [patch1]) && replay.rows.length === 0,
    JSON.stringify([replay.tokens, replay.rows]),
  )
  check('a min_tok reconnect before a tok gets the row it now matches', held(replayBig) === held(big), held(replayBig))

  appendFileSync(tk.wal, tpre('toolu_t2', 'Bash') + tpost('toolu_t2', 'Bash'))
  appendFileSync(tr, result(2, 'toolu_t2'))
  await wait(700)
  const call2 = plain.rows.findLast((r) => r.event === 'Tool call')
  appendFileSync(tr, reply(3, 1330, 5, [{ type: 'text', text: 'done' }]))
  await wait(700)
  check(
    'a second call is patched in its turn',
    call2 !== undefined &&
      call2.seq !== call1?.seq &&
      call2.out === undefined &&
      same(plain.tokens, [patch1, { sess: tk.id, seq: call2.seq, out: 10, res: 20 }]),
    JSON.stringify([call2, plain.tokens]),
  )
  check('with min_tok, a row whose numbers do not match never arrives', held(big) === `${call1?.seq}:Tool call:100:200`, held(big))

  const sorted = await fetch(`${BASE}/events-stream?${tkq}&sort=tokens`)
  check('a sort=tokens stream gets 400', sorted.status === 400, `status ${sorted.status}`)
  await sorted.body?.cancel()

  // An empty pick is every session: the stream follows sessions nobody named.
  const everyone = await open('ids=')
  await wait(400)
  appendFileSync(wal3, rec({ event: 'PreToolUse', tool_name: 'Bash' }))
  appendFileSync(wal4, rec({ event: 'PreToolUse', tool_name: 'Read' }))
  await wait(700)
  const seen = new Set(everyone.rows.map((r) => r.sess))
  check('an empty-pick stream carries new rows from different sessions', seen.has(L3) && seen.has(L4), JSON.stringify(everyone.rows))
} catch (err) {
  console.log(`  FAIL harness error — ${(err as Error).message}`)
  fail = 1
} finally {
  for (const s of streams) s.res?.destroy()
  server.kill()
  rmSync(dir, { recursive: true, force: true })
}

console.log(fail ? '\nFAILED' : '\nall checks passed')
process.exit(fail)
