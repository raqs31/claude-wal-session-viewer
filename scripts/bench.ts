#!/usr/bin/env node
// bench.ts — proves the server-side index and query stay within budget on five 20 MB WALs picked together.
//
// The generator puts a multibyte character across the first 8 MB chunk boundary, so /record on
// that line is the only check of the partial line carried between chunk reads. Each session also gets a
// transcript with a reply and a result for every call, so the token join has numbers for every row but the last.

import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FirstPage, ObserverStatus, Row } from '../shared/api.ts'
import { startServer } from './test-server.ts'

const dir = mkdtempSync(join(tmpdir(), 'walbench.'))
const proj = join(dir, '.claude', 'projects', '-bench')
mkdirSync(proj, { recursive: true })
const CHUNK = 8 * 1024 * 1024
const SESSIONS = 5
const SESSION_BYTES = 20 * 1024 * 1024
const ids = Array.from({ length: SESSIONS }, (_, n) => `cccccccc-0000-4000-8000-00000000000${n + 1}`)
// Session 0 carries the chunk-boundary probe; session 2 the single full-scan needle.
const BOUNDARY_SESSION = 0
const RARE_SESSION = 2
const RARE_LINE = 4321
const BUILD_MAX_MS = 30_000
const MIN_TOK = 2000

const EVENTS = ['PreToolUse', 'PostToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'PostToolUseFailure', 'SessionStart']
const TOOLS = ['Bash', 'Read', 'Edit', 'Grep', 'Write', 'Task']
const T0 = Date.parse('2026-09-01T00:00:00Z')
const STEP_MS = 800

// "needle" appears in every 5th line (frequent) and "haystackrare" in exactly one.
const filler = 'lorem ipsum dolor sit amet zażółć gęślą jaźń — '.repeat(20)
const eventOf = (i: number): string => EVENTS[i % EVENTS.length] ?? ''
const isPost = (i: number): boolean => eventOf(i) === 'PostToolUse' || eventOf(i) === 'PostToolUseFailure'
const tuidOf = (i: number): string => `toolu_01${String(i).padStart(22, '0')}`
const record = (i: number, text: string): string => {
  const event = eventOf(i)
  const payload: Record<string, unknown> = { text }
  // The response is what a call row holds for `q`: only the call rows of every 5th line match "needle" in it.
  if (isPost(i)) payload.tool_response = i % 5 === 0 ? 'ok needle' : 'ok'
  const rec: Record<string, unknown> = { ts: new Date(T0 + i * STEP_MS).toISOString(), event, session_id: `s${i % 7}`, payload }
  // A real id on every tool row, so RSS includes the per-entry tuid the index keeps.
  if (event.includes('Tool')) Object.assign(rec, { tool_name: TOOLS[i % TOOLS.length], tool_use_id: tuidOf(i) })
  if (event === 'PostToolUse') rec.duration_ms = (i * 37) % 4000
  return JSON.stringify(rec)
}

// The reply that made call `i` and the result it got. The next reply's prompt grows by this reply's output and the
// result, so the join gives the call `out` and `res`.
const OUT = (i: number): number => 20 + ((i * 53) % 1200)
const RES = (i: number): number => (i * 31) % 3000
const exchange = (i: number, prompt: number): string => {
  const ts = new Date(T0 + i * STEP_MS).toISOString()
  const reply = {
    type: 'assistant',
    uuid: `a-${i}`,
    timestamp: ts,
    message: {
      id: `msg_${i}`,
      model: 'claude-opus-5-5',
      role: 'assistant',
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: tuidOf(i), name: TOOLS[i % TOOLS.length], input: { command: `echo ${i}` } }],
      usage: { input_tokens: 3, cache_read_input_tokens: prompt - 3, output_tokens: OUT(i) },
    },
  }
  const result = {
    type: 'user',
    uuid: `u-${i}`,
    timestamp: ts,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tuidOf(i), content: 'ok' }] },
  }
  return `${JSON.stringify(reply)}\n${JSON.stringify(result)}\n`
}

let total = 0
let totalLines = 0
let callRows = 0
let boundarySeq = -1
for (const [n, id] of ids.entries()) {
  // Discovery locates a session by its transcript.
  const trFd = openSync(join(proj, `${id}.jsonl`), 'w')
  let prompt = 10_000
  const fd = openSync(join(proj, `${id}.wal.jsonl`), 'w')
  let offset = 0
  let lines = 0
  for (let i = 0; offset < SESSION_BYTES; i++) {
    let text = filler.slice(0, 700 + (i % 200)) + (i % 5 === 0 ? ' needle' : '') + (n === RARE_SESSION && i === RARE_LINE ? ' haystackrare' : '')
    if (i % 20000 === 7) text = filler.repeat(400)
    if (n === BOUNDARY_SESSION && boundarySeq < 0 && offset >= CHUNK - 2000) {
      // 'ż' is two bytes: start it on the last byte before the boundary so it is split across reads.
      const probe = record(i, 'MARK')
      const prefix = Buffer.byteLength(probe.slice(0, probe.indexOf('MARK')))
      text = `${'x'.repeat(CHUNK - 1 - offset - prefix)}żboundary`
      boundarySeq = i
    }
    const buf = Buffer.from(`${record(i, text)}\n`)
    writeSync(fd, buf)
    if (isPost(i)) {
      writeSync(trFd, exchange(i, prompt))
      prompt += OUT(i) + RES(i)
      callRows++
    }
    offset += buf.length
    lines++
  }
  closeSync(fd)
  closeSync(trFd)
  total += offset
  totalLines += lines
}

let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — ${detail}`}`)
  if (!ok) fail = 1
}
const timed = async (path: string): Promise<{ ms: number; body: FirstPage }> => {
  const t = performance.now()
  const r = await fetch(`${BASE}${path}`)
  const body = (await r.json()) as FirstPage
  return { ms: Math.round(performance.now() - t), body }
}
const rssMb = (): number => Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${server.pid}/status`, 'utf8'))?.[1]) / 1024

console.log(`bench: ${SESSIONS} sessions, ${(total / 1048576).toFixed(0)} MB, ${totalLines} lines, ${callRows} calls`)
const started = performance.now()
const { server, base: BASE } = await startServer([], { HOME: dir })
const tokens = (r: Row): number => (r.out ?? 0) + (r.res ?? 0)
try {
  // The background build starts a second after the server does; no query is timed before it is done.
  let status: ObserverStatus | undefined
  while (performance.now() - started < 2 * BUILD_MAX_MS) {
    status = (await (await fetch(`${BASE}/observer`)).json()) as ObserverStatus
    if (status.built === status.total || status.stale.length) break
    await new Promise((r) => setTimeout(r, 250))
  }
  const buildMs = Math.round(performance.now() - started)
  console.log(`build           ${buildMs} ms`)
  check('every session built', status?.built === SESSIONS && status.total === SESSIONS && status.stale.length === 0, JSON.stringify(status))
  check(`build ≤ ${BUILD_MAX_MS / 1000} s`, buildMs <= BUILD_MAX_MS)

  const ALL = ids.join(',')
  const idsQ = `/events?ids=${ALL}`
  // Indexes are built lazily, so the first request pays for them and is not timed.
  await timed(idsQ)
  const first = await timed(idsQ)
  console.log(`first page      ${first.ms} ms`)
  check('total equals generated rows', first.body.total === totalLines + callRows, `total ${first.body.total}`)
  check('first page ≤ 300 ms', first.ms <= 300)

  // The boundary line sits in a row of its own; its seq is the row's, not the WAL line number.
  const edge = await timed(`${idsQ}&q=${encodeURIComponent('żboundary')}`)
  const edgeRow = edge.body.rows[0]
  const rec = (await (
    await fetch(`${BASE}/record?id=${ids[BOUNDARY_SESSION]}&gen=${first.body.gens[ids[BOUNDARY_SESSION] ?? '']}&seq=${edgeRow?.seq}`)
  ).json()) as {
    payload?: { text?: string }
  }
  check(
    'record across 8 MB boundary intact',
    edge.body.total === 1 && edgeRow?.t === T0 + boundarySeq * STEP_MS && (rec.payload?.text?.endsWith('żboundary') ?? false),
    JSON.stringify(rec).slice(-40),
  )

  const q = await timed(`${idsQ}&q=haystackrare`)
  console.log(`q (rare) query  ${q.ms} ms`)
  check(
    'q hits exactly the seeded record',
    q.body.total === 1 && q.body.rows[0]?.t === T0 + RARE_LINE * STEP_MS && q.body.rows[0]?.sess === ids[RARE_SESSION],
    `total ${q.body.total}`,
  )
  check('q query ≤ 3 s', q.ms <= 3000)

  const deep = await timed(`${idsQ}&q=needle&limit=200`)
  const page = await timed(`${idsQ}&q=needle&limit=200&before=${deep.body.next}`)
  console.log(`before=next page ${page.ms} ms`)
  check('before=next page ≤ 300 ms', page.ms <= 300)
  check('before=next page is full', page.body.rows.length === 200, `rows ${page.body.rows.length}`)

  const min = await timed(`${idsQ}&min_tok=${MIN_TOK}`)
  console.log(`min_tok page    ${min.ms} ms`)
  check('min_tok first page ≤ 300 ms', min.ms <= 300)
  check(
    'min_tok page is full of rows at or above the bound',
    min.body.rows.length === 200 && min.body.rows.every((r) => tokens(r) >= MIN_TOK),
    `rows ${min.body.rows.length}`,
  )

  const byTok = await timed(`${idsQ}&sort=tot`)
  const byTokNext = await timed(`${idsQ}&sort=tot&before=${byTok.body.next}`)
  console.log(`sort=tot     ${byTok.ms} ms, next page ${byTokNext.ms} ms`)
  check('sort=tot first page ≤ 300 ms', byTok.ms <= 300)
  check('sort=tot next page ≤ 300 ms', byTokNext.ms <= 300)
  const run = [...byTok.body.rows, ...byTokNext.body.rows]
  check(
    'sort=tot pages run from the largest Total down',
    run.length === 400 && run.every((r, n) => n === 0 || tokens(r) <= tokens(run[n - 1] as Row)) && (run[0]?.out ?? 0) > 0,
    `rows ${run.length}`,
  )

  const byTokQ = await timed(`${idsQ}&sort=tot&q=needle`)
  const byTokQNext = await timed(`${idsQ}&sort=tot&q=needle&before=${byTokQ.body.next}`)
  console.log(`sort=tot q   ${byTokQ.ms} ms, next page ${byTokQNext.ms} ms`)
  check('sort=tot with q first page ≤ 3 s', byTokQ.ms <= 3000)
  check('sort=tot with q next page ≤ 300 ms', byTokQNext.ms <= 300)
  check(
    'sort=tot with q pages are full and ordered',
    byTokQ.body.rows.length === 200 && byTokQNext.body.rows.length === 200 && tokens(byTokQNext.body.rows[0] as Row) <= tokens(byTokQ.body.rows[199] as Row),
    `rows ${byTokQ.body.rows.length}, ${byTokQNext.body.rows.length}`,
  )

  const byDur = await timed(`${idsQ}&sort=dur&dir=asc`)
  console.log(`sort=dur asc    ${byDur.ms} ms`)
  check('sort=dur asc first page ≤ 300 ms', byDur.ms <= 300)

  const rss = rssMb()
  console.log(`server RSS      ${rss.toFixed(0)} MB`)
  check('server RSS ≤ 600 MB', rss <= 600)
} catch (err) {
  console.log(`  FAIL ${(err as Error).message}`)
  fail = 1
} finally {
  server.kill()
  rmSync(dir, { recursive: true, force: true })
}
process.exit(fail)
