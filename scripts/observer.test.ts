#!/usr/bin/env node

// observer.test.ts — the observer's WAL → target records over temp WALs: the derived `ev` fields,
// call rows, resume, stale, the torn tail, the budget, a missing WAL and read-only mode. Then the call
// and turn rows of a session without a WAL, over the fixture transcripts. No server.

import assert from 'node:assert/strict'
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, mock, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { createObserver } from './observer.ts'
import { appendRecords, createTargetReader, TARGET_VERSION, type TargetRecord, targetPath } from './target.ts'
import { createParser } from './transcripts.ts'

const root = mkdtempSync(join(tmpdir(), 'walobserver.'))
after(() => rmSync(root, { recursive: true, force: true }))
const projects = join(root, '.claude', 'projects')
const proj = join(projects, '-tmp-obs')
mkdirSync(proj, { recursive: true })
cpSync(join(import.meta.dirname, 'fixtures', 'projects'), projects, { recursive: true })
const discovery = {
  locate: (id: string): string | null =>
    readdirSync(projects)
      .map((d) => join(projects, d))
      .find((d) => existsSync(join(d, `${id}.jsonl`))) ?? null,
}

let n = 0
/** A new session id with an empty transcript; its transcript, WAL and target paths. */
const session = (): { id: string; tr: string; wal: string; target: string } => {
  const id = `bbbbbbbb-0000-4000-8000-${String(++n).padStart(12, '0')}`
  const tr = join(proj, `${id}.jsonl`)
  writeFileSync(tr, '')
  return { id, tr, wal: join(proj, `${id}.wal.jsonl`), target: targetPath({ label: 'default', projectsDir: projects }, id) }
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
  const want = [
    {
      t: 1790848801000,
      event: 'SessionStart',
      cat: 'session',
      tool: null,
      dur: null,
      tuid: null,
      agent: null,
      agentType: null,
      mcp: null,
      err: false,
      woff: 0,
    },
    {
      t: 1790848802000,
      event: 'PreToolUse',
      cat: 'tool',
      tool: 'Bash',
      dur: null,
      tuid: 'b1',
      agent: null,
      agentType: null,
      mcp: null,
      err: false,
      woff: 73,
    },
    {
      t: 1790848803000,
      event: 'PostToolUse',
      cat: 'tool',
      tool: 'Bash',
      dur: 12,
      tuid: 'b1',
      agent: null,
      agentType: null,
      mcp: null,
      err: false,
      woff: 182,
    },
    {
      t: 1790848804000,
      event: 'PreToolUse',
      cat: 'tool',
      tool: 'mcp__srv__find',
      dur: null,
      tuid: 'm1',
      agent: 'ag1',
      agentType: 'Explore',
      mcp: 'request',
      err: false,
      woff: 313,
    },
    {
      t: 1790848805000,
      event: 'PostToolUseFailure',
      cat: 'fail',
      tool: 'mcp__srv__find',
      dur: 7,
      tuid: 'm1',
      agent: 'ag1',
      agentType: 'Explore',
      mcp: 'response',
      err: true,
      woff: 472,
    },
    {
      t: 1790848805000,
      event: 'Unparseable',
      cat: 'fail',
      tool: null,
      dur: null,
      tuid: null,
      agent: null,
      agentType: null,
      mcp: null,
      err: false,
      woff: 655,
    },
    {
      t: 1790848805000,
      event: 'Notification',
      cat: 'session',
      tool: null,
      dur: null,
      tuid: null,
      agent: null,
      agentType: null,
      mcp: null,
      err: false,
      woff: 664,
    },
    {
      t: 1790848806000,
      event: 'SubagentStop',
      cat: 'subagent',
      tool: null,
      dur: null,
      tuid: null,
      agent: 'ag1',
      agentType: 'Explore',
      mcp: null,
      err: false,
      woff: 689,
    },
    {
      t: 1790848807000,
      event: 'UserPromptSubmit',
      cat: 'turn',
      tool: null,
      dur: null,
      tuid: null,
      agent: null,
      agentType: null,
      mcp: null,
      err: false,
      woff: 802,
    },
  ]
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

// A session without a WAL: the fixture with a subagent that has its `.meta.json`.
const FIX = 'd01c2dfc-0a01-4e1f-825a-5b0462780f18'
const FIX_AGENT = 'a6c7ff04911c76bce'
const fixMain = join(projects, '-tmp-proj', `${FIX}.jsonl`)
const fixAgent = join(projects, '-tmp-proj', FIX, 'subagents', `agent-${FIX_AGENT}.jsonl`)
// biome-ignore lint/suspicious/noExplicitAny: transcript lines are schemaless JSON.
type Line = Record<string, any>
const linesOf = (file: string): Line[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
const fixture = (): string => {
  sync(FIX)
  return targetPath({ label: 'default', projectsDir: projects }, FIX)
}

test('no WAL: call rows for a main and a subagent tool call', () => {
  const target = fixture()
  assert.deepEqual(records(target)[0], { k: 'head', v: TARGET_VERSION, id: FIX, wal: false })
  const byTuid = new Map(calls(target).map((c) => [c.tuid, c]))

  const main = linesOf(fixMain)
  const mainUse = main[9]?.message.content[0]
  assert.deepEqual(byTuid.get(mainUse.id), {
    k: 'call',
    tuid: mainUse.id,
    t: Date.parse('2026-09-30T09:52:13.881Z'),
    end: Date.parse('2026-09-30T09:52:14.032Z'),
    dur: 151,
    tool: 'Skill',
    mcp: false,
    err: false,
    agent: null,
    agentType: null,
    input: mainUse.input,
    response: main[10]?.message.content[0].content,
  })

  const sub = linesOf(fixAgent)
  const subUse = sub[12]?.message.content[0]
  assert.deepEqual(byTuid.get(subUse.id), {
    k: 'call',
    tuid: subUse.id,
    t: Date.parse('2026-09-30T11:04:57.767Z'),
    end: Date.parse('2026-09-30T11:04:57.841Z'),
    dur: 74,
    tool: 'Read',
    mcp: false,
    err: false,
    agent: FIX_AGENT,
    agentType: 'general-purpose',
    input: subUse.input,
    response: sub[13]?.message.content[0].content,
  })

  // One row per tool_use block whose tool_result is in the transcript.
  const resulted = (ls: Line[]): string[] => {
    const done = new Set(ls.flatMap((e) => (Array.isArray(e.message?.content) ? e.message.content : [])).map((b: Line) => b.tool_use_id))
    return ls
      .filter((e) => e.type === 'assistant')
      .flatMap((e) => e.message.content)
      .filter((b: Line) => b.type === 'tool_use' && done.has(b.id))
      .map((b: Line) => b.id)
  }
  assert.deepEqual([...byTuid.keys()].sort(), [...resulted(main), ...resulted(sub)].sort())
})

test('no WAL: UserPromptSubmit per turn start, Stop and SubagentStop only on end_turn lines', () => {
  const rows = evs(fixture())
  assert.ok(rows.every((e) => e.woff === null))
  const parser = createParser('main', 0, false)
  parser.push(readFileSync(fixMain))
  const prompts = rows.filter((e) => e.event === 'UserPromptSubmit')
  assert.ok(parser.turnStarts.length > 1)
  assert.deepEqual(
    prompts.filter((e) => e.agent === null).map((e) => e.t),
    parser.turnStarts,
  )
  const sub = linesOf(fixAgent)
  assert.deepEqual(
    prompts.filter((e) => e.agent === FIX_AGENT).map((e) => (e.rec as Line).uuid),
    [sub[0]?.uuid],
  )

  const stops = (event: string) => rows.filter((e) => e.event === event).map((e) => ({ agent: e.agent, uuid: (e.rec as Line).uuid, out: e.out }))
  const endTurn = (ls: Line[], agent: string | null) =>
    ls.filter((e) => e.type === 'assistant' && e.message.stop_reason === 'end_turn').map((e) => ({ agent, uuid: e.uuid, out: e.message.usage.output_tokens }))
  assert.deepEqual(stops('Stop'), endTurn(linesOf(fixMain), null))
  assert.deepEqual(stops('SubagentStop'), endTurn(sub, FIX_AGENT))
  assert.equal(stops('SubagentStop').length, 2)

  // A streamed snapshot carries stop_reason null; a reply whose end_turn spans two lines gives one Stop.
  const { id, tr, target } = session()
  const reply = (uuid: string, s: number, stop: string | null, out: number, block: Line): string =>
    JSON.stringify({
      type: 'assistant',
      uuid,
      timestamp: sec(s),
      message: { id: 'm1', model: 'x', stop_reason: stop, content: [block], usage: { output_tokens: out } },
    })
  appendFileSync(
    tr,
    `${[
      JSON.stringify({ type: 'user', uuid: 'u1', timestamp: sec(1), message: { role: 'user', content: 'hi' } }),
      reply('a1', 2, null, 3, { type: 'thinking', thinking: 'hm' }),
      reply('a2', 3, 'end_turn', 9, { type: 'thinking', thinking: 'hm' }),
      reply('a3', 3, 'end_turn', 9, { type: 'text', text: 'done' }),
    ].join('\n')}\n`,
  )
  sync(id)
  assert.deepEqual(
    evs(target).map((e) => [e.event, (e.rec as Line).uuid, e.t, e.out]),
    [
      ['UserPromptSubmit', 'u1', Date.parse(sec(1)), undefined],
      ['Stop', 'a2', Date.parse(sec(3)), 9],
    ],
  )
})

test('no WAL: a WAL that appears later makes the target stale with wal appeared', () => {
  const { id, tr, wal, target } = session()
  appendFileSync(tr, `${JSON.stringify({ type: 'user', uuid: 'u1', timestamp: sec(1), message: { role: 'user', content: 'hi' } })}\n`)
  assert.deepEqual(sync(id), { done: statSync(tr).size, total: statSync(tr).size, stale: null })
  assert.deepEqual(records(target)[0], { k: 'head', v: TARGET_VERSION, id, wal: false })

  put(wal, [rec(2, 'SessionStart')])
  assert.equal(sync(id).stale, 'wal appeared')
  assert.deepEqual(records(target).at(-1), { k: 'stale', reason: 'wal appeared' })
  const frozen = readFileSync(target, 'utf8')

  put(wal, [rec(3, 'Stop')])
  appendFileSync(tr, `${JSON.stringify({ type: 'user', uuid: 'u2', timestamp: sec(4), message: { role: 'user', content: 'more' } })}\n`)
  assert.equal(sync(id).stale, 'wal appeared')
  assert.equal(readFileSync(target, 'utf8'), frozen)
})

test('transcripts: no parser item stays in a set after a sync', () => {
  // The parser's `touched` set is the only set that holds its items (they carry `uid` and `src`).
  const holders: Set<unknown>[] = []
  const add = Set.prototype.add
  const spy = mock.method(Set.prototype, 'add', function (this: Set<unknown>, v: unknown) {
    if (v !== null && typeof v === 'object' && 'uid' in v && 'src' in v && !holders.includes(this)) holders.push(this)
    return add.call(this, v)
  })
  try {
    sync(FIX)
  } finally {
    spy.mock.restore()
  }
  assert.ok(holders.length > 0)
  assert.deepEqual(
    holders.map((h) => h.size),
    holders.map(() => 0),
  )
})

test('transcripts: a later cost-state with no totalCostUSD appends a cost record with usd null', () => {
  const { id, tr, target } = session()
  const costs = () => records(target).filter((r) => r.k === 'cost')
  const state = (extra: Record<string, unknown>): string => `${JSON.stringify({ type: 'cost-state', ...extra })}\n`
  appendFileSync(tr, `${JSON.stringify({ type: 'user', uuid: 'u1', timestamp: sec(1), message: { role: 'user', content: 'hi' } })}\n${state({})}`)
  sync(id)
  // Before the first cost record, a null cost writes nothing.
  assert.deepEqual(costs(), [])

  appendFileSync(tr, state({ totalCostUSD: 1.5, modelUsage: { 'claude-x': { costUSD: 1.5 } } }))
  sync(id)
  appendFileSync(tr, state({}))
  sync(id)
  sync(id)
  assert.deepEqual(costs(), [
    { k: 'cost', usd: 1.5, byModel: { 'claude-x': 1.5 } },
    { k: 'cost', usd: null, byModel: {} },
  ])
})
