import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { isAllowedString } from './make-fixture.ts'
import { aggregate, createParser, type Pricing, type UsageRecord } from './transcripts.ts'

// biome-ignore lint/suspicious/noExplicitAny: raw fixture entries are schemaless JSON
type E = Record<string, any>

const ROOT = join(import.meta.dirname, 'fixtures/projects')
const DIR = join(ROOT, '-tmp-proj')
const MAIN = 'd01c2dfc-0a01-4e1f-825a-5b0462780f18'
const SUB = 'a6c7ff04911c76bce'
const mainBytes = readFileSync(join(DIR, `${MAIN}.jsonl`))
const subBytes = readFileSync(join(DIR, MAIN, 'subagents', `agent-${SUB}.jsonl`))
const subMeta = JSON.parse(readFileSync(join(DIR, MAIN, 'subagents', `agent-${SUB}.meta.json`), 'utf8')) as E
const pricing = JSON.parse(readFileSync(join(import.meta.dirname, 'pricing.json'), 'utf8')) as Pricing
const entries = (b: Buffer): E[] =>
  b
    .toString()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as E)
const must = <T>(v: T | undefined | null, what = 'value'): T => {
  assert.ok(v != null, `missing ${what}`)
  return v
}
const mainRaw = entries(mainBytes)
const subRaw = entries(subBytes)

const open = () => {
  const main = createParser('main')
  main.push(mainBytes)
  const sub = createParser(SUB, main.tools.get(subMeta.toolUseId)?.turn)
  sub.push(subBytes)
  return { main, sub, records: [...main.usage, ...sub.usage] }
}
const kindOf = (items: { uid: string; kind: string }[], uuid: string): string | undefined => items.find((i) => i.uid === uuid)?.kind
const groups = (raw: E[]): Map<string, E[]> => {
  const g = new Map<string, E[]>()
  for (const e of raw) if (e.type === 'assistant' && e.message.model !== '<synthetic>') g.set(e.message.id, [...(g.get(e.message.id) ?? []), e])
  return g
}

test('fixture holds only allowlisted strings and no home path', () => {
  const bad: string[] = []
  const walk = (v: unknown, path: string[], file: string): void => {
    if (typeof v === 'string') {
      if (!isAllowedString(path, v) || v.includes('/home/')) bad.push(`${file}: ${path.join('.')}`)
    } else if (Array.isArray(v)) for (const x of v) walk(x, path, file)
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, [...path, k], file)
  }
  const files = readdirSync(ROOT, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.jsonl') || f.endsWith('.json'))
  assert.ok(files.length >= 6)
  for (const f of files) for (const e of entries(readFileSync(join(ROOT, f)))) walk(e, [], f)
  assert.deepEqual(bad, [])
})

test('the parser reads no files itself', () => {
  assert.doesNotMatch(readFileSync(join(import.meta.dirname, 'transcripts.ts'), 'utf8'), /node:fs/)
})

test('file order agrees with the parent chain even where timestamps drop; items keep file order', () => {
  const seen = new Set<string>()
  let backRefs = 0
  for (const e of mainRaw.filter((x) => x.uuid)) {
    const p = e.parentUuid ?? e.logicalParentUuid
    if (p != null && !seen.has(p)) backRefs++
    seen.add(e.uuid)
  }
  assert.equal(backRefs, 0)
  const { main } = open()
  const fileOrder = mainRaw.map((e) => e.uuid)
  const uids = main.items.map((i) => i.uid.split(':')[0])
  assert.deepEqual(
    uids,
    fileOrder.filter((u) => uids.includes(u)),
  )
  const stamped = mainRaw.filter((e) => e.uuid)
  const drop = stamped.findIndex((e, i) => i > 0 && e.timestamp < must(stamped[i - 1]).timestamp)
  assert.ok(drop > 0)
})

test('a split reply is counted once; a subagent reply takes its final streamed usage', () => {
  const { main, sub } = open()
  const mg = groups(mainRaw)
  assert.equal(main.usage.length, mg.size)
  assert.equal(new Set(main.usage.map((r) => r.id)).size, mg.size)
  const [id, split] = must(
    [...mg].find(([, g]) => g.length >= 3),
    'split reply',
  )
  const head = must(split[0])
  assert.equal(must(main.usage.find((r) => r.id === id)).output, head.message.usage.output_tokens)
  const carriers = main.items.filter((i) => i.usage)
  assert.equal(carriers.length, mg.size)
  assert.equal(carriers.find((i) => i.uid === head.uuid)?.model, head.message.model)

  const sg = groups(subRaw)
  const streamed = [...sg].filter(([, g]) => must(g[0]).message.usage.output_tokens !== must(g.at(-1)).message.usage.output_tokens)
  assert.ok(streamed.length > 0)
  for (const [id, g] of sg) {
    const rec = must(sub.usage.find((r) => r.id === id))
    assert.equal(rec.output, must(g.at(-1)).message.usage.output_tokens)
    assert.equal(sub.items.find((i) => i.uid === must(g[0]).uuid)?.usage?.output, rec.output)
  }
})

test('a <synthetic> reply is an error item, never a request or tokens', () => {
  const { main } = open()
  const synth = must(mainRaw.find((e) => e.message?.model === '<synthetic>'))
  assert.equal(kindOf(main.items, synth.uuid), 'error')
  assert.equal(main.items.find((i) => i.uid === synth.uuid)?.usage, undefined)
  assert.ok(main.usage.every((r) => r.model !== '<synthetic>' && r.id !== synth.message.id))
})

test('turns count human input the model answers: prompts and /goal, not /clear', () => {
  const { main, sub } = open()
  const human = mainRaw.filter((e) => e.origin?.kind === 'human')
  assert.equal(human.length, 2)
  const goal = must(mainRaw.find((e) => String(e.message?.content).includes('<command-name>/goal</command-name>')))
  assert.equal(goal.origin, undefined)
  assert.deepEqual(
    main.turnStarts,
    [goal, ...human].map((e) => Date.parse(e.timestamp)),
  )
  const goalAt = main.items.findIndex((i) => i.uid === goal.uuid)
  const firstReply = main.items.findIndex((i) => i.model)
  assert.ok(goalAt < firstReply && main.items.slice(goalAt, firstReply + 1).every((i) => i.turn === 1))
  assert.deepEqual(
    main.items.filter((i) => i.kind === 'prompt').map((i) => i.uid),
    human.map((e) => e.uuid),
  )
  // /goal starts the first turn, so it is the fallback title, read as `/name args`.
  assert.equal(main.meta.firstPrompt, `/goal ${must(/<command-args>(.*)<\/command-args>/.exec(goal.message.content))[1]}`)
  assert.equal(main.meta.cwd, '/tmp/proj')
  const one = (p: (e: E) => boolean): string => must(mainRaw.find(p)).uuid
  assert.equal(
    kindOf(
      main.items,
      one((e) => e.origin?.kind === 'task-notification'),
    ),
    'notification',
  )
  assert.equal(
    kindOf(
      main.items,
      one((e) => e.isMeta && typeof e.message?.content === 'string'),
    ),
    'meta',
  )
  assert.equal(
    kindOf(
      main.items,
      one((e) => e.isCompactSummary),
    ),
    'meta',
  )
  assert.equal(
    kindOf(
      main.items,
      one((e) => /^<command-name>/.test(e.message?.content)),
    ),
    'command',
  )
  assert.equal(
    kindOf(
      main.items,
      one((e) => /^<local-command-stdout>/.test(e.message?.content)),
    ),
    'command',
  )
  assert.equal(kindOf(sub.items, must(subRaw[0]).uuid), 'meta')
  assert.equal(sub.turnStarts.length, 0)

  const clear = createParser('main')
  const clearRaw = readFileSync(join(DIR, '149b4f57-914a-4248-b3b7-5f6f35ab44d1.jsonl'))
  clear.push(clearRaw)
  assert.equal(clear.turnStarts.length, 0)
  const cmd = must(entries(clearRaw).find((e) => String(e.message?.content).includes('<command-name>/clear</command-name>')))
  assert.equal(kindOf(clear.items, cmd.uuid), 'command')
  assert.match(must(clear.items.find((i) => i.uid === cmd.uuid)).summary, /^\/clear/)
})

test('toolCalls counts tool and Agent calls; keepItems false drops the timeline, not the stats', () => {
  const { main } = open()
  assert.equal(main.meta.toolCalls, main.items.filter((i) => i.kind === 'tool' || i.kind === 'agent').length)
  assert.ok(main.meta.toolCalls > 0)
  const lean = createParser('main', 0, false)
  lean.push(mainBytes)
  assert.equal(lean.items.length, 0)
  assert.equal(lean.meta.toolCalls, main.meta.toolCalls)
  assert.deepEqual(lean.usage, main.usage)
  assert.deepEqual(lean.turnStarts, main.turnStarts)
  assert.equal(lean.tools.get(subMeta.toolUseId)?.turn, main.tools.get(subMeta.toolUseId)?.turn)
})

test('the Agent item links to its subagent, whose usage lands on the spawning turn', () => {
  const { main, sub, records } = open()
  const spawn = must(main.tools.get(subMeta.toolUseId))
  assert.equal(spawn.kind, 'agent')
  assert.equal(spawn.agentId, SUB)
  assert.equal(spawn.description, subMeta.description)
  const firstPrompt = mainRaw.findIndex((e) => e.origin?.kind === 'human')
  const spawnAt = mainRaw.findIndex((e) => e.uuid === spawn.uid)
  const secondPrompt = mainRaw.findLastIndex((e) => e.origin?.kind === 'human')
  assert.ok(firstPrompt < spawnAt && spawnAt < secondPrompt)
  assert.equal(spawn.turn, 2)
  assert.ok(sub.usage.length > 0 && sub.usage.every((r) => r.turn === 2))
  assert.ok(sub.items.every((i) => i.turn === 2 && i.agent === SUB))

  const sum = (rs: UsageRecord[]): number => rs.reduce((n, r) => n + r.output, 0)
  const all = aggregate(records, 'all', pricing, main.turnStarts)
  assert.equal(all.series.perTurn.output[2], sum(main.usage.filter((r) => r.turn === 2)) + sum(sub.usage))
  const agent = aggregate(records, `agent:${SUB}`, pricing, main.turnStarts)
  assert.equal(agent.stats.turns, 1)
  // Turn i + 1 starts at turnStarts[i] in every scope, so perTurn and turnStarts stay aligned.
  assert.deepEqual(agent.series.turnStarts, main.turnStarts)
  assert.equal(agent.series.perTurn.output.length, main.turnStarts.length + 1)
  assert.deepEqual(
    agent.series.perTurn.output.map((n, i) => (n > 0 ? i : -1)).filter((i) => i >= 0),
    [2],
  )
  assert.equal(agent.series.perTurn.output[2], sum(sub.usage))
})

test('compaction, tool errors and metadata', () => {
  const { main } = open()
  const boundary = must(mainRaw.find((e) => e.subtype === 'compact_boundary'))
  const c = boundary.compactMetadata
  assert.deepEqual(main.items.find((i) => i.uid === boundary.uuid)?.compact, { pre: c.preTokens, post: c.postTokens, trigger: c.trigger })
  assert.deepEqual(main.compacts, [{ t: Date.parse(boundary.timestamp), pre: c.preTokens, post: c.postTokens, trigger: c.trigger }])

  const errIds = mainRaw
    .flatMap((e) => (Array.isArray(e.message?.content) ? e.message.content : []))
    .filter((b: E) => b.type === 'tool_result' && b.is_error === true)
    .map((b: E) => b.tool_use_id)
  assert.ok(errIds.length > 0)
  assert.deepEqual(
    main.items.filter((i) => i.isError).map((i) => i.uid),
    errIds.map((id: string) => must(main.tools.get(id)).uid),
  )
  assert.ok(must(main.tools.get(errIds[0])).resultSrc)

  const cost = must(mainRaw.findLast((e) => e.type === 'cost-state'))
  assert.equal(main.meta.costUsd, cost.totalCostUSD)
  assert.deepEqual(main.meta.costByModel, Object.fromEntries(Object.entries(cost.modelUsage).map(([m, u]) => [m, (u as E).costUSD])))
  assert.equal(main.meta.first, Math.min(...mainRaw.filter((e) => e.timestamp).map((e) => Date.parse(e.timestamp))))
  main.push(Buffer.from(`${JSON.stringify({ type: 'ai-title', aiTitle: 'made-up later title', sessionId: MAIN })}\n`))
  assert.equal(main.meta.title, 'made-up later title')
})

test('a partial last line waits for its newline; spans re-slice to their exact line', () => {
  const target = must(mainRaw.findLast((e) => e.origin?.kind === 'human'))
  const at = mainBytes.indexOf(`"uuid":"${target.uuid}"`)
  const p = createParser('main')
  p.push(mainBytes.subarray(0, at))
  assert.equal(p.turnStarts.length, 2)
  assert.equal(kindOf(p.items, target.uuid), undefined)
  p.push(mainBytes.subarray(at))
  assert.equal(kindOf(p.items, target.uuid), 'prompt')
  for (const it of p.items) {
    const [off, len] = it.src
    assert.equal(mainBytes[off + len], 10)
    assert.equal((JSON.parse(mainBytes.toString('utf8', off, off + len)) as E).uuid, it.uid.split(':')[0])
  }
})

test('a tool result arriving in a later push pairs with its call', () => {
  const result = must(mainRaw.find((e) => e.toolUseResult?.agentId === SUB))
  const at = mainBytes.indexOf(`"uuid":"${result.uuid}"`)
  const p = createParser('main')
  p.push(mainBytes.subarray(0, mainBytes.lastIndexOf(10, at) + 1))
  const spawn = must(p.tools.get(subMeta.toolUseId))
  assert.equal(spawn.agentId, undefined)
  assert.equal(spawn.resultSrc, undefined)
  p.touched.clear()
  p.push(mainBytes.subarray(mainBytes.lastIndexOf(10, at) + 1))
  assert.equal(spawn.agentId, SUB)
  assert.ok(spawn.resultSrc)
  assert.ok(p.touched.has(spawn))
})

test('a human slash command titles the session as `/name args`', () => {
  const p = createParser('main')
  const content =
    '<command-message>mario:plan-review</command-message>\n<command-name>/mario:plan-review</command-name>\n<command-args>@.ai/changes/x/plan.md</command-args>'
  p.push(
    Buffer.from(
      `${JSON.stringify({ type: 'user', uuid: 'u1', timestamp: '2026-09-30T12:00:00Z', origin: { kind: 'human' }, message: { role: 'user', content } })}\n`,
    ),
  )
  assert.equal(p.meta.firstPrompt, '/mario:plan-review @.ai/changes/x/plan.md')
})

test('a chunk split inside a multibyte character, a 700 KB block and junk lines', () => {
  const text = `zażółć 👍 ${'a'.repeat(700_000)}`
  const line = Buffer.from(
    'not json\n' +
      JSON.stringify({
        type: 'assistant',
        uuid: 'u1',
        timestamp: '2026-09-30T12:00:00.000Z',
        message: { id: 'm1', model: 'claude-opus-5-5', content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 2 } },
      }) +
      '\n',
  )
  const cut = line.indexOf(Buffer.from('👍')) + 2
  const p = createParser('main')
  p.push(line.subarray(0, cut))
  assert.equal(p.items.length, 0)
  p.push(line.subarray(cut))
  assert.equal(p.items.length, 1)
  const item = must(p.items[0])
  const s = item.summary
  assert.ok(s.startsWith('zażółć 👍 aaa') && s.length <= 200 && s.endsWith('…'))
  assert.deepEqual(item.src, [9, line.length - 10])
})

test('aggregate: exact cost for priced models, null when any model is unpriced', () => {
  const rec = (model: string, agent = 'main', t = 0): UsageRecord => ({
    id: `${model}${t}`,
    t,
    agent,
    model,
    turn: 0,
    input: 1e6,
    output: 1e6,
    cacheRead: 1e6,
    cacheWrite5m: 1e6,
    cacheWrite1h: 1e6,
    thinking: 1e6,
  })
  const p = must(pricing.models['claude-opus-5-5'])
  const unit = p.input + p.output + p.cacheRead + p.cacheWrite5m + p.cacheWrite1h
  const priced = aggregate([rec('claude-opus-5-5')], 'all', pricing, [])
  assert.ok(Math.abs(must(priced.stats.totals.cost) - unit) < 1e-9)
  const mixed = aggregate([rec('claude-opus-5-5', 'main', 1), rec('claude-unpriced', 'main', 2)], 'all', pricing, [])
  assert.equal(mixed.stats.totals.cost, null)
  assert.ok(Math.abs(must(must(mixed.stats.models['claude-opus-5-5']).cost) - unit) < 1e-9)
  assert.equal(must(mixed.stats.models['claude-unpriced']).cost, null)
  assert.equal(mixed.stats.totals.requests, 2)
})

test('aggregate: scopes partition requests; series are ascending and sum to the totals', () => {
  const { main, records } = open()
  const all = aggregate(records, 'all', pricing, main.turnStarts)
  const m = aggregate(records, 'main', pricing, main.turnStarts)
  const a = aggregate(records, `agent:${SUB}`, pricing, main.turnStarts)
  assert.equal(all.stats.totals.requests, m.stats.totals.requests + a.stats.totals.requests)
  assert.deepEqual(Object.keys(all.stats.agents).sort(), ['a6c7ff04911c76bce', 'main'])
  assert.equal(typeof all.stats.totals.cost, 'number')
  assert.equal(all.stats.turns, 3)
  const t = all.series.t
  assert.ok(t.every((x, i) => i === 0 || x >= must(t[i - 1])))
  assert.equal(all.stats.duration, must(t.at(-1)) - must(t[0]))
  assert.ok(!('thinking' in all.series.cumulative))
  for (const k of ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h'] as const) {
    assert.equal(all.series.cumulative[k].at(-1), all.stats.totals[k])
    assert.equal(
      all.series.perTurn[k].reduce((x, y) => x + y, 0),
      all.stats.totals[k],
    )
  }
})
