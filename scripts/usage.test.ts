#!/usr/bin/env node

// usage.test.ts — /usage and /usage-stream over a pick, against a temp copy of the fixture
// projects under a fake HOME plus two generated sessions: one without a recorded cost, one on an
// unpriced model.

import { randomUUID } from 'node:crypto'
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { get, type IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SessionView, StatRow, UsageTotals } from '../shared/api.ts'
import { startServer } from './test-server.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'walusage.'))
const root = join(dir, '.claude', 'projects')
cpSync(join(HERE, 'fixtures', 'projects'), root, { recursive: true })

const MAIN = 'd01c2dfc-0a01-4e1f-825a-5b0462780f18'
const TREE = '301167f7-f843-4c79-965b-ae99c2d50f5e'
const PRICED = 'aaaaaaaa-0000-4000-8000-0000000000a1'
const UNPRICED = 'aaaaaaaa-0000-4000-8000-0000000000a2'
const treeFile = join(root, '-tmp-proj--ai-worktrees-demo', `${TREE}.jsonl`)

const reply = (session: string, model: string, input: number, output: number): string =>
  `${JSON.stringify({
    type: 'assistant',
    uuid: randomUUID(),
    parentUuid: null,
    timestamp: new Date().toISOString(),
    sessionId: session,
    message: {
      id: `msg_${randomUUID()}`,
      role: 'assistant',
      model,
      content: [{ type: 'text', text: 'hi' }],
      usage: { input_tokens: input, output_tokens: output },
    },
  })}\n`
writeFileSync(join(root, '-tmp-proj', `${PRICED}.jsonl`), reply(PRICED, 'claude-opus-5-5', 100, 50))
writeFileSync(join(root, '-tmp-proj', `${UNPRICED}.jsonl`), reply(UNPRICED, 'claude-mystery-1', 7, 3))

const { server, base: BASE } = await startServer([], { HOME: dir })
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — ${detail}`}`)
  if (!ok) fail = 1
}
const json = async <T>(path: string): Promise<T> => {
  const r = await fetch(BASE + path)
  if (!r.ok) throw new Error(`${path}: status ${r.status}`)
  return (await r.json()) as T
}
const status = async (path: string): Promise<number> => (await fetch(BASE + path)).status
const must = <T>(v: T | undefined | null, what = 'value'): T => {
  if (v == null) throw new Error(`missing ${what}`)
  return v
}

const KEYS = ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h', 'thinking', 'requests'] as const
const sum = (rows: StatRow[]): StatRow => {
  const out: StatRow = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, thinking: 0, requests: 0, cost: 0 }
  for (const r of rows) {
    for (const k of KEYS) out[k] += r[k]
    out.cost = out.cost === null || r.cost === null ? null : out.cost + r.cost
  }
  return out
}
const same = (a: StatRow, b: StatRow): boolean =>
  KEYS.every((k) => a[k] === b[k]) && (a.cost === null ? b.cost === null : b.cost !== null && Math.abs(a.cost - b.cost) < 1e-9)

interface Stream {
  frames: UsageTotals[]
  lastId: string | null
  unknown: string[] | null
  res?: IncomingMessage
}
const streams: Stream[] = []
const open = (qs: string, headers: Record<string, string> = {}): Promise<Stream> =>
  new Promise((resolve) => {
    const s: Stream = { frames: [], lastId: null, unknown: null }
    get(`${BASE}/usage-stream?${qs}`, { headers }, (res) => {
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
          if (f.event === 'unknown') s.unknown = JSON.parse(must(f.data, 'unknown event data')) as string[]
          else if (f.data) {
            s.frames.push(JSON.parse(f.data) as UsageTotals)
            s.lastId = f.id ?? null
          }
        }
      })
      streams.push(s)
      resolve(s)
    })
  })

try {
  console.log('usage.test.ts')

  const view = (id: string): Promise<SessionView> => json<SessionView>(`/session?id=${id}&scope=all`)
  const [m, t, p, u] = await Promise.all([view(MAIN), view(TREE), view(PRICED), view(UNPRICED)])
  check('fixture: MAIN has a subagent with usage', m.agents.length > 0 && Object.keys(m.stats.agents).length > 1)

  const two = await json<UsageTotals>(`/usage?ids=${MAIN},${TREE}`)
  check(
    "/usage totals equal the sum of each session's /session totals",
    same(two.totals, sum([m.stats.totals, t.stats.totals])),
    JSON.stringify({ got: two.totals, want: sum([m.stats.totals, t.stats.totals]) }),
  )
  check('estimated cost is priced', two.totals.cost !== null && two.totals.cost > 0)
  check(
    'recorded sums both recorded costs, none missing',
    two.missing === 0 && two.recorded !== null && Math.abs(two.recorded - must(m.recordedCostUsd).total - must(t.recordedCostUsd).total) < 1e-9,
    JSON.stringify(two),
  )
  check('the pick order does not change the sums', same((await json<UsageTotals>(`/usage?ids=${TREE},${MAIN}`)).totals, two.totals))

  const partial = await json<UsageTotals>(`/usage?ids=${MAIN},${PRICED}`)
  check(
    'recorded over a partial pick sums the sessions that have one',
    partial.missing === 1 && partial.recorded !== null && Math.abs(partial.recorded - must(m.recordedCostUsd).total) < 1e-9,
    JSON.stringify(partial),
  )
  check('...and its totals still cover every picked session', same(partial.totals, sum([m.stats.totals, p.stats.totals])))
  const none = await json<UsageTotals>(`/usage?ids=${PRICED}`)
  check('recorded is null only when no picked session has one', none.recorded === null && none.missing === 1 && none.totals.cost !== null, JSON.stringify(none))

  const unpriced = await json<UsageTotals>(`/usage?ids=${MAIN},${UNPRICED}`)
  check(
    'an unpriced model makes the estimated cost null',
    u.stats.totals.cost === null && unpriced.totals.cost === null && unpriced.totals.input === m.stats.totals.input + 7,
    JSON.stringify(unpriced.totals),
  )

  const empty = await json<UsageTotals>('/usage?ids=')
  check(
    'empty pick: zero totals, recorded null, none missing',
    empty.totals.requests === 0 && empty.totals.cost === 0 && empty.recorded === null && empty.missing === 0,
    JSON.stringify(empty),
  )
  check('malformed id is 400', (await status(`/usage?ids=${MAIN},abc`)) === 400 && (await status(`/usage-stream?ids=abc`)) === 400)
  const ZERO = '0'.repeat(36)
  const withUnknown = await json<UsageTotals>(`/usage?ids=${MAIN},${ZERO}`)
  check('an unknown id is skipped and reported', same(withUnknown.totals, m.stats.totals) && withUnknown.unknown.join() === ZERO, JSON.stringify(withUnknown))
  check('pipe has one key per found id, none for an unknown one', Object.keys(withUnknown.pipe ?? {}).join() === MAIN, JSON.stringify(withUnknown.pipe))
  check('a repeated id is summed once', same((await json<UsageTotals>(`/usage?ids=${MAIN},${MAIN}`)).totals, m.stats.totals))
  const lone = await open(`ids=${ZERO}`)
  await wait(500)
  check(
    'a stream opens with an unknown event naming the skipped ids',
    lone.unknown?.join() === ZERO && lone.frames.length === 0,
    JSON.stringify({ unknown: lone.unknown, frames: lone.frames }),
  )

  // A failed lookup is remembered until the next /sessions, so a stream tick does not rescan every source.
  const LATE = 'aaaaaaaa-0000-4000-8000-0000000000a3'
  check('a session not on disk is unknown', (await json<UsageTotals>(`/usage?ids=${LATE}`)).unknown.join() === LATE)
  writeFileSync(join(root, '-tmp-proj', `${LATE}.jsonl`), reply(LATE, 'claude-opus-5-5', 1, 1))
  check('...and stays unknown until /sessions is listed', (await json<UsageTotals>(`/usage?ids=${LATE}`)).unknown.join() === LATE)
  await json('/sessions')
  const found = await json<UsageTotals>(`/usage?ids=${LATE}`)
  check('...after which it is found', found.unknown.length === 0 && found.totals.requests === 1, JSON.stringify(found))

  const s = await open(`ids=${MAIN},${TREE}`)
  await wait(500)
  check(
    'the stream opens with the current totals',
    s.frames.length === 1 && same(must(s.frames[0]).totals, two.totals) && must(s.frames[0]).recorded === two.recorded,
    JSON.stringify(s.frames),
  )
  check(
    'frame id is a version vector over the pick',
    s.lastId !== null &&
      s.lastId
        .split(',')
        .map((x) => x.split(':')[0])
        .sort()
        .join() === [MAIN, TREE].sort().join(),
    String(s.lastId),
  )
  const resumed = await open(`ids=${MAIN},${TREE}`, { 'last-event-id': must(s.lastId, 'last event id') })
  await wait(500)
  check('Last-Event-ID at the current versions sends nothing', resumed.frames.length === 0, String(resumed.frames.length))

  appendFileSync(treeFile, reply(TREE, 'claude-opus-5-5', 10, 20))
  await wait(700)
  const last = must(s.frames.at(-1), 'usage frame')
  check(
    'appending a reply to one session sends a new frame',
    s.frames.length === 2 && last.totals.output === two.totals.output + 20 && last.totals.requests === two.totals.requests + 1,
    JSON.stringify(s.frames.map((f) => f.totals.output)),
  )
  check('the resumed stream gets it too', resumed.frames.length === 1 && same(must(resumed.frames[0]).totals, last.totals))
  await wait(500)
  check('no frame while nothing grows', s.frames.length === 2, String(s.frames.length))

  writeFileSync(treeFile, readFileSync(treeFile).subarray(0, 100))
  await wait(700)
  const stale = must(s.frames.at(-1), 'usage frame')
  check(
    'a truncated transcript gives a frame with pipe[id].stale',
    s.frames.length === 3 && stale.pipe?.[TREE]?.stale === 'transcript shrank',
    JSON.stringify(stale.pipe),
  )
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
