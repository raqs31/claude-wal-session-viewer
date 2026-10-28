#!/usr/bin/env node

// wal-server.ts — serves the WAL viewer and streams new events to it as they are appended.
//
// Binds loopback only. The WAL carries prompts, file contents and command output, so this
// must never be reachable off the machine.

import { closeSync, createReadStream, existsSync, openSync, readdirSync, readSync, rmSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  CallRecord,
  ObserverStatus,
  Pipe,
  RebuildResult,
  RecordedFrame,
  RecordResponse,
  Row,
  StaleFrame,
  TokensFrame,
  TrashRef,
  TrashResult,
  WalRecord,
} from '../shared/api.ts'
import { createDiscovery } from './discovery.ts'
import { createObserver, pipeOf, rebuild, syncAll, syncBudget, targetFile } from './observer.ts'
import { createStore, parseScope, type Session, validId } from './sessions.ts'
import { acquireLock, type TargetRecord, targetDir, targetPath } from './target.ts'
import { createTrash } from './trash.ts'
import { cmp, createIndexes, type IndexEntry, type Matcher, matcher, parseVector, query, type Reader, summary, vector, type WalIndex } from './wal-index.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = resolve(HERE, '..', 'web', 'dist')
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
}

const arg = <F extends string | number>(name: string, fallback: F): string | F => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const discovery = createDiscovery(process.argv.filter((a) => a.startsWith('--source=')).map((a) => a.slice('--source='.length)))
const startPort = Number(arg('port', process.env.WAL_PORT || 7878))

const parse = (line: string): WalRecord => {
  try {
    return JSON.parse(line)
  } catch {
    return { ts: new Date().toISOString(), event: 'Unparseable', payload: { line: line.slice(0, 500) } }
  }
}

type Ev = Extract<TargetRecord, { k: 'ev' }>

// A `raw` line is a WAL line that was not JSON; it gets the `Unparseable` record it got before targets.
const walOf = (ev: Ev): WalRecord => (ev.raw === undefined ? (ev.rec as WalRecord) : parse(ev.raw))

// `pos` and `gens` per picked session: the next seq to send and the gen it was read under.
interface Client {
  res: ServerResponse
  ixs: WalIndex[]
  hit: Matcher
  pos: Map<string, number>
  gens: Map<string, number>
  // Picked ids this stream already sent an `event: stale` for.
  stale: Set<string>
  // The stream has a min_tok or max_tok bound: only then can a row match with its numbers and not without.
  tokf: boolean
}

const clients = new Set<Client>()

// One per /session-stream or /usage-stream: the picked ids and the version of each it has sent.
interface SessionClient {
  res: ServerResponse
  ids: string[]
  sent: Map<string, number>
  usage: boolean
}

const sessionClients = new Set<SessionClient>()

const TICK_MS = 1000
const SLICE_MS = 50

// One writer per target dir. A dir's lock is taken before the first write to it, so a source found after the start
// is locked too; a dir another server holds is only read here. A refused dir is asked again at most once per TICK_MS.
const held = new Set<string>()
// Dirs whose refusal was logged: once per dir, however often it is asked again.
const refused = new Set<string>()
const asked = new Map<string, number>()
const hold = (dir: string): boolean => {
  if (held.has(dir)) return true
  const now = Date.now()
  if (now - (asked.get(dir) ?? Number.NEGATIVE_INFINITY) < TICK_MS) return false
  asked.set(dir, now)
  let ok = false
  let why = 'another server holds the observer lock'
  try {
    ok = acquireLock(dir)
  } catch (err) {
    why = `the observer lock cannot be taken (${(err as Error).message})`
  }
  if (ok) held.add(dir)
  else if (!refused.has(dir)) {
    refused.add(dir)
    console.log(`wal-server: ${dir}: ${why}; its targets are read-only here`)
  }
  return ok
}
for (const dir of new Set(discovery.sources().map(targetDir))) hold(dir)
// Owner only while it holds at least one lock: with none, /rebuild is refused.
const owner = (): boolean => held.size > 0

const writer = createObserver({ discovery, write: true })
const reader = createObserver({ discovery, write: false })
const dirOf = (id: string): string | null => {
  const file = targetFile(discovery, id)
  return file === null ? null : dirname(file)
}
/** Each session goes to the writer when this server holds (or can take) its dir's lock, else to the reader. */
const observer = {
  sync: (id: string, budgetMs: number): Pipe => {
    const dir = dirOf(id)
    if (dir === null || !hold(dir)) return reader.sync(id, budgetMs)
    reader.drop(id)
    return writer.sync(id, budgetMs)
  },
  state: (id: string): Pipe | null => {
    const dir = dirOf(id)
    return (dir !== null && held.has(dir) ? writer : reader).state(id)
  },
  drop: (id: string): void => {
    writer.drop(id)
    reader.drop(id)
  },
}
/** Asked for and refused at the last try: held dirs are never released. */
const elsewhere = (dir: string | null): boolean => dir !== null && !held.has(dir) && asked.has(dir)
const targets = { target: (id: string) => targetFile(discovery, id), observer }
const store = createStore(targets, (id) => [...sessionClients].some((c) => c.ids.includes(id)))
const indexes = createIndexes(targets, (id) => [...clients].some((c) => c.ixs.some((ix) => ix.id === id)))
const idsOf = (p: URLSearchParams): string[] => [...new Set((p.get('ids') ?? '').split(',').filter(Boolean))]
// Sent once a stream opens, before any data frame, when some picked ids were skipped.
const writeUnknown = (res: ServerResponse, unknown: string[]): void => {
  if (unknown.length) res.write(`event: unknown\ndata: ${JSON.stringify(unknown)}\n\n`)
}
const versions = (m: Map<string, number>): string => [...m].map(([id, v]) => `${id}:${v}`).join(',')

/** Each session is advanced once per resolver, however many streams pick it. */
const resolver = (): ((id: string) => Session | null) => {
  const seen = new Map<string, Session | null>()
  return (id) => {
    const known = seen.get(id)
    if (known !== undefined) return known
    let s: Session | null = null
    // One broken transcript must not stall the WAL stream or the other sessions.
    try {
      s = store.get(id)
    } catch (err) {
      console.error(`wal-server: session tick ${id}: ${(err as Error).message}`)
    }
    seen.set(id, s)
    return s
  }
}

const writeUsage = (client: SessionClient, ss: (Session | null)[]): void => {
  const body = store.usage(
    ss.filter((s) => s !== null),
    client.ids.filter((_, i) => ss[i] === null),
  )
  client.res.write(`id: ${versions(client.sent)}\ndata: ${JSON.stringify(body)}\n\n`)
}

const sessionTick = (): void => {
  const at = resolver()
  for (const client of sessionClients) {
    const moved = client.ids.map(at).filter((s): s is Session => s !== null && s.version !== client.sent.get(s.id))
    if (!moved.length) continue
    for (const s of moved) client.sent.set(s.id, s.version)
    if (client.usage) writeUsage(client, client.ids.map(at))
    else for (const s of moved) client.res.write(`id: ${versions(client.sent)}\ndata: ${JSON.stringify(store.view(s, 'all'))}\n\n`)
  }
}

/**
 * Runs after a trash, a restore and a rebuild, so an open stream on `id` learns at once: the ticks
 * alone skip a session that resolves null, and a tail of an empty WAL never sees it go.
 */
const forget = (id: string): void => {
  observer.drop(id)
  indexes.drop(id)
  store.drop(id)
  for (const client of clients) {
    if (!client.ixs.some((ix) => ix.id === id)) continue
    // Left open, as walTick's reset is.
    client.res.write('event: reset\ndata:\n\n')
    clients.delete(client)
  }
  const at = resolver()
  for (const client of sessionClients) {
    if (!client.ids.includes(id)) continue
    // Forgotten, so a restored session is sent whole on the next tick.
    client.sent.delete(id)
    const ss = client.ids.map(at)
    // Sent even when empty: the page replaces its unknown list with it, so a restore clears it.
    if (client.usage) writeUsage(client, ss)
    else client.res.write(`event: unknown\ndata: ${JSON.stringify(client.ids.filter((_, i) => ss[i] === null))}\n\n`)
  }
}

const trash = createTrash(discovery, forget)

const walTick = (): void => {
  // Each index is tailed once per tick; one failing file is logged and its clients skipped.
  const failed = new Set<string>()
  const seen = new Set<WalIndex>()
  for (const client of clients) {
    for (const ix of client.ixs) {
      if (seen.has(ix)) continue
      seen.add(ix)
      try {
        ix.tail()
      } catch (err) {
        // The file can vanish between tail()'s stat and its open; the next tick sees it missing.
        failed.add(ix.id)
        console.error(`wal-server: tick ${ix.id}: ${(err as Error).message}`)
      }
    }
  }
  for (const client of clients) {
    if (client.ixs.some((ix) => failed.has(ix.id))) continue
    if (client.ixs.some((ix) => ix.gen !== client.gens.get(ix.id))) {
      // Left open rather than ended: an ended stream reconnects with its stale gen and resets
      // again every second until the page closes it.
      client.res.write('event: reset\ndata:\n\n')
      clients.delete(client)
      continue
    }
    for (const ix of client.ixs) {
      const { stale } = pipeOf(observer, ix.id)
      if (stale === null || client.stale.has(ix.id)) continue
      // Once per session and with no reset: a stale target keeps its gen, so the rows already sent stay valid.
      client.res.write(`event: stale\ndata: ${JSON.stringify({ sess: ix.id, reason: stale } satisfies StaleFrame)}\n\n`)
      client.stale.add(ix.id)
    }
    // One reader per index per tick, so no fd or window outlives a truncation.
    const readers: Reader[] = []
    try {
      const rows: Row[] = []
      const patches: TokensFrame[] = []
      let advanced = false
      for (const ix of client.ixs) {
        const reader = ix.reader(true)
        readers.push(reader)
        const from = client.pos.get(ix.id) ?? 0
        // Rows patched in this tick: a row patched twice gets one patch with its last numbers.
        const patched = new Set<number>()
        for (let seq = from; seq < ix.entries.length; seq++) {
          const e = ix.entries[seq]
          if (!e) continue
          if (!e.hidden) {
            if (client.hit(e, ix, reader.text)) {
              rows.push(summary(ix, seq))
            }
            continue
          }
          const at = e.target
          const row = at === null ? undefined : ix.entries[at]
          if (at === null || !row || patched.has(at)) continue
          patched.add(at)
          const { out, res, inp } = summary(ix, at)
          patches.push({ sess: ix.id, seq: at, out, res, inp })
          // A row at or after `from` was judged above with its numbers. An earlier one a token filter held back is
          // sent now, once: it is sent when it misses with the numbers it had before this `tok` and hits with its own.
          // The check with the old numbers runs first: a token filter rejects a row with none before the `q` disk read.
          if (client.tokf && at < from && !client.hit({ ...row, out: e.out, res: e.res, inp: e.inp }, ix, reader.text) && client.hit(row, ix, reader.text)) {
            rows.push(summary(ix, at))
          }
        }
        // Advanced past misses too, or a `q` stream re-reads them from disk every tick.
        if (ix.entries.length > from) advanced = true
        client.pos.set(ix.id, ix.entries.length)
      }
      if (rows.length) {
        rows.sort((a, b) => cmp(a.t, a.sess, a.seq, b.t, b.sess, b.seq))
        // Every picked index was just given a position above.
        client.res.write(`id: ${vector(client.ixs, (ix) => client.pos.get(ix.id) ?? 0)}\ndata: ${JSON.stringify(rows)}\n\n`)
      }
      if (advanced) {
        const recorded: RecordedFrame = Object.fromEntries(client.ixs.map((ix) => [ix.id, ix.order.length]))
        client.res.write(`event: recorded\ndata: ${JSON.stringify(recorded)}\n\n`)
      }
      // After the rows, so a row sent in this frame is held before its patch lands. No `id:`: the next row
      // frame's vector covers the `tok` entries, and a reconnect from before them replays these patches.
      if (patches.length) client.res.write(`event: tokens\ndata: ${JSON.stringify(patches)}\n\n`)
    } catch (err) {
      console.error(`wal-server: tick: ${(err as Error).message}`)
    } finally {
      for (const r of readers) r.close()
    }
  }
}

setInterval(() => {
  // One set, so a session both kinds of stream pick is synced once per tick.
  const streamed = new Set([...clients].flatMap((c) => c.ixs.map((ix) => ix.id)))
  for (const c of sessionClients) for (const id of c.ids) streamed.add(id)
  // One slice for all of them: an empty pick streams every session, and an unbuilt one is the loop's to build.
  syncAll(observer, [...streamed], Math.min(syncBudget(), SLICE_MS))
  walTick()
  sessionTick()
}, 250)

// Sessions the loop synced; /observer counts one the writer keeps no state for (a skipped sync) as built.
const seen = new Set<string>()

/** Every readdir down the tree discovery and the trash walk succeeds; a missing or non-directory entry is fine, an unreadable one is not. */
const complete = (projectsDir: string): boolean => {
  const ls = (d: string, absentOk: boolean): string[] | null => {
    try {
      return readdirSync(d)
    } catch (err) {
      return absentOk && ['ENOENT', 'ENOTDIR'].includes((err as NodeJS.ErrnoException).code ?? '') ? [] : null
    }
  }
  const slugs = ls(projectsDir, false)
  if (slugs === null || slugs.some((slug) => ls(join(projectsDir, slug), true) === null)) return false
  // The name must match `TRASH` in trash.ts, which does not export it.
  const root = join(dirname(projectsDir), 'wal-trash')
  const dates = ls(root, true)
  if (dates === null) return false
  for (const date of dates) {
    const inDate = ls(join(root, date), true)
    if (inDate === null || inDate.some((slug) => ls(join(root, date, slug), true) === null)) return false
  }
  return true
}

// Candidates found in the trash at the last check: not asked again for KEEP_MS, so a trashed session does not cost a
// full discovery and trash listing every tick.
const kept = new Map<string, number>()
const KEEP_MS = 30_000

/**
 * Removes the targets in the dirs this server holds whose session is neither discovered nor in the trash: a purge in
 * a reader server left them, and a session deleted by hand does the same. Never touches a source, and never a dir
 * another server holds. A dir is skipped when discovery or the trash could not read all of one of its sources: a short
 * listing would call a live session an orphan. `listed` is the tick's discovery listing; a target outside it is checked
 * against a fresh one, and each orphan must also be unlocatable, so a session found after the tick keeps its target.
 */
const sweep = (listed: Set<string>): void => {
  const now = Date.now()
  for (const dir of held) {
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    const ids = names.filter((n) => n.endsWith('.jsonl')).map((n) => n.slice(0, -'.jsonl'.length))
    const candidates = ids.filter((id) => validId(id) && !listed.has(id) && now - (kept.get(id) ?? Number.NEGATIVE_INFINITY) >= KEEP_MS)
    if (!candidates.length) continue
    const mine = discovery.sources().filter((src) => targetDir(src) === dir)
    if (!mine.length || !mine.every((src) => complete(src.projectsDir))) continue
    const live = new Set(discovery.list().sessions.map((s) => s.id))
    const orphans = candidates.filter((id) => !live.has(id))
    if (!orphans.length) continue
    const trashed = new Set(trash.list().map((e) => e.id))
    for (const id of orphans) {
      if (trashed.has(id)) {
        kept.set(id, now)
        continue
      }
      if (discovery.locate(id) !== null) continue
      rmSync(join(dir, `${id}.jsonl`), { force: true })
      kept.delete(id)
      observer.drop(id)
      indexes.drop(id)
      store.drop(id)
    }
  }
}

/**
 * The background build: once a second, every discovered session in a dir this server holds (or can take) the lock
 * of is synced, in slices of SLICE_MS with a yield between them, so requests stay fast. Sessions in another server's
 * dirs are skipped. The first tick waits a full TICK_MS after the start.
 */
const build = async (): Promise<void> => {
  for (;;) {
    await new Promise((r) => setTimeout(r, TICK_MS))
    try {
      const ids = discovery.list().sessions.map((s) => s.id)
      // `done` after the session's last slice in this tick: a session that stops moving waits for the next tick.
      const last = new Map<string, number>()
      for (let i = 0; i < ids.length; ) {
        const deadline = Date.now() + SLICE_MS
        while (i < ids.length && Date.now() < deadline) {
          const id = ids[i] as string
          const dir = dirOf(id)
          if (dir === null || !hold(dir)) {
            i++
            continue
          }
          const p = syncAll(observer, [id], deadline - Date.now())[id] ?? pipeOf(observer, id)
          seen.add(id)
          if (p.stale !== null || p.done >= p.total || last.get(id) === p.done) i++
          else last.set(id, p.done)
        }
        await new Promise((r) => setImmediate(r))
      }
      sweep(new Set(ids))
    } catch (err) {
      console.error(`wal-server: build: ${(err as Error).message}`)
    }
  }
}
// WAL_NO_BUILD exists for tests only, so a request is the first sync of a session however long the test takes.
if (process.env.WAL_NO_BUILD !== '1') void build()

const observerStatus = (): ObserverStatus => {
  const status: ObserverStatus = { owner: owner(), total: 0, built: 0, building: [], stale: [], elsewhere: 0 }
  for (const { id } of discovery.list().sessions) {
    status.total++
    if (elsewhere(dirOf(id))) {
      status.elsewhere++
      continue
    }
    // `done` can stay short of `total` for good: a torn last line is not read until its newline lands.
    const p = writer.state(id)
    if (p && p.stale !== null) status.stale.push({ id, reason: p.stale })
    else if (p ? writer.built(id) : seen.has(id)) status.built++
    else status.building.push(id)
  }
  return status
}

// Only files under web/dist are served: the URL is decoded first, so `%2e%2e` cannot climb out.
const serveStatic = (pathname: string, res: ServerResponse): boolean => {
  let rel: string
  try {
    rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname)
  } catch {
    return false
  }
  const file = resolve(WEB, `.${rel}`)
  if (!file.startsWith(WEB + sep) || !existsSync(file) || !statSync(file).isFile()) return false
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  // The file can vanish or be unreadable after the stat; an unhandled stream error would kill the process.
  createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res)
  return true
}

const BODY_MAX = 1024 * 1024

/**
 * A 403 status for a write that may not come from the page itself. A cross-site form cannot send
 * `application/json` without a preflight, which nothing here answers; `Host` stops DNS rebinding,
 * and is checked against the socket because the bound port may be 7878+n or ephemeral.
 */
const crossSite = (req: IncomingMessage): boolean => {
  const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase()
  const host = req.headers.host
  const port = req.socket.localPort
  const site = req.headers['sec-fetch-site']
  return (
    type !== 'application/json' ||
    (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) ||
    req.headers.origin !== `http://${host}` ||
    (site !== undefined && site !== 'same-origin')
  )
}

const isRef = (r: unknown): r is TrashRef => {
  const o = r as Record<string, unknown> | null
  return typeof o === 'object' && o !== null && ['source', 'date', 'slug', 'id'].every((k) => typeof o[k] === 'string') && validId(o.id as string)
}

/** Also deletes the targets of the purged sessions; the listing is taken first, since a purged entry leaves it. */
const purge = (refs: TrashRef[] | 'all'): TrashResult[] => {
  const listed = trash.list()
  const results = trash.purge(refs)
  for (const r of results) {
    if (r.status !== 'ok') continue
    for (const e of listed) {
      if (e.id !== r.id) continue
      // A target in a dir another server holds stays: that server may be writing it.
      for (const s of discovery.sources()) if (s.label === e.source && hold(targetDir(s))) rmSync(targetPath(s, r.id), { force: true })
    }
    observer.drop(r.id)
    indexes.drop(r.id)
    store.drop(r.id)
  }
  return results
}

/** Rebuilt by the build loop, or by the next request that picks it. */
const rebuildAll = (ids: string[]): RebuildResult[] =>
  ids.map((id) => {
    const dir = dirOf(id)
    if (dir !== null && !hold(dir)) return { id, ok: false, error: 'another server holds the lock' }
    const r = rebuild(observer, discovery, id)
    if (r.ok) {
      forget(id)
      seen.delete(id)
    }
    return r
  })

/** null: a bad shape or a bad id, which fails the whole request. */
const writeOf = (path: string, body: unknown): (() => TrashResult[] | RebuildResult[]) | null => {
  const b = body as Record<string, unknown> | null
  if (typeof b !== 'object' || b === null) return null
  const { ids, refs } = b
  if (path === '/trash' || path === '/rebuild') {
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && validId(id))) return null
    return path === '/trash' ? () => trash.trash(ids) : () => rebuildAll(ids)
  }
  if (path === '/trash/purge' && b.all === true) return () => purge('all')
  if (!Array.isArray(refs) || !refs.every(isRef)) return null
  return path === '/trash/restore' ? () => trash.restore(refs) : () => purge(refs)
}

/** The body arrives after handle() returns, so its errors never reach the server's catch. */
const post = (req: IncomingMessage, res: ServerResponse, path: string): void => {
  if (crossSite(req)) return void res.writeHead(403).end('forbidden')
  if (path === '/rebuild' && !owner()) return void res.writeHead(409).end('read-only: another server builds the targets')
  const chunks: Buffer[] = []
  let size = 0
  req.on('data', (c: Buffer) => {
    size += c.length
    if (size <= BODY_MAX) chunks.push(c)
    else if (!res.headersSent) {
      chunks.length = 0
      res.writeHead(413).end('body too large')
    }
  })
  req.on('end', () => {
    if (size > BODY_MAX) return
    let body: unknown
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return void res.writeHead(400).end('bad json')
    }
    try {
      const run = writeOf(path, body)
      if (!run) return void res.writeHead(400).end('bad body or id')
      const results = run()
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ results }))
    } catch (err) {
      console.error(`wal-server: ${path}: ${(err as Error).message}`)
      if (!res.headersSent) res.writeHead(500)
      res.end('internal error')
    }
  })
  req.on('error', (err) => console.error(`wal-server: ${path}: ${err.message}`))
}

const handle = (req: IncomingMessage, res: ServerResponse): void => {
  // An http.Server request always has a url; only a client-side IncomingMessage lacks one.
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (url.pathname === '/events' || url.pathname === '/events-stream') {
    const p = url.searchParams
    // A sorted view cannot stream: a later `tok` or a changed key can move a row already sent.
    if (url.pathname === '/events-stream' && p.has('sort')) return void res.writeHead(400).end('a sorted view cannot stream')
    // Acquiring tails every index, so `head` is exact and a stream started at `after=head` has no gap.
    // An empty pick means every session that has a WAL.
    const picked = idsOf(p)
    const ids = picked.length
      ? picked
      : discovery
          .list()
          .sessions.filter((s) => s.walSize > 0)
          .map((s) => s.id)
    if (!ids.every(validId)) return void res.writeHead(400).end('bad id')
    const synced = syncAll(observer, ids)
    const got = indexes.acquire(ids)
    if (!got) return void res.writeHead(400).end('bad id')
    const { ixs, unknown } = got
    const pipe = Object.fromEntries(Object.entries(synced).filter(([id]) => ixs.some((ix) => ix.id === id)))

    if (url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(query(ixs, p, unknown, pipe)))
      return
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    res.write('retry: 1000\n\n')
    writeUnknown(res, unknown)
    // `after` is the `head` vector from /events, the next seq to send per session. Frame ids are
    // the same vector, and the browser's reconnect reuses the original URL, so Last-Event-ID wins.
    const pos =
      parseVector(req.headers['last-event-id'] as string | undefined) ?? parseVector(p.get('after')) ?? new Map(ixs.map((ix) => [ix.id, ix.entries.length]))
    const gens = parseVector(p.get('gens')) ?? new Map(ixs.map((ix) => [ix.id, ix.gen]))
    const client: Client = {
      res,
      ixs,
      hit: matcher(p),
      pos,
      gens,
      stale: new Set(),
      tokf: p.get('min_tok') !== null || p.get('max_tok') !== null,
    }
    clients.add(client)
    req.on('close', () => clients.delete(client))
    return
  }

  if (url.pathname === '/record') {
    const p = url.searchParams
    const id = p.get('id')
    if (!validId(id)) return void res.writeHead(400).end('bad id')
    syncAll(observer, [id])
    // The sync above freezes a shrunk target with its rows, so `off` still points at the bytes it indexed.
    const ix = indexes.acquire([id])?.ixs[0]
    if (!ix) return void res.writeHead(404).end('no such session')
    if (Number(p.get('gen')) !== ix.gen) return void res.writeHead(409).end('stale gen')
    const seq = p.get('seq')
    const r = seq !== null && /^\d+$/.test(seq) ? ix.entries[Number(seq)] : undefined
    if (!r || r.hidden) return void res.writeHead(404).end('no such record')
    const fd = openSync(ix.path, 'r')
    // Visible entries stand for `ev` and `call` lines; a `tok` line is a hidden entry, refused above. A call row's
    // `virtual` points at two `ev` entries.
    const read = (e: IndexEntry): Ev | Extract<TargetRecord, { k: 'call' }> => {
      const buf = Buffer.alloc(e.len)
      readSync(fd, buf, 0, e.len, e.off)
      return JSON.parse(buf.toString('utf8'))
    }
    let body: RecordResponse
    try {
      const line = read(r)
      if (line.k === 'ev') body = walOf(line)
      else {
        const call: CallRecord = line
        const pre = r.virtual && ix.entries[r.virtual.pre]
        const post = r.virtual && ix.entries[r.virtual.post]
        body = pre && post ? { virtual: true, pre: walOf(read(pre) as Ev), post: walOf(read(post) as Ev), call } : { call }
      }
    } finally {
      closeSync(fd)
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
    return
  }

  if (url.pathname === '/sessions') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(discovery.list()))
    return
  }

  if (url.pathname === '/session') {
    const p = url.searchParams
    const id = p.get('id')
    const scope = parseScope(p.get('scope') ?? 'all')
    if (!validId(id) || !scope) return void res.writeHead(400).end('bad id or scope')
    syncAll(observer, [id])
    // The sync above freezes a shrunk target with the same gen, so the cached session keeps its rows.
    const s = store.get(id)
    if (!s) return void res.writeHead(404).end('no such session')
    const body = store.view(s, scope)
    if (!body) return void res.writeHead(404).end('no such agent')
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
    return
  }

  if (url.pathname === '/usage' || url.pathname === '/usage-stream' || url.pathname === '/session-stream') {
    const p = url.searchParams
    const ids = idsOf(p)
    if (!ids.every(validId)) return void res.writeHead(400).end('bad id')
    syncAll(observer, ids)
    const got = store.acquire(ids)
    if (!got) return void res.writeHead(400).end('bad id')

    if (url.pathname === '/usage') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(store.usage(got.sessions, got.unknown)))
      return
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    res.write('retry: 1000\n\n')
    writeUnknown(res, got.unknown)
    // Frame ids are the version vector sent so far, and the browser's reconnect reuses the
    // original URL, so Last-Event-ID wins over `since`. With neither, the first tick sends all.
    const sent = parseVector(req.headers['last-event-id'] as string | undefined) ?? parseVector(p.get('since')) ?? new Map<string, number>()
    const client: SessionClient = { res, ids, sent, usage: url.pathname === '/usage-stream' }
    sessionClients.add(client)
    req.on('close', () => sessionClients.delete(client))
    return
  }

  if (url.pathname === '/trash' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ entries: trash.list() }))
    return
  }

  if (url.pathname === '/observer') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(observerStatus()))
    return
  }

  if (url.pathname === '/trash' || url.pathname === '/trash/restore' || url.pathname === '/trash/purge' || url.pathname === '/rebuild') {
    if (req.method !== 'POST') return void res.writeHead(405, { allow: url.pathname === '/trash' ? 'GET, POST' : 'POST' }).end('method not allowed')
    return void post(req, res, url.pathname)
  }

  if (serveStatic(url.pathname, res)) return
  if (url.pathname === '/') return void res.writeHead(503).end('page not built: run `npm run build`')

  res.writeHead(404).end('not found')
}

const server = createServer((req, res) => {
  try {
    handle(req, res)
  } catch (err) {
    console.error(`wal-server: ${req.url}: ${(err as Error).message}`)
    if (!res.headersSent) res.writeHead(500)
    res.end('internal error')
  }
})

// One 'listening' handler for all attempts: a callback passed to each listen() would stay queued
// after that attempt fails and fire on the later success, logging the busy port as well.
let port = startPort
server.on('error', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE' && port < startPort + 10) return void server.listen(++port, '127.0.0.1')
  console.error(`wal-server: ${err.message}`)
  process.exit(1)
})
server.once('listening', () => {
  console.log(`wal viewer:  http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  for (const s of discovery.sources()) console.log(`source:      ${s.label}  ${s.projectsDir}`)
})

server.listen(startPort, '127.0.0.1')
