#!/usr/bin/env node
// live-tail.test.ts — proves the viewer actually follows growing per-session WALs.
//
// Exercises the paths a header check cannot reach: appended lines reaching a connected client,
// two files growing at once arriving in time order, a record written in two parts arriving once
// and intact, truncation of one file resetting the feed, and the per-client filter on live rows.

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
const must = <T>(v: T | undefined | null, what = 'value'): T => {
  if (v == null) throw new Error(`missing ${what}`)
  return v
}

// Frames are buffered to the blank line that ends them: `id:` and `data:` can arrive in separate
// chunks.
interface Stream {
  rows: Row[]
  resets: number
  lastId: string | null
  unknown: string[] | null
  res?: IncomingMessage
}
const streams: Stream[] = []
const open = (qs: string, headers: Record<string, string> = {}): Promise<Stream> =>
  new Promise((resolve) => {
    const s: Stream = { rows: [], resets: 0, lastId: null, unknown: null }
    get(`${BASE}/events-stream?${qs}`, { headers }, (res) => {
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
          if (f.event === 'reset') s.resets++
          else if (f.event === 'unknown') s.unknown = JSON.parse(must(f.data, 'unknown event data')) as string[]
          else if (f.data) {
            s.rows.push(...(JSON.parse(f.data) as Row[]))
            s.lastId = f.id ?? null
          }
        }
      })
      streams.push(s)
      resolve(s)
    })
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
  const [pre, post, call] = mcpAll.rows
  check('Post and its call row arrive once', mcpAll.rows.map((r) => r.event).join() === 'PreToolUse,PostToolUse,MCP call', JSON.stringify(mcpAll.rows))
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
  // Indexed before the truncation below, so its Post arriving afterwards must not pair with it.
  appendFileSync(wal1, rec({ event: 'PreToolUse', tool_name: FIND, tool_use_id: 'across' }))
  await wait(700)

  // Truncation of one file must reset streams over it, and only those.
  const before = await events()
  writeFileSync(wal1, rec({ event: 'SessionEnd', session_id: 'rotated' }))
  await wait(700)
  check('truncation sends reset', s.resets === 1, `resets ${s.resets}`)
  check('truncation resets filtered streams too', reads.resets === 1 && needle.resets === 1)
  check('a stream not over the truncated file is untouched', only2.resets === 0)
  const after1 = await events()
  check(
    're-query has a higher gen for the truncated file only',
    must(after1.gens[L1]) > must(before.gens[L1]) && after1.gens[L2] === before.gens[L2],
    `${JSON.stringify(after1.gens)} vs ${JSON.stringify(before.gens)}`,
  )
  check(
    're-query returns the new record beside the other file',
    after1.head.startsWith(`${L1}:1,`) && after1.rows.filter((r) => r.sess === L1).length === 1,
    JSON.stringify(after1.head),
  )

  // /events can detect the truncation before the tick does; the stream must still reset.
  const late = await open(after(after1))
  await wait(400)
  // Shorter than the file it replaces: truncation is detected by the size shrinking.
  writeFileSync(wal1, rec({ event: 'Stop' }))
  const racer = await events()
  check('/events reports the new gen', must(racer.gens[L1]) > must(after1.gens[L1]), `${racer.gens[L1]} vs ${after1.gens[L1]}`)
  await wait(600)
  check('truncation found by /events still resets', late.resets === 1 && late.rows.length === 0, `resets ${late.resets}, rows ${late.rows.length}`)

  // A deleted WAL is a truncation to zero, and must not crash the server.
  const gone = await open(after(await events()))
  await wait(400)
  rmSync(wal1)
  await wait(700)
  const empty = await events(`ids=${L1}`)
  check('deleted WAL resets the stream', gone.resets === 1, `resets ${gone.resets}`)
  check('deleted WAL gives head 0 and the server still answers', empty.head === `${L1}:0` && empty.rows.length === 0, JSON.stringify(empty))
  check('/events?q= survives a deleted WAL', (await events(`ids=${L1}&q=x`)).head === `${L1}:0`)

  appendFileSync(wal1, rec({ event: 'PostToolUse', tool_name: FIND, tool_use_id: 'across', duration_ms: 3 }))
  await wait(700)
  const across = await events(`ids=${L1}`)
  check(
    'a Pre from before truncation never pairs',
    across.head === `${L1}:1` && across.rows[0]?.mcp === 'response' && !across.counts.mcp,
    JSON.stringify(across),
  )

  // Replaced by rename with a longer file: the size never shrinks, only the inode tells.
  const rotated = await open(after(across, `ids=${L1}`))
  await wait(400)
  const tmp = join(proj, 'rotate.tmp')
  writeFileSync(tmp, rec({ event: 'SessionStart' }) + rec({ event: 'Stop' }) + rec({ event: 'Stop' }) + rec({ event: 'SessionEnd' }))
  renameSync(tmp, wal1)
  await wait(700)
  const renamed = await events(`ids=${L1}`)
  check(
    'a WAL replaced by rename resets the stream',
    rotated.resets === 1 && rotated.rows.length === 0,
    `resets ${rotated.resets}, rows ${rotated.rows.length}`,
  )
  check(
    '...and is re-indexed from its first byte',
    must(renamed.gens[L1]) > must(across.gens[L1]) &&
      renamed.head === `${L1}:4` &&
      renamed.rows.map((r) => r.event).join() === 'SessionEnd,Stop,Stop,SessionStart',
    JSON.stringify(renamed.rows),
  )

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
