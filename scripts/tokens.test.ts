#!/usr/bin/env node

// tokens.test.ts — the observer's token join: the `tok` records it appends for call rows and Stop rows,
// over copies of the fixture transcripts plus hand-made WALs that reuse their tool_use_ids, and over
// hand-made transcripts for the cases the fixtures do not hold. No server.

import assert from 'node:assert/strict'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { createObserver } from './observer.ts'
import { createTargetReader, type TargetRecord, targetPath } from './target.ts'

const root = mkdtempSync(join(tmpdir(), 'waltokens.'))
after(() => rmSync(root, { recursive: true, force: true }))
const projects = join(root, '.claude', 'projects')
const proj = join(projects, '-tmp-tok')
mkdirSync(proj, { recursive: true })
const discovery = {
  locate: (id: string): string | null => (existsSync(join(proj, `${id}.jsonl`)) ? proj : null),
}

// The fixture session with a subagent. Its numbers, from its usage lines (prompt = input + cache read + cache writes):
// main  YjvD9q  out 903, prompt 71381, one call gsNTiK; next reply aMrgGL prompt 72685, no user line between.
// main  KkeJEM  out 271, one call SDhFtq; user prompts lie between it and the next reply.
// main  iyDUWt  out 96, one call 2QYftU; the last reply of the file.
// main  aMrgGL  end_turn at 09:55:57.883, out 41.
// agent pgr9Qj  streamed: out 21, then 219; calls 6k9TNX (input 56, result 40) and gBYmqE (input 54, result 40);
//               next reply 59wR67 prompt 39473, its own prompt 28725.
// agent pCDwy5  end_turn at 11:08:06.884, out 116.
const FIX = 'd01c2dfc-0a01-4e1f-825a-5b0462780f18'
const AGENT = 'a6c7ff04911c76bce'
const fixDir = join(import.meta.dirname, 'fixtures', 'projects', '-tmp-proj')
const fixMain = readFileSync(join(fixDir, `${FIX}.jsonl`), 'utf8').split(/(?<=\n)/)
const fixAgent = readFileSync(join(fixDir, FIX, 'subagents', `agent-${AGENT}.jsonl`), 'utf8').split(/(?<=\n)/)
const tu = (suffix: string): string => {
  const m = [...fixMain, ...fixAgent].join('').match(new RegExp(`"id":"(toolu_[A-Za-z0-9]*${suffix})"`))
  assert.ok(m?.[1], suffix)
  return m[1]
}
// biome-ignore lint/suspicious/noExplicitAny: transcript lines are schemaless JSON.
const textOf = (lines: string[], i: number): string => (JSON.parse(lines[i] ?? '{}') as any).message.content[0].text

let n = 0
interface Sess {
  id: string
  tr: string
  sub: string
  wal: string
  target: string
}
/** A new session: the first `main` lines of the fixture main transcript and `sub` of its subagent (none when null). */
const session = (main = 0, sub: number | null = null): Sess => {
  const id = `cccccccc-0000-4000-8000-${String(++n).padStart(12, '0')}`
  const tr = join(proj, `${id}.jsonl`)
  writeFileSync(tr, fixMain.slice(0, main).join(''))
  const dir = join(proj, id, 'subagents')
  const subFile = join(dir, `agent-${AGENT}.jsonl`)
  if (sub !== null) {
    mkdirSync(dir, { recursive: true })
    cpSync(join(fixDir, FIX, 'subagents', `agent-${AGENT}.meta.json`), join(dir, `agent-${AGENT}.meta.json`))
    writeFileSync(subFile, fixAgent.slice(0, sub).join(''))
  }
  return { id, tr, sub: subFile, wal: join(proj, `${id}.wal.jsonl`), target: targetPath({ label: 'default', projectsDir: projects }, id) }
}

const rec = (ts: string, event: string, extra: Record<string, unknown> = {}): string => JSON.stringify({ ts, workspace: 'w', event, ...extra })
const call = (ts: string, tuid: string, tool = 'Read', extra: Record<string, unknown> = {}): string[] => [
  rec(ts, 'PreToolUse', { tool_name: tool, tool_use_id: tuid, ...extra, payload: { tool_input: {} } }),
  rec(ts, 'PostToolUse', { tool_name: tool, tool_use_id: tuid, ...extra, payload: { tool_response: 'ok' } }),
]
const put = (file: string, lines: string[]): void => appendFileSync(file, lines.map((l) => (l.endsWith('\n') ? l : `${l}\n`)).join(''))
type Observer = ReturnType<typeof createObserver>
const observer = (): Observer => createObserver({ discovery, write: true })
/** A pass by `o`; by default a new observer, as after a restart. */
const sync = (id: string, o = observer()): void => {
  o.sync(id, 1000)
}
const records = (target: string): TargetRecord[] =>
  createTargetReader(target)
    .read()
    .items.map((i) => i.rec)
type Tok = Extract<TargetRecord, { k: 'tok' }>
const toks = (target: string): Tok[] => records(target).filter((r): r is Tok => r.k === 'tok')
const tokOf = (target: string, tuid: string): Tok[] => toks(target).filter((t) => 'tuid' in t && t.tuid === tuid)
const woffOf = (target: string, event: string): number[] =>
  records(target).flatMap((r) => (r.k === 'ev' && r.event === event && r.woff !== null ? [r.woff] : []))

// Hand-made transcript lines.
const sec = (s: number): string => `2026-10-01T10:00:${String(s).padStart(2, '0')}.000Z`
/** `writes` are the 5m and 1h cache writes of the reply, taken out of `prompt` with the 1 input token. */
const usage = (prompt: number, out: number, writes: [number, number] = [0, 0]) => ({
  input_tokens: 1,
  cache_read_input_tokens: prompt - 1 - writes[0] - writes[1],
  cache_creation: { ephemeral_5m_input_tokens: writes[0], ephemeral_1h_input_tokens: writes[1] },
  output_tokens: out,
})
const reply = (
  uuid: string,
  id: string,
  s: number,
  prompt: number,
  out: number,
  blocks: unknown[],
  stop: string | null = null,
  writes: [number, number] = [0, 0],
): string =>
  JSON.stringify({
    type: 'assistant',
    uuid,
    timestamp: sec(s),
    message: { id, model: 'm', stop_reason: stop, content: blocks, usage: usage(prompt, out, writes) },
  })
const use = (id: string, q: string) => ({ type: 'tool_use', id, name: 'Read', input: { q } })
const result = (uuid: string, s: number, tuid: string, content: string): string =>
  JSON.stringify({ type: 'user', uuid, timestamp: sec(s), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tuid, content }] } })
const userPrompt = (uuid: string, s: number): string => JSON.stringify({ type: 'user', uuid, timestamp: sec(s), message: { role: 'user', content: 'go' } })

test('a single call: Output is the reply output, Result the prompt growth to the next reply', () => {
  const s = session(fixMain.length)
  put(s.wal, call('2026-09-30T09:55:55.300Z', tu('gsNTiK')))
  sync(s.id)
  // 72685 − 71381 − 903 = 401.
  assert.deepEqual(tokOf(s.target, tu('gsNTiK')), [{ k: 'tok', tuid: tu('gsNTiK'), out: 903, res: 401, inp: 374 }])
})

test('parallel calls: Output split by input size, Result by result size, the parts add up', () => {
  // The fixture's parallel pair: inputs 56 and 54, results 40 and 40.
  const s = session(0, fixAgent.length)
  put(s.tr, [userPrompt('p0', 1)])
  put(s.wal, [
    ...call('2026-09-30T11:04:58.000Z', tu('6k9TNX'), 'Read', { agent_id: AGENT }),
    ...call('2026-09-30T11:04:58.400Z', tu('gBYmqE'), 'Read', { agent_id: AGENT }),
  ])
  sync(s.id)
  // Output 219 × 56/110 = 111.5 → 111, and 108. Result 39473 − 28725 − 219 = 10529, split 40 : 40.
  assert.deepEqual(tokOf(s.target, tu('6k9TNX')), [{ k: 'tok', tuid: tu('6k9TNX'), out: 111, res: 5265, inp: 11314 }])
  assert.deepEqual(tokOf(s.target, tu('gBYmqE')), [{ k: 'tok', tuid: tu('gBYmqE'), out: 108, res: 5264, inp: 10910 }])

  // Uneven result sizes: inputs {"q":"x…"} of 16, 32 and 48 chars, results of 100, 300 and 600 chars.
  const h = session()
  put(h.tr, [
    userPrompt('u1', 1),
    reply('a1', 'r1', 2, 5000, 100, [use('ta', 'x'.repeat(8)), use('tb', 'x'.repeat(24)), use('tc', 'x'.repeat(40))], null, [95, 0]),
    result('u2', 3, 'ta', 'a'.repeat(100)),
    result('u3', 3, 'tb', 'b'.repeat(300)),
    result('u4', 3, 'tc', 'c'.repeat(600)),
    reply('a2', 'r2', 4, 5000 + 100 + 1001, 5, [{ type: 'text', text: 'done' }], 'end_turn'),
  ])
  put(h.wal, [...call(sec(2), 'ta'), ...call(sec(2), 'tb'), ...call(sec(2), 'tc')])
  sync(h.id)
  const got = ['ta', 'tb', 'tc'].map((t) => tokOf(h.target, t))
  // The reply's fresh input is 1 + 95 = 96, split by the same sizes, so 16, 32 and 48. Output 100 by 16 : 32 : 48 → 16.7, 50, 100 cumulated → 17, 33, 50. Result 1001 by 1 : 3 : 6 → 100.1, 400.4, 1001 → 100, 300, 601.
  assert.deepEqual(got, [
    [{ k: 'tok', tuid: 'ta', out: 17, res: 100, inp: 16 }],
    [{ k: 'tok', tuid: 'tb', out: 33, res: 300, inp: 32 }],
    [{ k: 'tok', tuid: 'tc', out: 50, res: 601, inp: 48 }],
  ])
})

test('streamed subagent reply: the tok waits for the next reply and uses the final count', () => {
  // Line 12 holds 6k9TNX with output 21, line 13 its result; line 14 restates the reply with output 219.
  const s = session(0, 14)
  const o = observer()
  put(s.wal, call('2026-09-30T11:04:57.800Z', tu('6k9TNX'), 'Read', { agent_id: AGENT }))
  sync(s.id, o)
  assert.deepEqual(tokOf(s.target, tu('6k9TNX')), [])

  put(s.sub, fixAgent.slice(14))
  sync(s.id, o)
  assert.deepEqual(tokOf(s.target, tu('6k9TNX')), [{ k: 'tok', tuid: tu('6k9TNX'), out: 111, res: 5265, inp: 11314 }])
})

test('a single call: Inp is the reply input plus its 5m and 1h cache writes, not its cache reads', () => {
  const s = session()
  put(s.tr, [
    userPrompt('u1', 1),
    reply('a1', 'r1', 2, 9000, 10, [use('ti', 'x')], null, [300, 40]),
    result('u2', 3, 'ti', 'r'),
    reply('a2', 'r2', 4, 9100, 5, [{ type: 'text', text: 'ok' }], 'end_turn'),
  ])
  put(s.wal, call(sec(2), 'ti'))
  sync(s.id)
  // 1 input + 300 + 40 = 341; the 8659 cache reads do not count.
  assert.equal(tokOf(s.target, 'ti')[0]?.inp, 341)
})

test('parallel calls: Inp is split by input size and the parts add up to the reply fresh input', () => {
  const s = session()
  put(s.tr, [
    userPrompt('u1', 1),
    reply('a1', 'r1', 2, 5000, 100, [use('ta', 'x'.repeat(8)), use('tb', 'x'.repeat(24)), use('tc', 'x'.repeat(40))], null, [100, 0]),
    result('u2', 3, 'ta', 'a'),
    result('u3', 3, 'tb', 'b'),
    result('u4', 3, 'tc', 'c'),
    reply('a2', 'r2', 4, 5200, 5, [{ type: 'text', text: 'done' }], 'end_turn'),
  ])
  put(s.wal, [...call(sec(2), 'ta'), ...call(sec(2), 'tb'), ...call(sec(2), 'tc')])
  sync(s.id)
  // Fresh input 101 by 16 : 32 : 48 → 16.8, 50.5, 101 cumulated → 17, 51, 101, so the parts are 17, 34 and 50.
  const parts = ['ta', 'tb', 'tc'].map((t) => tokOf(s.target, t)[0]?.inp)
  assert.deepEqual(parts, [17, 34, 50])
  assert.equal(
    parts.reduce((a, b) => (a ?? 0) + (b ?? 0), 0),
    101,
  )
})

test('a Stop: Inp is the full fresh input of its reply', () => {
  const s = session()
  put(s.tr, [userPrompt('u1', 1), reply('a1', 'r1', 2, 1000, 7, [{ type: 'text', text: 'bye' }], 'end_turn', [200, 30])])
  put(s.wal, [rec(sec(3), 'Stop', { payload: { last_assistant_message: 'bye' } })])
  sync(s.id)
  assert.equal(toks(s.target)[0]?.inp, 231)
})

test('compaction: a negative growth gives Output only', () => {
  const s = session()
  put(s.tr, [
    userPrompt('u1', 1),
    reply('a1', 'r1', 2, 50_000, 20, [use('tk', 'x')]),
    result('u2', 3, 'tk', 'r'),
    JSON.stringify({
      type: 'system',
      subtype: 'compact_boundary',
      uuid: 's1',
      timestamp: sec(4),
      compactMetadata: { trigger: 'auto', preTokens: 50_000, postTokens: 9000 },
    }),
    reply('a2', 'r2', 5, 9000, 5, [{ type: 'text', text: 'ok' }], 'end_turn'),
  ])
  put(s.wal, call(sec(2), 'tk'))
  sync(s.id)
  assert.deepEqual(tokOf(s.target, 'tk'), [{ k: 'tok', tuid: 'tk', out: 20, inp: 1 }])
})

test('an interrupted turn: a user prompt between the reply and the next gives Output only', () => {
  // KkeJEM → iyDUWt grows by 10630, but user prompts lie between them.
  const s = session(fixMain.length)
  put(s.wal, call('2026-09-30T11:08:07.000Z', tu('SDhFtq')))
  sync(s.id)
  assert.deepEqual(tokOf(s.target, tu('SDhFtq')), [{ k: 'tok', tuid: tu('SDhFtq'), out: 271, inp: 1745 }])
})

test('no next request: open while live, Output only after a SessionEnd that follows the call', () => {
  const s = session(fixMain.length)
  // A SessionEnd before the call (a resumed session) does not end it.
  const o = observer()
  put(s.wal, [rec('2026-09-30T11:00:00.000Z', 'SessionEnd'), ...call('2026-09-30T11:44:04.200Z', tu('2QYftU'))])
  sync(s.id, o)
  sync(s.id, o)
  // After a restart too: the waiting call and its SessionEnd come from the target.
  sync(s.id)
  assert.deepEqual(tokOf(s.target, tu('2QYftU')), [])

  put(s.wal, [rec('2026-09-30T11:45:00.000Z', 'SessionEnd')])
  sync(s.id, o)
  assert.deepEqual(tokOf(s.target, tu('2QYftU')), [{ k: 'tok', tuid: tu('2QYftU'), out: 96, inp: 396 }])
})

test('Stop and SubagentStop: matched by prefix against the last reply at or before them', () => {
  // The main transcript stops before aMrgGL (line 18): the last reply before the Stop has no text yet.
  const s = session(18, fixAgent.length)
  const o = observer()
  put(s.wal, [
    rec('2026-09-30T09:55:58.000Z', 'Stop', { payload: { last_assistant_message: textOf(fixMain, 18) } }),
    rec('2026-09-30T11:08:07.000Z', 'SubagentStop', { agent_id: AGENT, payload: { last_assistant_message: textOf(fixAgent, 49) } }),
  ])
  sync(s.id, o)
  const [stop] = woffOf(s.target, 'Stop')
  const [subStop] = woffOf(s.target, 'SubagentStop')
  assert.deepEqual(toks(s.target), [{ k: 'tok', woff: subStop, out: 116, inp: 1580 }])

  put(s.tr, fixMain.slice(18))
  sync(s.id, o)
  sync(s.id, o)
  assert.deepEqual(toks(s.target), [
    { k: 'tok', woff: subStop, out: 116, inp: 1580 },
    { k: 'tok', woff: stop, out: 41, inp: 1306 },
  ])

  // A clamped message: the hook's first 2000 chars plus its suffix still match; another text does not.
  const h = session()
  const long = `${'y'.repeat(2400)}tail`
  put(h.tr, [userPrompt('u1', 1), reply('a1', 'r1', 2, 100, 77, [{ type: 'text', text: long }], 'end_turn')])
  put(h.wal, [
    rec(sec(3), 'Stop', { payload: { last_assistant_message: `${long.slice(0, 2000)}…[+${long.length - 2000} chars]` } }),
    rec(sec(3), 'Stop', { payload: { last_assistant_message: 'something else' } }),
  ])
  sync(h.id)
  const [clamped] = woffOf(h.target, 'Stop')
  assert.deepEqual(toks(h.target), [{ k: 'tok', woff: clamped, out: 77, inp: 1 }])
})

test('a SubagentStop whose agent has no transcript file gets no tok', () => {
  const s = session(fixMain.length, fixAgent.length)
  put(s.wal, [rec('2026-09-30T11:08:07.000Z', 'SubagentStop', { agent_id: 'anofile0000000000', payload: { last_assistant_message: textOf(fixAgent, 49) } })])
  sync(s.id)
  sync(s.id)
  assert.deepEqual(toks(s.target), [])
})

test('a SubagentStop whose agent has no transcript file is dropped at SessionEnd', () => {
  const s = session(fixMain.length)
  const o = observer()
  put(s.wal, [
    rec('2026-09-30T11:08:07.000Z', 'SubagentStop', { agent_id: AGENT, payload: { last_assistant_message: textOf(fixAgent, 49) } }),
    rec('2026-09-30T11:08:08.000Z', 'SessionEnd'),
  ])
  sync(s.id, o)
  assert.deepEqual(toks(s.target), [])

  const dir = join(proj, s.id, 'subagents')
  mkdirSync(dir, { recursive: true })
  cpSync(join(fixDir, FIX, 'subagents', `agent-${AGENT}.meta.json`), join(dir, `agent-${AGENT}.meta.json`))
  writeFileSync(s.sub, fixAgent.join(''))
  sync(s.id, o)
  assert.ok(records(s.target).some((r) => r.k === 'agent' && r.id === AGENT))
  assert.deepEqual(toks(s.target), [])
})

test('a call whose tuid is in no transcript is dropped at SessionEnd', () => {
  const s = session()
  const o = observer()
  put(s.tr, [userPrompt('u1', 1), reply('a1', 'r1', 2, 100, 5, [{ type: 'text', text: 'hi' }], 'end_turn')])
  put(s.wal, [...call(sec(3), 'tgone'), rec(sec(4), 'SessionEnd')])
  sync(s.id, o)
  assert.deepEqual(tokOf(s.target, 'tgone'), [])

  put(s.tr, [
    reply('a2', 'r2', 5, 200, 7, [use('tgone', 'x')]),
    result('u2', 6, 'tgone', 'r'),
    reply('a3', 'r3', 7, 300, 3, [{ type: 'text', text: 'ok' }], 'end_turn'),
  ])
  sync(s.id, o)
  assert.deepEqual(toks(s.target), [])
})

test('a Stop message longer than the parser keeps still joins its reply', () => {
  const s = session()
  const text = 'z'.repeat(2500)
  put(s.tr, [userPrompt('u1', 1), reply('a1', 'r1', 2, 100, 77, [{ type: 'text', text }], 'end_turn')])
  put(s.wal, [rec(sec(3), 'Stop', { payload: { last_assistant_message: text } })])
  sync(s.id)
  const [stop] = woffOf(s.target, 'Stop')
  assert.deepEqual(toks(s.target), [{ k: 'tok', woff: stop, out: 77, inp: 1 }])
})

test('restart: a call left open gets its tok once, and a replay writes nothing', () => {
  // Without aMrgGL (line 18) the call has no next reply.
  const s = session(18)
  const o = observer()
  put(s.wal, call('2026-09-30T09:55:55.300Z', tu('gsNTiK')))
  sync(s.id, o)
  sync(s.id, o)
  assert.deepEqual(tokOf(s.target, tu('gsNTiK')), [])

  // From here each sync is a new observer: it rebuilds the waiting calls from the target.
  put(s.tr, fixMain.slice(18))
  sync(s.id)
  const built = readFileSync(s.target, 'utf8')
  sync(s.id)
  put(s.wal, call('2026-09-30T11:08:07.000Z', tu('SDhFtq')))
  sync(s.id)
  assert.ok(readFileSync(s.target, 'utf8').startsWith(built))
  assert.deepEqual(toks(s.target), [
    { k: 'tok', tuid: tu('gsNTiK'), out: 903, res: 401, inp: 374 },
    { k: 'tok', tuid: tu('SDhFtq'), out: 271, inp: 1745 },
  ])
  const done = readFileSync(s.target, 'utf8')
  sync(s.id)
  assert.equal(readFileSync(s.target, 'utf8'), done)
})

test('an MCP call row gets a tok', () => {
  const s = session(fixMain.length)
  put(s.wal, call('2026-09-30T09:55:55.300Z', tu('gsNTiK'), 'mcp__srv__find'))
  sync(s.id)
  const row = records(s.target).find((r) => r.k === 'call')
  assert.equal(row?.k === 'call' && row.mcp, true)
  assert.deepEqual(tokOf(s.target, tu('gsNTiK')), [{ k: 'tok', tuid: tu('gsNTiK'), out: 903, res: 401, inp: 374 }])
})

test('a session without a WAL: its call rows get toks and its Stop rows carry out', () => {
  const s = session(fixMain.length, fixAgent.length)
  sync(s.id)
  const byTuid = Object.fromEntries(toks(s.target).map((t) => ['tuid' in t ? t.tuid : '', t]))
  assert.deepEqual(byTuid[tu('gsNTiK')], { k: 'tok', tuid: tu('gsNTiK'), out: 903, res: 401, inp: 374 })
  assert.deepEqual(byTuid[tu('SDhFtq')], { k: 'tok', tuid: tu('SDhFtq'), out: 271, inp: 1745 })
  assert.deepEqual(byTuid[tu('6k9TNX')], { k: 'tok', tuid: tu('6k9TNX'), out: 111, res: 5265, inp: 11314 })
  // A session without a WAL never ends: the last call of the file stays open.
  assert.equal(byTuid[tu('2QYftU')], undefined)
  assert.ok(toks(s.target).every((t) => 'tuid' in t))
  const calls = records(s.target).filter((r) => r.k === 'call').length
  assert.equal(toks(s.target).length, calls - 1)

  const stops = records(s.target).flatMap((r) => (r.k === 'ev' && (r.event === 'Stop' || r.event === 'SubagentStop') ? [[r.event, r.out, r.inp]] : []))
  assert.deepEqual(stops, [
    ['Stop', 41, 1306],
    ['SubagentStop', 1160, 182],
    ['SubagentStop', 116, 1580],
  ])
})
