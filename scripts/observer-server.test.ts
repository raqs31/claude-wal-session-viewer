#!/usr/bin/env node

// observer-server.test.ts — the server as the cache owner, against a fake HOME: the background build of the
// backlog, the loop following a WAL no client reads, a shrunk WAL frozen as stale, /rebuild, and a second server
// that finds the lock held and only reads. `wal rebuild` refuses while a server holds the lock and rebuilds when none does.
// Then the lock per target dir: a rebuild that would lose a WAL's events, a source added after the start, and a server
// started before any projects dir exists. Then torn last lines still count as built, and a dir whose lock cannot be
// taken is logged once. Last, a purge leaves a target in a dir another server holds and the owner removes it later, a
// trashed session keeps its target, an unreadable projects dir keeps every target, and a failed append is not built.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { type IncomingMessage, request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { after, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import type { FirstPage, ObserverStatus, RebuildResult } from '../shared/api.ts'
import { startServer } from './test-server.ts'

const dir = mkdtempSync(join(tmpdir(), 'walobsserver.'))
const proj = join(dir, '.claude', 'projects', '-tmp-obs')
mkdirSync(proj, { recursive: true })
const sid = (n: number): string => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`
const walOf = (id: string): string => join(proj, `${id}.wal.jsonl`)
const trOf = (id: string): string => join(proj, `${id}.jsonl`)
const targetOf = (id: string): string => join(dir, '.claude', 'wal-viewer', `${id}.jsonl`)

let clock = Date.parse('2026-10-01T10:00:00Z')
// No tool_use_id, so each WAL line gives exactly one row.
const wal = (event: string): string => `${JSON.stringify({ ts: new Date(++clock).toISOString(), workspace: 'w', event })}\n`
const userLine = (uuid: string): string =>
  `${JSON.stringify({ type: 'user', uuid, timestamp: new Date(++clock).toISOString(), message: { role: 'user', content: `prompt ${uuid}` } })}\n`

const [S1, S2, S3] = [sid(1), sid(2), sid(3)]
// No WAL: its rows come from the transcript.
const N1 = sid(4)
for (const id of [S1, S2, S3]) {
  writeFileSync(trOf(id), userLine(`${id.slice(-2)}-u1`))
  writeFileSync(walOf(id), wal('SessionStart') + wal('Notification') + wal('Stop'))
}
writeFileSync(trOf(N1), userLine('n1-u1') + userLine('n1-u2'))

const { server, base } = await startServer([], { HOME: dir })
let second: Awaited<ReturnType<typeof startServer>> | null = null
after(() => {
  server.kill()
  second?.server.kill()
  rmSync(dir, { recursive: true, force: true })
})

const until = async <T>(what: string, fn: () => Promise<T | null>, ms = 15_000): Promise<T> => {
  const end = Date.now() + ms
  let last: T | null = null
  while (Date.now() < end) {
    last = await fn()
    if (last !== null) return last
    await sleep(100)
  }
  throw new Error(`timed out waiting for ${what}`)
}
const status = async (at = base): Promise<ObserverStatus> => (await (await fetch(`${at}/observer`)).json()) as ObserverStatus
const events = async (id: string, at = base): Promise<FirstPage> => {
  const r = await fetch(`${at}/events?ids=${id}&limit=500`)
  assert.equal(r.status, 200)
  return (await r.json()) as FirstPage
}
const lines = (file: string): number => readFileSync(file, 'utf8').split('\n').filter(Boolean).length
const evCount = (id: string, file = targetOf(id)): number =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('{"k":"ev"')).length

const post = (at: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> => {
  const { host, port } = new URL(at)
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, method: 'POST', path, headers: { host, origin: `http://${host}`, 'content-type': 'application/json', ...headers } },
      (res: IncomingMessage) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (c) => {
          text += c
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
      },
    )
    req.on('error', reject)
    req.end(JSON.stringify(body))
  })
}

test('the backlog builds with no request, and /observer reaches built === total', async () => {
  const s = await until('the backlog', async () => {
    const st = await status()
    return st.total === 4 && st.built === st.total ? st : null
  })
  assert.deepEqual(s, { owner: true, total: 4, built: 4, building: [], stale: [], elsewhere: 0 })
  for (const id of [S1, S2, S3, N1]) assert.ok(existsSync(targetOf(id)), `target of ${id}`)
  for (const id of [S1, S2, S3]) assert.equal(evCount(id), 3)
})

test('a WAL appended with no client open is synced by the loop', async () => {
  appendFileSync(walOf(S1), wal('Notification') + wal('Stop'))
  await until('the appended lines in the target', async () => (evCount(S1) === lines(walOf(S1)) ? true : null))
  assert.equal(evCount(S1), 5)
})

test('a shrunk WAL appears in stale, and its rows stop updating', async () => {
  writeFileSync(walOf(S2), wal('SessionStart'))
  const s = await until('the stale session', async () => {
    const st = await status()
    return st.stale.length ? st : null
  })
  assert.deepEqual(s.stale, [{ id: S2, reason: 'wal shrank' }])
  assert.equal(s.built, 3)
  const frozen = await events(S2)
  assert.equal(frozen.rows.length, 3)

  appendFileSync(walOf(S2), wal('Notification') + wal('Notification') + wal('Stop'))
  await sleep(1500)
  const later = await events(S2)
  assert.equal(later.rows.length, 3)
  assert.equal(later.pipe[S2]?.stale, 'wal shrank')
  assert.equal(evCount(S2), 3)
})

test('/rebuild clears the stale state and rebuilds from the current sources', async () => {
  const foreign = await post(base, '/rebuild', { ids: [S2] }, { origin: 'http://evil.example' })
  assert.equal(foreign.status, 403, 'a cross-site POST is refused')
  const bad = await post(base, '/rebuild', { ids: [S2, '../x'] })
  assert.equal(bad.status, 400, 'a bad id fails the request')

  const r = await post(base, '/rebuild', { ids: [S2] })
  assert.equal(r.status, 200)
  assert.deepEqual((JSON.parse(r.text) as { results: RebuildResult[] }).results, [{ id: S2, ok: true }])
  await until('the rebuild', async () => {
    const st = await status()
    return st.stale.length === 0 && st.built === st.total ? st : null
  })
  const rebuilt = await events(S2)
  assert.equal(rebuilt.rows.length, lines(walOf(S2)))
  assert.equal(rebuilt.pipe[S2]?.stale, null)
  assert.equal(evCount(S2), 4)
})

test('a second server is read-only: it serves the targets, reports stale without a WAL and refuses /rebuild', async () => {
  // A no-WAL target frozen by the owner: the read-only server must read it to report the reason.
  writeFileSync(trOf(N1), userLine('n1-u3'))
  await until('the stale transcript', async () => ((await status()).stale.some((x) => x.id === N1) ? true : null))

  second = await startServer([], { HOME: dir })
  const s = await status(second.base)
  assert.equal(s.owner, false)
  const r = await post(second.base, '/rebuild', { ids: [S1] })
  assert.equal(r.status, 409)

  const ownerPage = await events(S1)
  const readPage = await events(S1, second.base)
  assert.deepEqual(
    readPage.rows.map((x) => x.event),
    ownerPage.rows.map((x) => x.event),
  )
  assert.equal((await events(N1, second.base)).pipe[N1]?.stale, 'transcript shrank')
})

const cli = (home: string, ...args: string[]) =>
  spawnSync('node', [join(import.meta.dirname, 'cli.ts'), 'rebuild', ...args], { env: { ...process.env, HOME: home }, encoding: 'utf8' })

test('wal rebuild refuses while a server holds the lock', () => {
  const r = cli(dir, S1)
  assert.equal(r.status, 1)
  assert.equal(r.stderr.trim(), 'server running — use Rebuild in the page')
})

test('wal rebuild refuses an unknown option with exit 2 and the usage', () => {
  const r = cli(dir, '--sourc=x')
  assert.equal(r.status, 2)
  assert.equal(r.stderr.trim(), 'unknown option: --sourc=x\nusage: wal rebuild [ids…] [--source=<config-dir>]...')
})

test('wal rebuild rebuilds the given sessions when no server holds the lock', () => {
  const home = mkdtempSync(join(tmpdir(), 'walobscli.'))
  try {
    const p = join(home, '.claude', 'projects', '-tmp-cli')
    mkdirSync(p, { recursive: true })
    const [A, B] = [sid(11), sid(12)]
    for (const id of [A, B]) {
      writeFileSync(join(p, `${id}.jsonl`), userLine(`${id.slice(-2)}-u1`))
      writeFileSync(join(p, `${id}.wal.jsonl`), wal('SessionStart') + wal('Stop'))
    }
    const target = (id: string): string => join(home, '.claude', 'wal-viewer', `${id}.jsonl`)

    const all = cli(home)
    assert.equal(all.status, 0, all.stderr)
    for (const id of [A, B]) {
      assert.ok(existsSync(target(id)), `target of ${id}`)
      assert.match(all.stdout, new RegExp(`${id} (\\d+)/\\1\\n`))
    }

    writeFileSync(target(A), 'garbage\n')
    const one = cli(home, A)
    assert.equal(one.status, 0, one.stderr)
    assert.match(one.stdout, new RegExp(`^${A} (\\d+)/\\1\\n$`))
    assert.ok(readFileSync(target(A), 'utf8').startsWith('{'), 'the target was written again')
    assert.ok(!existsSync(join(home, '.claude', 'wal-viewer', 'observer.lock')), 'the lock is released')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('/rebuild keeps a WAL-built target whose WAL is gone', async () => {
  const away = join(dir, 'away.wal.jsonl')
  renameSync(walOf(S3), away)
  try {
    const r = await post(base, '/rebuild', { ids: [S3] })
    assert.equal(r.status, 200)
    assert.deepEqual((JSON.parse(r.text) as { results: RebuildResult[] }).results, [{ id: S3, ok: false, error: 'wal missing' }])
    assert.equal(evCount(S3), 3)
  } finally {
    renameSync(away, walOf(S3))
  }
})

test('a source added after the start is locked before its first write, and skipped while another holds it', async () => {
  if (second) {
    const exited = new Promise((r) => second?.server.once('exit', r))
    second.server.kill()
    await exited
    second = null
  }
  const ws = join(dir, '.claude', 'workspaces', 'ws2')
  const wsProj = join(ws, 'projects', '-tmp-ws')
  const lock = join(ws, 'wal-viewer', 'observer.lock')
  const W1 = sid(21)
  const wsTarget = join(ws, 'wal-viewer', `${W1}.jsonl`)
  mkdirSync(wsProj, { recursive: true })
  mkdirSync(join(ws, 'wal-viewer'))
  // A live pid that is not the server's: this test process stands in for another server.
  writeFileSync(lock, String(process.pid))
  writeFileSync(join(wsProj, `${W1}.jsonl`), userLine('w1-u1'))
  writeFileSync(join(wsProj, `${W1}.wal.jsonl`), wal('SessionStart') + wal('Stop'))

  await until('the new source listed', async () => ((await status()).total === 5 ? true : null))
  await sleep(2500)
  assert.equal(existsSync(wsTarget), false, 'no write to a dir another process holds')
  const held = await status()
  assert.equal(held.owner, true)
  assert.equal(held.elsewhere, 1, 'a session in a dir held elsewhere is reported as such')
  assert.ok(!held.building.includes(W1), 'and not as building')
  assert.equal((await events(W1)).rows.length, 0)
  const r = await post(base, '/rebuild', { ids: [W1] })
  assert.deepEqual((JSON.parse(r.text) as { results: RebuildResult[] }).results, [{ id: W1, ok: false, error: 'another server holds the lock' }])

  rmSync(lock)
  await until('the new source built', async () => (existsSync(wsTarget) && evCount(W1, wsTarget) === 2 ? true : null))
  assert.equal(readFileSync(lock, 'utf8'), String(server.pid))
})

test('with no projects dir at start, the server owns nothing until one appears, then locks it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'walobslate.'))
  mkdirSync(join(home, '.claude'))
  const late = await startServer([], { HOME: home })
  try {
    assert.deepEqual(await status(late.base), { owner: false, total: 0, built: 0, building: [], stale: [], elsewhere: 0 })
    assert.equal((await post(late.base, '/rebuild', { ids: [S1] })).status, 409)

    const p = join(home, '.claude', 'projects', '-tmp-late')
    mkdirSync(p, { recursive: true })
    const L1 = sid(31)
    writeFileSync(join(p, `${L1}.jsonl`), userLine('l1-u1'))
    writeFileSync(join(p, `${L1}.wal.jsonl`), wal('SessionStart'))
    const s = await until('the late source built', async () => {
      const st = await status(late.base)
      return st.owner && st.total === 1 && st.built === 1 ? st : null
    })
    assert.deepEqual(s, { owner: true, total: 1, built: 1, building: [], stale: [], elsewhere: 0 })
    assert.equal(readFileSync(join(home, '.claude', 'wal-viewer', 'observer.lock'), 'utf8'), String(late.server.pid))
    assert.ok(existsSync(join(home, '.claude', 'wal-viewer', `${L1}.jsonl`)))
  } finally {
    late.server.kill()
    rmSync(home, { recursive: true, force: true })
  }
})

test('torn last lines count as built, and a dir whose lock cannot be taken is logged once and reported elsewhere', async () => {
  const home = mkdtempSync(join(tmpdir(), 'walobstorn.'))
  const p = join(home, '.claude', 'projects', '-tmp-torn')
  mkdirSync(p, { recursive: true })
  const [T1, T2, T3] = [sid(41), sid(42), sid(43)]
  writeFileSync(join(p, `${T1}.jsonl`), userLine('t1-u1'))
  writeFileSync(join(p, `${T1}.wal.jsonl`), `${wal('SessionStart')}{"ts":"2026`)
  // No WAL, and a transcript cut mid-line.
  writeFileSync(join(p, `${T2}.jsonl`), `${userLine('t2-u1')}{"type":"us`)
  const torn = await startServer([], { HOME: home })
  const out: string[] = []
  createInterface({ input: torn.server.stdout as NodeJS.ReadableStream }).on('line', (l) => out.push(l))
  try {
    const s = await until('the torn sessions built', async () => {
      const st = await status(torn.base)
      return st.total === 2 && st.built === 2 ? st : null
    })
    assert.deepEqual(s, { owner: true, total: 2, built: 2, building: [], stale: [], elsewhere: 0 })
    assert.equal(evCount(T1, join(home, '.claude', 'wal-viewer', `${T1}.jsonl`)), 1)

    // A file where the target dir should be: every lock attempt throws.
    const ws = join(home, '.claude', 'workspaces', 'ws3')
    mkdirSync(join(ws, 'projects', '-tmp-ws3'), { recursive: true })
    writeFileSync(join(ws, 'wal-viewer'), '')
    writeFileSync(join(ws, 'projects', '-tmp-ws3', `${T3}.jsonl`), userLine('t3-u1'))
    await until('the unlockable source counted', async () => ((await status(torn.base)).elsewhere === 1 ? true : null))
    await sleep(3500)
    assert.deepEqual(await status(torn.base), { owner: true, total: 3, built: 2, building: [], stale: [], elsewhere: 1 })
    const logged = out.filter((l) => l.includes(join(ws, 'wal-viewer')) && l.includes('cannot be taken'))
    assert.equal(logged.length, 1, JSON.stringify(out))
  } finally {
    torn.server.kill()
    rmSync(home, { recursive: true, force: true })
  }
})

test('purge keeps the target in a dir another server holds, and the owner removes it later', async () => {
  const home = mkdtempSync(join(tmpdir(), 'walobspurge.'))
  const p = join(home, '.claude', 'projects', '-tmp-purge')
  mkdirSync(p, { recursive: true })
  const P1 = sid(51)
  writeFileSync(join(p, `${P1}.jsonl`), userLine('p1-u1'))
  writeFileSync(join(p, `${P1}.wal.jsonl`), wal('SessionStart') + wal('SessionEnd'))
  const target = join(home, '.claude', 'wal-viewer', `${P1}.jsonl`)
  const owner = await startServer([], { HOME: home })
  const owned = new Promise((r) => owner.server.once('exit', r))
  let reader: Awaited<ReturnType<typeof startServer>> | null = null
  let owner2: Awaited<ReturnType<typeof startServer>> | null = null
  try {
    await until('the target built', async () => ((await status(owner.base)).built === 1 ? true : null))
    owner.server.kill()
    await owned
    // A live pid that is not a server's: this test process stands in for another server.
    writeFileSync(join(home, '.claude', 'wal-viewer', 'observer.lock'), String(process.pid))
    reader = await startServer([], { HOME: home })
    assert.equal((await status(reader.base)).owner, false)

    assert.deepEqual(JSON.parse((await post(reader.base, '/trash', { ids: [P1] })).text), { results: [{ id: P1, status: 'ok' }] })
    const { entries } = (await (await fetch(`${reader.base}/trash`)).json()) as { entries: { source: string; date: string; slug: string; id: string }[] }
    const ref = entries.map(({ source, date, slug, id }) => ({ source, date, slug, id })).find((e) => e.id === P1)
    assert.ok(ref, 'the session is in the trash listing')
    assert.deepEqual(JSON.parse((await post(reader.base, '/trash/purge', { refs: [ref] })).text), { results: [{ id: P1, status: 'ok' }] })
    assert.equal(((await (await fetch(`${reader.base}/trash`)).json()) as { entries: unknown[] }).entries.length, 0, 'the trash is purged')
    assert.ok(existsSync(target), 'the target stays')

    // The stand-in releases the lock and a new owner starts: it removes the target of the purged session.
    reader.server.kill()
    rmSync(join(home, '.claude', 'wal-viewer', 'observer.lock'))
    owner2 = await startServer([], { HOME: home })
    assert.equal((await status(owner2.base)).owner, true)
    await until('the owner to remove the target', async () => (existsSync(target) ? null : true))
  } finally {
    owner.server.kill()
    reader?.server.kill()
    owner2?.server.kill()
    rmSync(home, { recursive: true, force: true })
  }
})

test('a trashed session keeps its target while the owner removes orphans', async () => {
  const home = mkdtempSync(join(tmpdir(), 'walobstrash.'))
  const p = join(home, '.claude', 'projects', '-tmp-trash')
  mkdirSync(p, { recursive: true })
  const R1 = sid(71)
  writeFileSync(join(p, `${R1}.jsonl`), userLine('r1-u1'))
  writeFileSync(join(p, `${R1}.wal.jsonl`), wal('SessionStart') + wal('SessionEnd'))
  const target = join(home, '.claude', 'wal-viewer', `${R1}.jsonl`)
  const owner = await startServer([], { HOME: home })
  try {
    await until('the target built', async () => ((await status(owner.base)).built === 1 ? true : null))
    assert.deepEqual(JSON.parse((await post(owner.base, '/trash', { ids: [R1] })).text), { results: [{ id: R1, status: 'ok' }] })
    await sleep(2500)
    assert.ok(existsSync(target), 'the target of a trashed session stays')
  } finally {
    owner.server.kill()
    rmSync(home, { recursive: true, force: true })
  }
})

test('an unreadable projects dir does not make the owner remove a live target', {
  skip: process.getuid?.() === 0 ? 'root ignores chmod 000' : false,
}, async () => {
  const home = mkdtempSync(join(tmpdir(), 'walobsshort.'))
  const projects = join(home, '.claude', 'projects')
  const p = join(projects, '-tmp-short')
  mkdirSync(p, { recursive: true })
  const U1 = sid(81)
  writeFileSync(join(p, `${U1}.jsonl`), userLine('u1-u1'))
  writeFileSync(join(p, `${U1}.wal.jsonl`), wal('SessionStart'))
  const target = join(home, '.claude', 'wal-viewer', `${U1}.jsonl`)
  const owner = await startServer([], { HOME: home })
  try {
    await until('the target built', async () => ((await status(owner.base)).built === 1 ? true : null))
    chmodSync(projects, 0o000)
    await sleep(2500)
    assert.ok(existsSync(target), 'the target stays while discovery cannot read the projects dir')
  } finally {
    chmodSync(projects, 0o755)
    owner.server.kill()
    rmSync(home, { recursive: true, force: true })
  }
})

test('a sync whose append fails does not count the session as built', { skip: process.getuid?.() === 0 ? 'root ignores chmod 0444' : false }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'walobsfail.'))
  const p = join(home, '.claude', 'projects', '-tmp-fail')
  mkdirSync(p, { recursive: true })
  const F1 = sid(61)
  writeFileSync(join(p, `${F1}.jsonl`), userLine('f1-u1'))
  writeFileSync(join(p, `${F1}.wal.jsonl`), wal('SessionStart'))
  const target = join(home, '.claude', 'wal-viewer', `${F1}.jsonl`)
  const failing = await startServer([], { HOME: home })
  try {
    await until('the session built', async () => ((await status(failing.base)).built === 1 ? true : null))
    chmodSync(target, 0o444)
    appendFileSync(join(p, `${F1}.wal.jsonl`), wal('Stop'))
    const s = await until('the failed append', async () => {
      const st = await status(failing.base)
      return st.built === 0 ? st : null
    })
    assert.deepEqual(s.building, [F1])
    await sleep(2500)
    assert.deepEqual((await status(failing.base)).building, [F1], 'it stays building while every append fails')
    chmodSync(target, 0o644)
    await until('the append to succeed', async () => ((await status(failing.base)).built === 1 ? true : null))
  } finally {
    failing.server.kill()
    rmSync(home, { recursive: true, force: true })
  }
})
