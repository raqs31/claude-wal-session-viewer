#!/usr/bin/env node
// bench.ts — proves the server-side index and query stay within budget on five 20 MB WALs picked together.
//
// The generator puts a multibyte character across the first 8 MB chunk boundary, so /record on
// that line is the only check of the partial line carried between chunk reads.

import { mkdirSync, mkdtempSync, openSync, writeSync, closeSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { FirstPage } from '../shared/api.ts'
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

const EVENTS = ['PreToolUse', 'PostToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'PostToolUseFailure', 'SessionStart']
const TOOLS = ['Bash', 'Read', 'Edit', 'Grep', 'Write', 'Task']
const T0 = Date.parse('2026-09-01T00:00:00Z')

// "needle" appears in every 5th line (frequent) and "haystackrare" in exactly one.
const filler = 'lorem ipsum dolor sit amet zażółć gęślą jaźń — '.repeat(20)
const record = (i: number, text: string): string => {
  const event = EVENTS[i % EVENTS.length]!
  const rec: Record<string, unknown> = { ts: new Date(T0 + i * 800).toISOString(), event, session_id: `s${i % 7}`, payload: { text } }
  // A real id on every tool row, so RSS includes the per-entry tuid the index keeps.
  if (event.includes('Tool')) Object.assign(rec, { tool_name: TOOLS[i % TOOLS.length], tool_use_id: `toolu_01${String(i).padStart(22, '0')}` })
  if (event === 'PostToolUse') rec.duration_ms = (i * 37) % 4000
  return JSON.stringify(rec)
}

let total = 0
let totalLines = 0
let boundarySeq = -1
for (const [n, id] of ids.entries()) {
  // Discovery locates a session by its transcript.
  writeFileSync(join(proj, `${id}.jsonl`), '')
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
    offset += buf.length
    lines++
  }
  closeSync(fd)
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
const rssMb = (): number => Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${server.pid}/status`, 'utf8'))![1]) / 1024

console.log(`bench: ${SESSIONS} sessions, ${(total / 1048576).toFixed(0)} MB, ${totalLines} lines`)
const { server, base: BASE } = await startServer([], { HOME: dir })
try {
  const ALL = ids.join(',')
  const idsQ = `/events?ids=${ALL}`
  // Indexes are built lazily, so the first request pays for them and is not timed.
  await timed(idsQ)
  const first = await timed(idsQ)
  console.log(`first page      ${first.ms} ms`)
  check('total equals generated lines', first.body.total === totalLines, `total ${first.body.total}`)
  check('first page ≤ 300 ms', first.ms <= 300)

  const rec = (await (await fetch(`${BASE}/record?id=${ids[BOUNDARY_SESSION]}&gen=${first.body.gens[ids[BOUNDARY_SESSION]!]}&seq=${boundarySeq}`)).json()) as {
    payload?: { text?: string }
  }
  check('record across 8 MB boundary intact', rec.payload?.text?.endsWith('żboundary') ?? false, JSON.stringify(rec).slice(-40))

  const q = await timed(`${idsQ}&q=haystackrare`)
  console.log(`q (rare) query  ${q.ms} ms`)
  check(
    'q hits exactly the seeded record',
    q.body.total === 1 && q.body.rows[0]?.seq === RARE_LINE && q.body.rows[0]?.sess === ids[RARE_SESSION],
    `total ${q.body.total}`,
  )
  check('q query ≤ 3 s', q.ms <= 3000)

  const deep = await timed(`${idsQ}&q=needle&limit=200`)
  const page = await timed(`${idsQ}&q=needle&limit=200&before=${deep.body.next}`)
  console.log(`before=next page ${page.ms} ms`)
  check('before=next page ≤ 300 ms', page.ms <= 300)
  check('before=next page is full', page.body.rows.length === 200, `rows ${page.body.rows.length}`)

  const rss = rssMb()
  console.log(`server RSS      ${rss.toFixed(0)} MB`)
  check('server RSS ≤ 300 MB', rss <= 300)
} catch (err) {
  console.log(`  FAIL ${(err as Error).message}`)
  fail = 1
} finally {
  server.kill()
  rmSync(dir, { recursive: true, force: true })
}
process.exit(fail)
