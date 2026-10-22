#!/usr/bin/env node

// trash.test.ts — /trash, /trash/restore and /trash/purge against a fake HOME with a second
// --source: the move order and its rollback, the busy rules, the caches a trash must evict, and the
// same-origin guard on every write.

import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { type IncomingMessage, request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import type { FirstPage, SessionList, TrashEntry, TrashRef, TrashResult, UsageTotals } from '../shared/api.ts'
import { startServer } from './test-server.ts'

const dir = mkdtempSync(join(tmpdir(), 'waltrash.'))
const other = join(dir, 'other')
const SLUG = '-tmp-p'
const proj = join(dir, '.claude', 'projects', SLUG)
const otherProj = join(other, 'projects', '-tmp-o')
const trashOf = (base: string): string => join(base, 'wal-trash')
const TRASH = trashOf(join(dir, '.claude'))
const OTHER_TRASH = trashOf(other)
// The server runs with TZ=UTC, so its local date is the UTC one.
const TODAY = new Date().toISOString().slice(0, 10)
const HOUR = 60 * 60 * 1000

const sid = (n: number): string => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`
const piecesOf = (id: string): string[] => [`${id}.jsonl`, `${id}.wal.jsonl`, id]
const wal = (event: string): string => `${JSON.stringify({ ts: new Date().toISOString(), workspace: 'default', event })}\n`

/** Transcript, WAL ending in `last` and a subagent folder, all touched `age` ms ago. */
const session = (folder: string, id: string, { last = 'SessionEnd', age = HOUR, title = `title ${id.slice(-2)}` } = {}): void => {
  mkdirSync(join(folder, id, 'subagents'), { recursive: true })
  writeFileSync(join(folder, id, 'subagents', 'agent-a1.jsonl'), '{}\n')
  writeFileSync(join(folder, `${id}.jsonl`), `${JSON.stringify({ type: 'ai-title', aiTitle: title, cwd: `/tmp/${id.slice(-2)}` })}\n`)
  writeFileSync(join(folder, `${id}.wal.jsonl`), wal('SessionStart') + wal(last))
  const t = new Date(Date.now() - age)
  for (const n of piecesOf(id)) utimesSync(join(folder, n), t, t)
}
const present = (folder: string, id: string): string[] => piecesOf(id).filter((n) => existsSync(join(folder, n)))

mkdirSync(proj, { recursive: true })
mkdirSync(otherProj, { recursive: true })

const { server, base } = await startServer([`--source=${other}`], { HOME: dir })
after(() => {
  server.kill()
  rmSync(dir, { recursive: true, force: true })
})
const PORT = new URL(base).port
const HOST = `127.0.0.1:${PORT}`

const send = (method: string, path: string, headers: Record<string, string>, body = ''): Promise<{ status: number; text: string }> =>
  new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: PORT, method, path, headers }, (res: IncomingMessage) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (c) => {
        text += c
      })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
    })
    req.on('error', reject)
    req.end(body)
  })
const SAME = { host: HOST, origin: `http://${HOST}`, 'content-type': 'application/json' }
const post = async (path: string, body: unknown): Promise<TrashResult[]> => {
  const r = await send('POST', path, SAME, JSON.stringify(body))
  assert.equal(r.status, 200, r.text)
  return (JSON.parse(r.text) as { results: TrashResult[] }).results
}
const trash = (...ids: string[]): Promise<TrashResult[]> => post('/trash', { ids })
const entries = async (): Promise<TrashEntry[]> => ((await (await fetch(`${base}/trash`)).json()) as { entries: TrashEntry[] }).entries
const refOf = async (id: string): Promise<TrashRef> => {
  const e = (await entries()).find((x) => x.id === id)
  assert.ok(e, `${id} in the trash listing`)
  return { source: e.source, date: e.date, slug: e.slug, id: e.id }
}
const listed = async (id: string): Promise<boolean> => ((await (await fetch(`${base}/sessions`)).json()) as SessionList).sessions.some((s) => s.id === id)
const events = async (id: string): Promise<FirstPage> => (await (await fetch(`${base}/events?ids=${id}`)).json()) as FirstPage
/** An SSE stream at `path`; `next(event)` waits for a frame of that event, `next()` for a data frame. */
const frames = (path: string): Promise<{ res: IncomingMessage; next: (event?: string) => Promise<string> }> =>
  new Promise((resolve) => {
    request({ host: '127.0.0.1', port: PORT, path }, (res) => {
      let buf = ''
      // Frames that came with the headers are emitted before the caller can ask for them, so kept.
      const got: [string | undefined, string][] = []
      const waiting: [string | undefined, (data: string) => void][] = []
      const match = (): void => {
        for (const w of [...waiting]) {
          const i = got.findIndex(([e]) => e === w[0])
          if (i === -1) continue
          w[1](got.splice(i, 1)[0]?.[1] ?? '')
          waiting.splice(waiting.indexOf(w), 1)
        }
      }
      res.setEncoding('utf8')
      res.on('data', (c) => {
        buf += c
        for (let end = buf.indexOf('\n\n'); end !== -1; end = buf.indexOf('\n\n')) {
          const frame = buf.slice(0, end)
          buf = buf.slice(end + 2)
          // A `retry:` frame carries no data and is never waited for.
          if (/^data:/m.test(frame)) got.push([/^event: (.*)$/m.exec(frame)?.[1], /^data: ?(.*)$/m.exec(frame)?.[1] ?? ''])
        }
        match()
      })
      resolve({
        res,
        next: (event) =>
          new Promise((r) => {
            waiting.push([event, r])
            match()
          }),
      })
    }).end()
  })

test('trash moves transcript, WAL and folder; the session leaves /sessions and reads unknown on /events', async () => {
  const id = sid(1)
  session(proj, id)
  assert.ok(await listed(id))
  assert.equal((await events(id)).rows.length, 2, 'index opened before the trash')
  assert.deepEqual(await trash(id), [{ id, status: 'ok' }])
  assert.deepEqual(present(proj, id), [])
  assert.deepEqual(present(join(TRASH, TODAY, SLUG), id), piecesOf(id))
  assert.ok(existsSync(join(TRASH, TODAY, SLUG, id, 'subagents', 'agent-a1.jsonl')))
  assert.equal(await listed(id), false)
  assert.deepEqual((await events(id)).unknown, [id])
})

test('a live session (fresh mtime) is skipped as live', async () => {
  const id = sid(2)
  session(proj, id, { last: 'Stop', age: 0 })
  assert.deepEqual(await trash(id), [{ id, status: 'live' }])
  assert.deepEqual(present(proj, id), piecesOf(id))
})

test('a session idle over 2 min whose WAL did not end is skipped as not ended', async () => {
  const id = sid(3)
  session(proj, id, { last: 'Stop', age: 10 * 60 * 1000 })
  assert.deepEqual(await trash(id), [{ id, status: 'live', reason: 'not ended' }])
  assert.deepEqual(present(proj, id), piecesOf(id))
})

test('an id discovery does not find is unknown, and the batch goes on', async () => {
  const id = sid(4)
  session(proj, id)
  assert.deepEqual(await trash(sid(99), id), [
    { id: sid(99), status: 'unknown' },
    { id, status: 'ok' },
  ])
})

test('a name already taken in the trash is a conflict and nothing moves', async () => {
  const id = sid(5)
  session(proj, id)
  mkdirSync(join(TRASH, TODAY, SLUG), { recursive: true })
  writeFileSync(join(TRASH, TODAY, SLUG, `${id}.wal.jsonl`), '')
  const [r] = await trash(id)
  assert.equal(r?.status, 'conflict')
  assert.deepEqual(present(proj, id), piecesOf(id))
  assert.ok(await listed(id))
  rmSync(join(TRASH, TODAY, SLUG, `${id}.wal.jsonl`))
})

test('a failure mid-move rolls back: the session stays listed with every piece', async (t) => {
  if (process.getuid?.() === 0) return t.skip('root ignores directory permissions, so the move cannot be made to fail')
  const id = sid(6)
  session(otherProj, id)
  const target = join(OTHER_TRASH, TODAY, '-tmp-o')
  mkdirSync(target, { recursive: true })
  chmodSync(target, 0o555)
  try {
    const [r] = await trash(id)
    assert.equal(r?.status, 'failed')
    assert.match(r?.reason ?? '', /EACCES/)
  } finally {
    chmodSync(target, 0o755)
  }
  assert.deepEqual(readdirSync(otherProj).sort(), piecesOf(id).sort(), 'no suffixed piece left behind')
  assert.ok(await listed(id))
  assert.equal((await events(id)).rows.length, 2)
})

test('an /events-stream open on a session that is trashed resets, and its reconnect reports it unknown', async () => {
  const id = sid(7)
  session(proj, id)
  const first = await frames(`/events-stream?ids=${id}`)
  const reset = first.next('reset')
  assert.deepEqual(await trash(id), [{ id, status: 'ok' }])
  await reset
  first.res.destroy()
  const again = await frames(`/events-stream?ids=${id}`)
  assert.deepEqual(JSON.parse(await again.next('unknown')), [id])
  again.res.destroy()
})

test('restore brings the session back and /sessions lists it', async () => {
  const id = sid(1)
  assert.deepEqual(await post('/trash/restore', { refs: [await refOf(id)] }), [{ id, status: 'ok' }])
  assert.deepEqual(present(proj, id), piecesOf(id))
  assert.deepEqual(present(join(TRASH, TODAY, SLUG), id), [])
  assert.ok(await listed(id))
  assert.equal((await events(id)).rows.length, 2)
})

test('restore while the id is present again is a conflict and leaves the trash entry', async () => {
  const id = sid(1)
  assert.deepEqual(await trash(id), [{ id, status: 'ok' }])
  const ref = await refOf(id)
  writeFileSync(join(proj, `${id}.jsonl`), '')
  const [r] = await post('/trash/restore', { refs: [ref] })
  assert.equal(r?.status, 'conflict')
  assert.deepEqual(present(join(TRASH, TODAY, SLUG), id), piecesOf(id))
  rmSync(join(proj, `${id}.jsonl`))
})

test('restore or purge of a ref not in the listing is unknown', async () => {
  const ref = { source: 'default', date: TODAY, slug: '..', id: sid(1) }
  assert.deepEqual(await post('/trash/restore', { refs: [ref] }), [{ id: sid(1), status: 'unknown' }])
  assert.deepEqual(await post('/trash/purge', { refs: [ref] }), [{ id: sid(1), status: 'unknown' }])
})

test('/trash lists across two sources, newest date first, and ignores suffixed files', async () => {
  const id = sid(8)
  session(otherProj, id, { title: 'from other' })
  assert.deepEqual(await trash(id), [{ id, status: 'ok' }])
  const leftover = join(TRASH, '2020-01-01', SLUG)
  mkdirSync(leftover, { recursive: true })
  writeFileSync(join(leftover, `${sid(9)}.jsonl.wal-trash`), '')
  const old = join(TRASH, '2020-01-02', SLUG)
  mkdirSync(old, { recursive: true })
  writeFileSync(join(old, `${sid(10)}.jsonl`), `${JSON.stringify({ type: 'ai-title', aiTitle: 'older', cwd: '/tmp/old' })}\n`)
  const all = await entries()
  assert.deepEqual(all.map((e) => [e.source, e.date, e.slug, e.id]).sort(), [
    ['default', '2020-01-02', SLUG, sid(10)],
    ['default', TODAY, SLUG, sid(1)],
    ['default', TODAY, SLUG, sid(4)],
    ['default', TODAY, SLUG, sid(7)],
    ['other', TODAY, '-tmp-o', id],
  ])
  assert.equal(all.at(-1)?.date, '2020-01-02')
  const mine = all.find((e) => e.id === id)
  assert.equal(mine?.title, 'from other')
  assert.equal(mine?.cwd, `/tmp/${id.slice(-2)}`)
})

test('purge one removes its pieces; purge all removes the rest and the emptied slug and date dirs, never suffixed leftovers', async () => {
  const one = await refOf(sid(4))
  assert.deepEqual(await post('/trash/purge', { refs: [one] }), [{ id: sid(4), status: 'ok' }])
  assert.deepEqual(present(join(TRASH, TODAY, SLUG), sid(4)), [])
  assert.deepEqual(present(join(TRASH, TODAY, SLUG), sid(1)), piecesOf(sid(1)))
  const results = await post('/trash/purge', { all: true })
  assert.deepEqual(
    results.map((r) => r.status),
    ['ok', 'ok', 'ok', 'ok'],
  )
  assert.deepEqual(await entries(), [])
  assert.deepEqual(readdirSync(TRASH), ['2020-01-01'])
  assert.deepEqual(readdirSync(OTHER_TRASH), [])
  assert.ok(existsSync(join(TRASH, '2020-01-01', SLUG, `${sid(9)}.jsonl.wal-trash`)))
})

test('guard: cross-site or malformed writes are refused', async () => {
  const body = JSON.stringify({ ids: [sid(2)] })
  const { origin: _, ...noOrigin } = SAME
  const cases: [string, string, string, Record<string, string>, string, number][] = [
    ['missing Origin', 'POST', '/trash', noOrigin, body, 403],
    ['foreign Origin', 'POST', '/trash', { ...SAME, origin: 'http://evil.example' }, body, 403],
    ['wrong Host', 'POST', '/trash', { ...SAME, host: `evil.example:${PORT}`, origin: `http://evil.example:${PORT}` }, body, 403],
    ['Sec-Fetch-Site: cross-site', 'POST', '/trash', { ...SAME, 'sec-fetch-site': 'cross-site' }, body, 403],
    ['text/plain body', 'POST', '/trash', { ...SAME, 'content-type': 'text/plain' }, body, 403],
    ['GET on a POST route', 'GET', '/trash/restore', SAME, '', 405],
    ['body over 1 MB', 'POST', '/trash', SAME, `{"ids":["${'x'.repeat(1024 * 1024)}"]}`, 413],
    ['bad JSON', 'POST', '/trash', SAME, '{"ids":', 400],
    ['a bad id', 'POST', '/trash', SAME, JSON.stringify({ ids: [sid(2), '../x'] }), 400],
    ['a non-string ref id', 'POST', '/trash/restore', SAME, JSON.stringify({ refs: [{ source: 'default', date: TODAY, slug: SLUG, id: [sid(2)] }] }), 400],
  ]
  for (const [label, method, path, headers, b, want] of cases) assert.equal((await send(method, path, headers, b)).status, want, label)
  assert.deepEqual(present(proj, sid(2)), piecesOf(sid(2)), 'nothing moved')
  const local = `localhost:${PORT}`
  const ok = await send(
    'POST',
    '/trash',
    { ...SAME, host: local, origin: `http://${local}`, 'content-type': 'Application/JSON; charset=utf-8', 'sec-fetch-site': 'same-origin' },
    body,
  )
  assert.equal(ok.status, 200, 'localhost Host, a charset and same-origin pass')
})

test('two sources sharing a label: trash and restore keep each session in its own source, an ambiguous ref is refused', async () => {
  // Both --source folders are named `same`, so both are labelled `same`.
  const a = join(dir, 'a', 'same')
  const b = join(dir, 'b', 'same')
  const bProj = join(b, 'projects', '-s')
  mkdirSync(join(a, 'projects'), { recursive: true })
  mkdirSync(bProj, { recursive: true })
  const id = sid(11)
  session(bProj, id)
  const two = await startServer([`--source=${a}`, `--source=${b}`], { HOME: join(dir, 'empty-home') })
  try {
    const host = new URL(two.base).host
    const write = async (path: string, body: unknown): Promise<TrashResult[]> => {
      const r = await fetch(`${two.base}${path}`, {
        method: 'POST',
        headers: { origin: `http://${host}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      assert.equal(r.status, 200)
      return ((await r.json()) as { results: TrashResult[] }).results
    }
    assert.deepEqual(await write('/trash', { ids: [id] }), [{ id, status: 'ok' }])
    assert.deepEqual(present(join(b, 'wal-trash', TODAY, '-s'), id), piecesOf(id))
    assert.equal(existsSync(join(a, 'wal-trash')), false)

    const ref = { source: 'same', date: TODAY, slug: '-s', id }
    const twin = join(a, 'wal-trash', TODAY, '-s')
    mkdirSync(twin, { recursive: true })
    writeFileSync(join(twin, `${id}.jsonl`), '')
    const ambiguous = { id, status: 'conflict', reason: 'source label same is ambiguous' }
    assert.deepEqual(await write('/trash/restore', { refs: [ref] }), [ambiguous])
    assert.deepEqual(await write('/trash/purge', { refs: [ref] }), [ambiguous])
    rmSync(join(twin, `${id}.jsonl`))

    assert.deepEqual(await write('/trash/restore', { refs: [ref] }), [{ id, status: 'ok' }])
    assert.deepEqual(present(bProj, id), piecesOf(id))
    assert.equal(existsSync(join(a, 'projects', '-s')), false)
  } finally {
    two.server.kill()
  }
})

test('an /events-stream on a session with an empty WAL resets when it is trashed', { timeout: 5000 }, async () => {
  const id = sid(12)
  session(proj, id, { age: 2 * 24 * HOUR })
  const walPath = join(proj, `${id}.wal.jsonl`)
  // Over 24 h old, or a WAL without SessionEnd keeps the session busy.
  const old = new Date(Date.now() - 2 * 24 * HOUR)
  writeFileSync(walPath, '')
  utimesSync(walPath, old, old)
  const s = await frames(`/events-stream?ids=${id}`)
  const reset = s.next('reset')
  await trash(id)
  assert.equal(await reset, '')
  s.res.destroy()
})

test('a /session-stream open on a session gets it as unknown when it is trashed', { timeout: 5000 }, async () => {
  const id = sid(13)
  session(proj, id)
  const s = await frames(`/session-stream?ids=${id}`)
  await s.next()
  await trash(id)
  assert.deepEqual(JSON.parse(await s.next('unknown')), [id])
  s.res.destroy()
})

test('a /usage-stream open on a session gets a frame listing it unknown when it is trashed', { timeout: 5000 }, async () => {
  const id = sid(14)
  session(proj, id)
  const s = await frames(`/usage-stream?ids=${id}`)
  await s.next()
  await trash(id)
  assert.ok((JSON.parse(await s.next()) as UsageTotals).unknown.includes(id))
  s.res.destroy()
})
