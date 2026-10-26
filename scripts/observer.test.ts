#!/usr/bin/env node

// observer.test.ts — the observer's WAL → target records over temp WALs: the derived `ev` fields,
// call rows, resume, stale, the torn tail, the budget, a missing WAL and read-only mode. No server.

import assert from 'node:assert/strict'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { createObserver } from './observer.ts'
import { appendRecords, createTargetReader, TARGET_VERSION, type TargetRecord, targetPath } from './target.ts'
import { createWalIndex } from './wal-index.ts'

const root = mkdtempSync(join(tmpdir(), 'walobserver.'))
after(() => rmSync(root, { recursive: true, force: true }))
const projects = join(root, '.claude', 'projects')
const proj = join(projects, '-tmp-obs')
mkdirSync(proj, { recursive: true })
const discovery = { locate: (_id: string): string | null => proj }

let n = 0
/** A new session id with an empty transcript; its WAL path. */
const session = (): { id: string; wal: string; target: string } => {
  const id = `bbbbbbbb-0000-4000-8000-${String(++n).padStart(12, '0')}`
  writeFileSync(join(proj, `${id}.jsonl`), '')
  return { id, wal: join(proj, `${id}.wal.jsonl`), target: targetPath({ label: 'default', projectsDir: projects }, id) }
}
const sec = (s: number): string => `2026-10-01T10:00:${String(s).padStart(2, '0')}.000Z`
const rec = (s: number, event: string, extra: Record<string, unknown> = {}): string => JSON.stringify({ ts: sec(s), workspace: 'w', event, ...extra })
const put = (wal: string, lines: string[]): void => appendFileSync(wal, lines.map((l) => `${l}\n`).join(''))
const records = (target: string): TargetRecord[] =>
  createTargetReader(target)
    .read()
    .items.map((i) => i.rec)
type Ev = Extract<TargetRecord, { k: 'ev' }>
type Call = Extract<TargetRecord, { k: 'call' }>
const evs = (target: string): Ev[] => records(target).filter((r): r is Ev => r.k === 'ev')
const calls = (target: string): Call[] => records(target).filter((r): r is Call => r.k === 'call')
const sync = (id: string, budget = 1000) => createObserver({ discovery, write: true }).sync(id, budget)

test('ev: the derived fields match the IndexEntry of the same lines', () => {
  const { id, wal, target } = session()
  put(wal, [
    rec(1, 'SessionStart'),
    rec(2, 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'b1' }),
    rec(3, 'PostToolUse', { tool_name: 'Bash', tool_use_id: 'b1', duration_ms: 12 }),
    '   ',
    rec(4, 'PreToolUse', { tool_name: 'mcp__srv__find', tool_use_id: 'm1', agent_id: 'ag1', agent_type: 'Explore' }),
    rec(5, 'PostToolUseFailure', { tool_name: 'mcp__srv__find', tool_use_id: 'm1', agent_id: 'ag1', agent_type: 'Explore', duration_ms: 7 }),
    'not json',
    JSON.stringify({ event: 'Notification' }),
    rec(6, 'SubagentStop', { agent_id: 'ag1', agent_type: 'Explore' }),
    rec(7, 'UserPromptSubmit', { agent_id: '', agent_type: '' }),
  ])
  sync(id)
  const want = createWalIndex(id, wal)
    .entries.filter((e) => e.virtual === null)
    .map((e) => ({
      t: e.t,
      event: e.event ?? null,
      cat: e.cat,
      tool: e.tool,
      dur: e.dur,
      tuid: e.tuid,
      agent: e.agent,
      agentType: e.agentType,
      mcp: e.mcp,
      err: e.err,
      woff: e.off,
    }))
  const got = evs(target).map(({ t, event, cat, tool, dur, tuid, agent, agentType, mcp, err, woff }) => ({
    t,
    event,
    cat,
    tool,
    dur,
    tuid,
    agent,
    agentType,
    mcp,
    err,
    woff,
  }))
  assert.equal(got.length, 9)
  assert.deepEqual(got, want)
})

test('call: a row for a plain tool, an MCP tool and a failure', () => {
  const { id, wal, target } = session()
  put(wal, [
    rec(1, 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'b1', payload: { tool_input: { command: 'ls' } } }),
    rec(2, 'PreToolUse', { tool_name: 'mcp__srv__find', tool_use_id: 'm1', agent_id: 'ag1', agent_type: 'Explore', payload: { tool_input: { q: 'milk' } } }),
    rec(3, 'PostToolUse', { tool_name: 'Bash', tool_use_id: 'b1', duration_ms: 1500, payload: { tool_input: { command: 'ls' }, tool_response: 'ok' } }),
    rec(4, 'PreToolUse', { tool_name: 'Write', tool_use_id: 'w1', payload: { tool_input: { content: 'eggs' } } }),
    rec(6, 'PostToolUse', {
      tool_name: 'mcp__srv__find',
      tool_use_id: 'm1',
      agent_id: 'ag1',
      agent_type: 'Explore',
      duration_ms: 4000,
      payload: { tool_response: [{ type: 'text', text: 'Buy milk' }] },
    }),
    rec(7, 'PostToolUseFailure', { tool_name: 'Write', tool_use_id: 'w1', duration_ms: 3, payload: { tool_input: { content: 'eggs' }, error: 'boom' } }),
  ])
  sync(id)
  const at = (s: number): number => Date.parse(sec(s))
  const row = { k: 'call', mcp: false, err: false, agent: null, agentType: null }
  assert.deepEqual(calls(target), [
    { ...row, tuid: 'b1', t: at(1), end: at(3), dur: 1500, tool: 'Bash', input: { command: 'ls' }, response: 'ok' },
    {
      ...row,
      tuid: 'm1',
      t: at(2),
      end: at(6),
      dur: 4000,
      tool: 'mcp__srv__find',
      mcp: true,
      agent: 'ag1',
      agentType: 'Explore',
      input: { q: 'milk' },
      response: [{ type: 'text', text: 'Buy milk' }],
    },
    { ...row, tuid: 'w1', t: at(4), end: at(7), dur: 3, tool: 'Write', err: true, input: { content: 'eggs' }, response: 'boom' },
  ])
})

test('call: a Post with no Pre gives a row with t = end', () => {
  const { id, wal, target } = session()
  put(wal, [rec(5, 'PostToolUse', { tool_name: 'Read', tool_use_id: 'r1', duration_ms: 9, payload: { tool_input: { path: '/a' }, tool_response: 'text' } })])
  sync(id)
  const end = Date.parse(sec(5))
  assert.deepEqual(calls(target), [
    { k: 'call', tuid: 'r1', t: end, end, dur: 9, tool: 'Read', mcp: false, err: false, agent: null, agentType: null, input: { path: '/a' }, response: 'text' },
  ])
})

test('call: a duplicate Post gives no second row', () => {
  const { id, wal, target } = session()
  put(wal, [
    rec(1, 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'b1' }),
    rec(2, 'PostToolUse', { tool_name: 'Bash', tool_use_id: 'b1', payload: { tool_response: 'first' } }),
    rec(3, 'PostToolUse', { tool_name: 'Bash', tool_use_id: 'b1', payload: { tool_response: 'second' } }),
  ])
  sync(id)
  assert.deepEqual(
    calls(target).map((c) => c.response),
    ['first'],
  )
  assert.equal(evs(target).length, 3)
})

test('unparseable lines keep raw and a persisted t', async () => {
  const { id, wal, target } = session()
  put(wal, ['{oops'])
  const before = Date.now()
  sync(id)
  const first = evs(target)[0]
  assert.ok(first)
  assert.equal(first.raw, '{oops')
  assert.equal('rec' in first, false)
  assert.equal(first.event, 'Unparseable')
  assert.ok(first.t >= before && first.t <= Date.now())

  // A later pass in a new instance takes the persisted t, not its own time.
  await sleep(5)
  put(wal, ['still not json'])
  sync(id)
  const both = evs(target)
  assert.equal(both.length, 2)
  assert.equal(both[1]?.raw, 'still not json')
  assert.equal(both[1]?.t, first.t)
})

test('resume: a new observer instance writes no duplicates and keeps open calls', () => {
  const { id, wal, target } = session()
  put(wal, [rec(1, 'SessionStart'), rec(2, 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'b1', payload: { tool_input: { command: 'ls' } } })])
  sync(id)
  assert.equal(sync(id).done, statSync(wal).size)
  put(wal, [rec(4, 'PostToolUse', { tool_name: 'Bash', tool_use_id: 'b1', payload: { tool_response: 'ok' } }), rec(5, 'Stop')])
  const r = sync(id)
  assert.deepEqual(r, { done: statSync(wal).size, total: statSync(wal).size, stale: null })

  const all = evs(target)
  assert.deepEqual(
    all.map((e) => e.event),
    ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop'],
  )
  assert.equal(new Set(all.map((e) => e.woff)).size, 4)
  const [call, ...more] = calls(target)
  assert.equal(more.length, 0)
  assert.equal(call?.t, Date.parse(sec(2)))
  assert.deepEqual(call?.input, { command: 'ls' })
  assert.equal(records(target).filter((x) => x.k === 'head').length, 1)
})

test('stale: a shrunk WAL appends stale once and stops all writes', () => {
  const { id, wal, target } = session()
  put(wal, [rec(1, 'SessionStart'), rec(2, 'Stop')])
  const obs = createObserver({ discovery, write: true })
  obs.sync(id, 1000)
  truncateSync(wal, 10)
  assert.equal(obs.sync(id, 1000).stale, 'wal shrank')
  const frozen = readFileSync(target, 'utf8')
  assert.deepEqual(records(target).at(-1), { k: 'stale', reason: 'wal shrank' })

  put(wal, [rec(3, 'Stop'), rec(4, 'Stop'), rec(5, 'Stop')])
  assert.equal(obs.sync(id, 1000).stale, 'wal shrank')
  assert.equal(sync(id).stale, 'wal shrank')
  assert.equal(readFileSync(target, 'utf8'), frozen)
})

test('stale: a new inode appends stale once and stops all writes', () => {
  const { id, wal, target } = session()
  put(wal, [rec(1, 'SessionStart')])
  sync(id)
  const other = `${wal}.new`
  writeFileSync(other, '')
  put(other, [rec(1, 'SessionStart'), rec(2, 'Stop'), rec(3, 'Stop')])
  renameSync(other, wal)
  assert.equal(sync(id).stale, 'wal replaced')
  const frozen = readFileSync(target, 'utf8')
  assert.deepEqual(records(target).at(-1), { k: 'stale', reason: 'wal replaced' })

  put(wal, [rec(4, 'Stop')])
  assert.equal(sync(id).stale, 'wal replaced')
  assert.equal(readFileSync(target, 'utf8'), frozen)
})

test('torn tail: a pass cut mid-write resumes with each WAL line once', () => {
  const { id, wal, target } = session()
  put(wal, [rec(1, 'SessionStart'), rec(2, 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'b1' })])
  sync(id)
  put(wal, [rec(3, 'PostToolUse', { tool_name: 'Bash', tool_use_id: 'b1' }), rec(4, 'Stop')])
  sync(id)
  // A crash inside the second pass's last line: its `ck` is torn, its `ev` and `call` are on disk.
  truncateSync(target, statSync(target).size - 5)
  put(wal, [rec(5, 'Stop')])
  sync(id)

  const text = readFileSync(target, 'utf8')
  assert.ok(text.endsWith('\n'))
  assert.deepEqual(
    evs(target).map((e) => e.t),
    [1, 2, 3, 4, 5].map((s) => Date.parse(sec(s))),
  )
  assert.equal(calls(target).length, 1)
  assert.deepEqual(records(target).at(-1), { k: 'ck', wal: { ino: statSync(wal).ino, off: statSync(wal).size }, tr: {} })
})

test('budget: 0 ms makes partial progress and later passes finish', () => {
  const { id, wal, target } = session()
  const pad = 'x'.repeat(500)
  put(
    wal,
    Array.from({ length: 400 }, (_, i) => rec(i % 60, 'Notification', { payload: { pad, i } })),
  )
  const obs = createObserver({ discovery, write: true })
  const first = obs.sync(id, 0)
  assert.equal(first.total, statSync(wal).size)
  assert.ok(first.done > 0 && first.done < first.total, JSON.stringify(first))
  let r = first
  for (let i = 0; i < 100 && r.done < r.total; i++) r = obs.sync(id, 0)
  assert.equal(r.done, r.total)
  assert.deepEqual(obs.state(id), r)

  const all = evs(target)
  assert.deepEqual(
    all.map((e) => (e.rec as { payload: { i: number } }).payload.i),
    Array.from({ length: 400 }, (_, i) => i),
  )
  assert.ok(records(target).filter((x) => x.k === 'ck').length > 1)
})

test('stale: a WAL replaced before its first whole line starts over, not frozen', () => {
  const { id, wal, target } = session()
  writeFileSync(wal, rec(1, 'SessionStart'))
  assert.equal(sync(id).done, 0)
  const obs = createObserver({ discovery, write: true })
  obs.sync(id, 1000)
  const other = `${wal}.new`
  writeFileSync(other, '')
  put(other, [rec(1, 'SessionStart'), rec(2, 'Stop')])
  renameSync(other, wal)
  assert.deepEqual(obs.sync(id, 1000), { done: statSync(wal).size, total: statSync(wal).size, stale: null })
  assert.deepEqual(
    records(target).map((r) => r.k),
    ['head', 'ev', 'ev', 'ck'],
  )
})

test('stale: a head of another format version appends stale once and writes nothing else', () => {
  const { id, wal, target } = session()
  put(wal, [rec(1, 'SessionStart')])
  appendRecords(target, [{ k: 'head', v: TARGET_VERSION + 1, id, wal: true }])
  const reason = `format version ${TARGET_VERSION + 1}`
  assert.equal(sync(id).stale, reason)
  assert.equal(sync(id).stale, reason)
  assert.deepEqual(records(target), [
    { k: 'head', v: TARGET_VERSION + 1, id, wal: true },
    { k: 'stale', reason },
  ])
})

test('skip: a missing WAL writes nothing and does not make the target stale', () => {
  const { id, wal, target } = session()
  assert.deepEqual(sync(id), { done: 0, total: 0, stale: null })
  assert.equal(existsSync(target), false)

  put(wal, [rec(1, 'SessionStart')])
  const obs = createObserver({ discovery, write: true })
  const built = obs.sync(id, 1000)
  const before = readFileSync(target, 'utf8')
  const away = join(root, `${id}.wal.jsonl`)
  renameSync(wal, away)
  assert.deepEqual(obs.sync(id, 1000), built)
  assert.deepEqual(sync(id), { done: 0, total: 0, stale: null })
  assert.equal(readFileSync(target, 'utf8'), before)

  // Restored by rename, as trash does: same inode, so the target continues.
  renameSync(away, wal)
  put(wal, [rec(2, 'Stop')])
  assert.equal(obs.sync(id, 1000).stale, null)
  assert.deepEqual(
    evs(target).map((e) => e.event),
    ['SessionStart', 'Stop'],
  )
})

test('read-only: write false never appends and reports what the owner wrote', () => {
  const { id, wal, target } = session()
  put(wal, [rec(1, 'SessionStart')])
  const owner = createObserver({ discovery, write: true })
  const reader = createObserver({ discovery, write: false })
  owner.sync(id, 1000)
  const built = statSync(wal).size
  put(wal, [rec(2, 'Stop')])
  const before = readFileSync(target, 'utf8')
  assert.deepEqual(reader.sync(id, 1000), { done: built, total: statSync(wal).size, stale: null })
  assert.equal(readFileSync(target, 'utf8'), before)

  owner.sync(id, 1000)
  assert.deepEqual(reader.sync(id, 1000), { done: statSync(wal).size, total: statSync(wal).size, stale: null })

  // The owner rebuilds the target from scratch: the reader starts over with it.
  rmSync(target)
  owner.drop(id)
  writeFileSync(wal, '')
  put(wal, [rec(3, 'SessionStart')])
  owner.sync(id, 1000)
  assert.deepEqual(reader.sync(id, 1000), { done: statSync(wal).size, total: statSync(wal).size, stale: null })

  truncateSync(wal, 0)
  owner.sync(id, 1000)
  assert.equal(reader.sync(id, 1000).stale, 'wal shrank')
})

test('resume: past the called cap, a torn checkpoint writes no call row twice', () => {
  const { id, wal, target } = session()
  const post = (i: number): string => rec(1, 'PostToolUse', { tool_name: 'Bash', tool_use_id: `u${i}` })
  put(
    wal,
    Array.from({ length: 10_005 }, (_, i) => post(i)),
  )
  sync(id)
  put(wal, [post(20_000), post(20_001), post(20_002)])
  sync(id)
  // A crash inside the second pass's `ck`: its call rows are on disk, past the last whole `ck`.
  truncateSync(target, statSync(target).size - 5)
  put(wal, [rec(2, 'Stop')])
  sync(id)

  const tuids = calls(target).map((c) => c.tuid)
  assert.equal(tuids.length, 10_008)
  assert.equal(new Set(tuids).size, 10_008)
})
