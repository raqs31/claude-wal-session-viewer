#!/usr/bin/env node

// sessions.test.ts — the Sessions endpoints against a temp copy of the fixture projects under a
// fake HOME: the list, /session stats and scopes, per-agent stats, and the multiplexed
// /session-stream following growing transcripts.

import { randomUUID } from 'node:crypto'
import { appendFileSync, copyFileSync, cpSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { get, type IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SessionList, SessionView } from '../shared/api.ts'
import { startServer } from './test-server.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'walsess.'))
const root = join(dir, '.claude', 'projects')
cpSync(join(HERE, 'fixtures', 'projects'), root, { recursive: true })

const MAIN = 'd01c2dfc-0a01-4e1f-825a-5b0462780f18'
const CLEAR = '149b4f57-914a-4248-b3b7-5f6f35ab44d1'
const TREE = '301167f7-f843-4c79-965b-ae99c2d50f5e'
const SIBLING = 'c70f5199-e71d-4ffc-986e-125dbd885dc8'
const SUB = 'a6c7ff04911c76bce'
const mainFile = join(root, '-tmp-proj', `${MAIN}.jsonl`)
const subDir = join(root, '-tmp-proj', MAIN, 'subagents')

appendFileSync(mainFile, `${JSON.stringify({ type: 'ai-title', aiTitle: 'Latest title', sessionId: MAIN })}\n`)
const at = (s: number): Date => new Date(Date.UTC(2026, 8, 30, 12, 0, s))
utimesSync(mainFile, at(30), at(30))
utimesSync(join(root, '-tmp-proj--ai-worktrees-demo', `${TREE}.jsonl`), at(20), at(20))
utimesSync(join(root, '-tmp-proj', `${CLEAR}.jsonl`), at(10), at(10))
utimesSync(join(root, '-tmp-proj2', `${SIBLING}.jsonl`), at(5), at(5))

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
const json = async <T>(path: string): Promise<T> => {
  const r = await fetch(BASE + path)
  if (!r.ok) throw new Error(`status ${r.status}`)
  return (await r.json()) as T
}
const status = async (path: string): Promise<number> => (await fetch(BASE + path)).status

const must = <T>(v: T | undefined | null, what = 'value'): T => {
  if (v == null) throw new Error(`missing ${what}`)
  return v
}

interface Stream {
  frames: SessionView[]
  resets: number
  lastId: string | null
  res?: IncomingMessage
}
const streams: Stream[] = []
const open = (qs: string, headers: Record<string, string> = {}): Promise<Stream> =>
  new Promise((resolve, reject) => {
    const s: Stream = { frames: [], resets: 0, lastId: null }
    get(`${BASE}/session-stream?${qs}`, { headers }, (res) => {
      s.res = res
      if (res.statusCode !== 200) return reject(new Error(`status ${res.statusCode}`))
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
          else if (f.data) {
            s.frames.push(JSON.parse(f.data) as SessionView)
            s.lastId = f.id ?? null
          }
        }
      })
      streams.push(s)
      resolve(s)
    })
  })
const of = (s: Stream, id: string): SessionView[] => s.frames.filter((f) => f.id === id)
const latest = (s: Stream, id: string): SessionView => must(of(s, id).at(-1), `${id} frame`)
const vec = (...vs: SessionView[]): string => vs.map((v) => `${v.id}:${v.version}`).join(',')

// Expected per-agent stats straight from the raw lines: one tool call per tool_use block of a
// non-synthetic reply; a request's time is its first entry carrying usage.
// biome-ignore lint/suspicious/noExplicitAny: raw transcript lines are schemaless JSON
const raw = (file: string): Record<string, any>[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
const expect = (file: string): { tools: number; duration: number; context: number } => {
  const replies = raw(file).filter((e) => e.type === 'assistant' && e.uuid && e.message?.model !== '<synthetic>')
  const tools = replies.flatMap((e) => e.message.content ?? []).filter((b: { type: string }) => b.type === 'tool_use' || b.type === 'server_tool_use').length
  const firsts = new Map<string, number>()
  // biome-ignore lint/suspicious/noExplicitAny: raw transcript lines are schemaless JSON
  const finals = new Map<string, any>()
  for (const e of replies) {
    if (!e.message.usage) continue
    if (!firsts.has(e.message.id ?? e.uuid)) firsts.set(e.message.id ?? e.uuid, Date.parse(e.timestamp))
    finals.set(e.message.id ?? e.uuid, e.message.usage)
  }
  const ts = [...firsts.values()]
  const u = [...finals.values()].at(-1)
  const context = u
    ? (u.input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0) +
      (u.cache_creation?.ephemeral_5m_input_tokens ?? 0) +
      (u.cache_creation?.ephemeral_1h_input_tokens ?? 0)
    : 0
  return { tools, duration: ts.length > 1 ? Math.max(...ts) - Math.min(...ts) : 0, context }
}

try {
  console.log('sessions.test.ts')

  const list = await until(() => json<SessionList>('/sessions'))
  check(
    "list is every project's sessions, newest first",
    list.sessions.map((s) => s.id).join() === [MAIN, TREE, CLEAR, SIBLING].join(),
    JSON.stringify(list.sessions.map((s) => s.id)),
  )
  check(
    'list reports the default source',
    list.sources.length === 1 && list.sources[0]?.label === 'default' && list.sources[0]?.projectsDir === root,
    JSON.stringify(list.sources),
  )
  const [m, tree] = list.sessions
  check('title is the last ai-title', m?.title === 'Latest title', m?.title)
  check('worktree label is the folder suffix, null for the project', tree?.worktree === 'demo' && m?.worktree === null, JSON.stringify(list.sessions))
  check('started comes from the head, size from stat', typeof m?.started === 'number' && m.transcriptSize === readFileSync(mainFile).length, JSON.stringify(m))

  const all = await json<SessionView>(`/session?id=${MAIN}&scope=all`)
  check(
    '/session carries stats, series and agents',
    all.id === MAIN &&
      all.stats.totals.requests > 0 &&
      all.series.t.length === all.stats.totals.requests &&
      all.agents.some((a) => a.id === SUB && a.type === 'general-purpose' && a.prompt === 'x'.repeat(40)),
    JSON.stringify(all.agents),
  )
  check(
    '/session carries no timeline',
    ['items', 'next', 'head'].every((k) => !(k in all)) && all.agents.every((a) => !('spawnUid' in a) && !('head' in a)),
    Object.keys(all).join(),
  )
  check('scope all counts subagent usage', !!all.stats.agents[SUB] && !!all.stats.agents.main)
  const em = expect(mainFile)
  const es = expect(join(subDir, `agent-${SUB}.jsonl`))
  check(
    'agentStats: tool calls per agent',
    all.agentStats.main?.tools === em.tools && all.agentStats[SUB]?.tools === es.tools && em.tools > 0 && es.tools > 0,
    JSON.stringify({ got: all.agentStats, em, es }),
  )
  check(
    'agentStats: duration is last − first request',
    all.agentStats.main?.duration === em.duration && all.agentStats[SUB]?.duration === es.duration && es.duration > 0,
    JSON.stringify({ got: all.agentStats, em, es }),
  )
  check(
    "agentStats: context is the last request's prompt",
    all.agentStats.main?.context === em.context && all.agentStats[SUB]?.context === es.context && em.context > 0 && es.context > 0,
    JSON.stringify({ got: all.agentStats, em, es }),
  )
  check('agentStats keys match stats.agents', Object.keys(all.agentStats).sort().join() === Object.keys(all.stats.agents).sort().join())

  const main = await json<SessionView>(`/session?id=${MAIN}&scope=main`)
  check(
    'scope main excludes subagent usage',
    Object.keys(main.stats.agents).join() === 'main' &&
      Object.keys(main.agentStats).join() === 'main' &&
      main.stats.totals.requests < all.stats.totals.requests &&
      main.recordedCostUsd === null,
  )
  const sub = await json<SessionView>(`/session?id=${MAIN}&scope=agent:${SUB}`)
  check(
    'scope agent returns that agent only',
    Object.keys(sub.stats.agents).join() === SUB && Object.keys(sub.agentStats).join() === SUB,
    JSON.stringify(Object.keys(sub.stats.agents)),
  )
  check('scopes add up', main.stats.totals.requests + sub.stats.totals.requests === all.stats.totals.requests)
  check(
    'recorded cost keys drop the context suffix',
    all.recordedCostUsd !== null && 'claude-opus-5-5' in all.recordedCostUsd.models && Object.keys(all.recordedCostUsd.models).every((k) => !k.includes('[')),
    JSON.stringify(all.recordedCostUsd),
  )
  check(
    'unknown agent is 404, bad scope 400',
    (await status(`/session?id=${MAIN}&scope=agent:nope`)) === 404 &&
      (await status(`/session?id=${MAIN}&scope=agent:../x`)) === 400 &&
      (await status(`/session?id=${MAIN}&scope=bogus`)) === 400,
  )
  check(
    'malformed or climbing id is 400, unknown 404',
    (await status('/session?id=../../etc/passwd&scope=all')) === 400 &&
      (await status('/session?id=abc&scope=all')) === 400 &&
      (await status(`/session?id=${'0'.repeat(36)}&scope=all`)) === 404,
  )
  check('a session of another project is reachable', (await status(`/session?id=${SIBLING}&scope=all`)) === 200)
  check('/item is gone', (await status(`/item?id=${MAIN}&uid=x&gen=${all.gen}`)) === 404)

  const treeView = await json<SessionView>(`/session?id=${TREE}&scope=all`)
  const s = await open(`ids=${MAIN},${TREE}`)
  await wait(500)
  check(
    'without since, the first tick sends one frame per picked session',
    s.frames.length === 2 && of(s, MAIN).length === 1 && of(s, TREE).length === 1,
    JSON.stringify(s.frames.map((f) => f.id)),
  )
  check(
    'frames are full scope-all views',
    latest(s, MAIN).stats.totals.requests === all.stats.totals.requests &&
      latest(s, MAIN).agentStats[SUB]?.tools === es.tools &&
      latest(s, MAIN).recordedCostUsd?.total === all.recordedCostUsd?.total,
  )
  check(
    'frame id is the version vector',
    s.lastId !== null && s.lastId.split(',').sort().join() === vec(all, treeView).split(',').sort().join(),
    `${s.lastId} vs ${vec(all, treeView)}`,
  )
  const quiet = await open(`ids=${MAIN},${TREE}&since=${vec(all, treeView)}`)
  const resumed = await open(`ids=${MAIN},${TREE}&since=${MAIN}:0`, { 'last-event-id': vec(all, treeView) })
  await wait(500)
  check('since at the current versions sends nothing', quiet.frames.length === 0, String(quiet.frames.length))
  check('Last-Event-ID beats since', resumed.frames.length === 0, String(resumed.frames.length))
  check(
    'a malformed id in a pick is 400, an unknown one is skipped',
    (await status(`/session-stream?ids=${MAIN},abc`)) === 400 && (await status(`/session-stream?ids=${MAIN},${'0'.repeat(36)}`)) === 200,
  )

  const now = new Date().toISOString()
  const prompt = {
    type: 'user',
    uuid: randomUUID(),
    parentUuid: null,
    isSidechain: false,
    timestamp: now,
    origin: { kind: 'human' },
    sessionId: MAIN,
    message: { role: 'user', content: 'zażółć 🐢' },
  }
  const replyUuid = randomUUID()
  const reply = {
    type: 'assistant',
    uuid: replyUuid,
    parentUuid: prompt.uuid,
    timestamp: now,
    sessionId: MAIN,
    message: {
      id: 'msg_live',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [
        { type: 'text', text: `${'x'.repeat(700_000)}🐢` },
        { type: 'tool_use', id: 'toolu_live', name: 'Read', input: { file_path: '/x' } },
      ],
      usage: { input_tokens: 10, output_tokens: 20 },
    },
  }
  const bytes = Buffer.from(`${JSON.stringify(prompt)}\n${JSON.stringify(reply)}\n`)
  // Cut inside the reply's emoji, so the held-back tail starts mid-character.
  const cut = bytes.lastIndexOf(Buffer.from('🐢')) + 2
  appendFileSync(mainFile, bytes.subarray(0, cut))
  await wait(700)
  check('the grown session alone gets a frame', of(quiet, MAIN).length >= 1 && of(quiet, TREE).length === 0, JSON.stringify(quiet.frames.map((f) => f.id)))
  check(
    'complete line counts, partial one is held back',
    latest(quiet, MAIN).stats.turns === all.stats.turns + 1 && latest(quiet, MAIN).stats.totals.requests === all.stats.totals.requests,
  )
  appendFileSync(mainFile, bytes.subarray(cut))
  await wait(700)
  const after = latest(quiet, MAIN)
  check(
    'the completed reply reaches stats',
    after.stats.totals.requests === all.stats.totals.requests + 1 && after.stats.totals.output === all.stats.totals.output + 20,
  )
  check('its tool call reaches agentStats', after.agentStats.main?.tools === em.tools + 1, JSON.stringify(after.agentStats.main))
  check('its prompt becomes the context at end', after.agentStats.main?.context === 10, JSON.stringify(after.agentStats.main))
  check('frame versions only grow', of(quiet, MAIN).every((f, i, fs) => i === 0 || f.version > must(fs[i - 1]).version) && after.version > all.version)

  copyFileSync(join(subDir, `agent-${SUB}.jsonl`), join(subDir, 'agent-bnew.jsonl'))
  copyFileSync(join(subDir, `agent-${SUB}.meta.json`), join(subDir, 'agent-bnew.meta.json'))
  await wait(700)
  const grown = latest(quiet, MAIN)
  check(
    'a subagent appearing mid-session reaches the stream',
    grown.agents.some((a) => a.id === 'bnew') && !!grown.stats.agents.bnew && grown.agentStats.bnew?.tools === es.tools,
    JSON.stringify(grown.agents),
  )
  check('the new subagent is a scope', (await json<SessionView>(`/session?id=${MAIN}&scope=agent:bnew`)).stats.totals.requests === sub.stats.totals.requests)

  // Eight sessions stay open; one a stream picks is never evicted. The tick re-touches MAIN and
  // TREE every 250 ms, so the opens run back to back to leave CLEAR the oldest.
  const extra = Array.from({ length: 8 }, () => randomUUID())
  for (const id of extra) copyFileSync(join(root, '-tmp-proj', `${CLEAR}.jsonl`), join(root, '-tmp-proj', `${id}.jsonl`))
  const clearGen = (await json<SessionView>(`/session?id=${CLEAR}&scope=all`)).gen
  await Promise.all(extra.map((id) => json<SessionView>(`/session?id=${id}&scope=all`)))
  check('LRU evicts the oldest session without a stream', (await json<SessionView>(`/session?id=${CLEAR}&scope=all`)).gen > clearGen)
  check('a streamed session survives eviction', (await json<SessionView>(`/session?id=${MAIN}&scope=all`)).gen === all.gen)

  writeFileSync(mainFile, readFileSync(mainFile).subarray(0, 100))
  await wait(700)
  const reopened = latest(quiet, MAIN)
  check(
    'truncating the main file sends a frame with a higher gen, no reset',
    reopened.gen > all.gen && !reopened.stats.agents.main && quiet.resets === 0,
    JSON.stringify({ gen: reopened.gen, agents: Object.keys(reopened.stats.agents) }),
  )
  check('re-opened session keeps that gen', (await json<SessionView>(`/session?id=${MAIN}&scope=all`)).gen === reopened.gen)
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
