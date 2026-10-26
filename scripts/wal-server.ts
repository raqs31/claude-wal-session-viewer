#!/usr/bin/env node

// wal-server.ts — serves the WAL viewer and streams new events to it as they are appended.
//
// Binds loopback only. The WAL carries prompts, file contents and command output, so this
// must never be reachable off the machine.

import { closeSync, createReadStream, existsSync, openSync, readSync, rmSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallRecord, RecordResponse, Row, StaleFrame, TrashRef, TrashResult, WalRecord } from '../shared/api.ts'
import { createDiscovery } from './discovery.ts'
import { createObserver, pipeOf, syncAll, targetFile } from './observer.ts'
import { createStore, parseScope, type Session, validId } from './sessions.ts'
import { type TargetRecord, targetPath } from './target.ts'
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
  // Picked ids whose stale reason the page already has: from the first page, or an `event: stale` sent.
  stale: Set<string>
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
const observer = createObserver({ discovery, write: true })
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
 * Runs after a trash and after a restore, so an open stream on `id` learns at once: the ticks
 * alone skip a session that resolves null, and a tail of an empty WAL never sees it go.
 */
const trash = createTrash(discovery, (id) => {
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
})

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
      for (const ix of client.ixs) {
        const reader = ix.reader(true)
        readers.push(reader)
        const from = client.pos.get(ix.id) ?? 0
        for (let seq = from; seq < ix.entries.length; seq++) {
          const e = ix.entries[seq]
          if (e && client.hit(e, ix, reader.text)) rows.push(summary(ix, seq))
        }
        // Advanced past misses too, or a `q` stream re-reads them from disk every tick.
        client.pos.set(ix.id, ix.entries.length)
      }
      if (rows.length === 0) continue
      rows.sort((a, b) => cmp(a.t, a.sess, a.seq, b.t, b.sess, b.seq))
      // Every picked index was just given a position above.
      client.res.write(`id: ${vector(client.ixs, (ix) => client.pos.get(ix.id) ?? 0)}\ndata: ${JSON.stringify(rows)}\n\n`)
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
  syncAll(observer, [...streamed])
  walTick()
  sessionTick()
}, 250)

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
      for (const s of discovery.sources()) if (s.label === e.source) rmSync(targetPath(s, r.id), { force: true })
    }
    observer.drop(r.id)
    indexes.drop(r.id)
    store.drop(r.id)
  }
  return results
}

/** null: a bad shape or a bad id, which fails the whole request. */
const writeOf = (path: string, body: unknown): (() => TrashResult[]) | null => {
  const b = body as Record<string, unknown> | null
  if (typeof b !== 'object' || b === null) return null
  const { ids, refs } = b
  if (path === '/trash') return Array.isArray(ids) && ids.every((id) => typeof id === 'string' && validId(id)) ? () => trash.trash(ids) : null
  if (path === '/trash/purge' && b.all === true) return () => purge('all')
  if (!Array.isArray(refs) || !refs.every(isRef)) return null
  return path === '/trash/restore' ? () => trash.restore(refs) : () => purge(refs)
}

/** The body arrives after handle() returns, so its errors never reach the server's catch. */
const post = (req: IncomingMessage, res: ServerResponse, path: string): void => {
  if (crossSite(req)) return void res.writeHead(403).end('forbidden')
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
    const stale = new Set(ixs.filter((ix) => typeof pipe[ix.id]?.stale === 'string').map((ix) => ix.id))
    const client: Client = { res, ixs, hit: matcher(p), pos, gens, stale }
    clients.add(client)
    req.on('close', () => clients.delete(client))
    return
  }

  if (url.pathname === '/record') {
    const p = url.searchParams
    const id = p.get('id')
    if (!validId(id)) return void res.writeHead(400).end('bad id')
    syncAll(observer, [id])
    // Acquiring tails first, catching a truncation since the last tick before `off` points at new bytes.
    const ix = indexes.acquire([id])?.ixs[0]
    if (!ix) return void res.writeHead(404).end('no such session')
    if (Number(p.get('gen')) !== ix.gen) return void res.writeHead(409).end('stale gen')
    const seq = p.get('seq')
    const r = seq !== null && /^\d+$/.test(seq) ? ix.entries[Number(seq)] : undefined
    if (!r) return void res.writeHead(404).end('no such record')
    const fd = openSync(ix.path, 'r')
    // Index entries stand for `ev` and `call` lines only; a call row's `virtual` points at two `ev` entries.
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
    // Opening advances a cached session first, so a shrink since the last tick bumps gen here.
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

  if (url.pathname === '/trash' || url.pathname === '/trash/restore' || url.pathname === '/trash/purge') {
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
