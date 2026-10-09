#!/usr/bin/env node
// wal-server.ts — serves the WAL viewer and streams new events to it as they are appended.
//
// Binds loopback only. The WAL carries prompts, file contents and command output, so this
// must never be reachable off the machine.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import type { RecordResponse, Row, WalRecord } from '../shared/api.ts'
import { createDiscovery } from './discovery.ts'
import { createStore, parseScope, validId, type Session } from './sessions.ts'
import { cmp, createIndexes, matcher, parseVector, query, summary, vector, type IndexEntry, type Matcher, type WalIndex } from './wal-index.ts'

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

// `pos` and `gens` per picked session: the next seq to send and the gen it was read under.
interface Client {
  res: ServerResponse
  ixs: WalIndex[]
  hit: Matcher
  pos: Map<string, number>
  gens: Map<string, number>
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
const store = createStore(discovery, (id) => [...sessionClients].some((c) => c.ids.includes(id)))
const indexes = createIndexes(discovery, (id) => [...clients].some((c) => c.ixs.some((ix) => ix.id === id)))
const idsOf = (p: URLSearchParams): string[] => [...new Set((p.get('ids') ?? '').split(',').filter(Boolean))]
// Sent once a stream opens, before any data frame, when some picked ids were skipped.
const writeUnknown = (res: ServerResponse, unknown: string[]): void => {
  if (unknown.length) res.write(`event: unknown\ndata: ${JSON.stringify(unknown)}\n\n`)
}
const versions = (m: Map<string, number>): string => [...m].map(([id, v]) => `${id}:${v}`).join(',')

const sessionTick = (): void => {
  // Each session is advanced once per tick, however many streams pick it.
  const seen = new Map<string, Session | null>()
  const at = (id: string): Session | null => {
    if (!seen.has(id)) {
      // One broken transcript must not stall the WAL stream or the other sessions.
      try {
        seen.set(id, store.get(id))
      } catch (err) {
        seen.set(id, null)
        console.error(`wal-server: session tick ${id}: ${(err as Error).message}`)
      }
    }
    return seen.get(id)!
  }
  for (const client of sessionClients) {
    const moved = client.ids.map(at).filter((s): s is Session => s !== null && s.version !== client.sent.get(s.id))
    if (!moved.length) continue
    for (const s of moved) client.sent.set(s.id, s.version)
    if (client.usage) {
      const ss = client.ids.map(at)
      const body = store.usage(ss.filter((s) => s !== null), client.ids.filter((_, i) => ss[i] === null))
      client.res.write(`id: ${versions(client.sent)}\ndata: ${JSON.stringify(body)}\n\n`)
    }
    else for (const s of moved) client.res.write(`id: ${versions(client.sent)}\ndata: ${JSON.stringify(store.view(s, 'all'))}\n\n`)
  }
}

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
    // One reader per index per tick, so no fd or window outlives a truncation.
    const readers = client.ixs.map((ix) => ix.reader(true))
    try {
      const rows: Row[] = []
      client.ixs.forEach((ix, i) => {
        const from = client.pos.get(ix.id) ?? 0
        for (let seq = from; seq < ix.entries.length; seq++) if (client.hit(ix.entries[seq]!, ix, readers[i]!.text)) rows.push(summary(ix, seq))
        // Advanced past misses too, or a `q` stream re-reads them from disk every tick.
        client.pos.set(ix.id, ix.entries.length)
      })
      if (rows.length === 0) continue
      rows.sort((a, b) => cmp(a.t, a.sess, a.seq, b.t, b.sess, b.seq))
      client.res.write(`id: ${vector(client.ixs, (ix) => client.pos.get(ix.id)!)}\ndata: ${JSON.stringify(rows)}\n\n`)
    } catch (err) {
      console.error(`wal-server: tick: ${(err as Error).message}`)
    } finally {
      for (const r of readers) r.close()
    }
  }
}

setInterval(() => {
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
  const file = resolve(WEB, '.' + rel)
  if (!file.startsWith(WEB + sep) || !existsSync(file) || !statSync(file).isFile()) return false
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  // The file can vanish or be unreadable after the stat; an unhandled stream error would kill the process.
  createReadStream(file).on('error', () => res.destroy()).pipe(res)
  return true
}

const handle = (req: IncomingMessage, res: ServerResponse): void => {
  const url = new URL(req.url!, 'http://localhost')

  if (url.pathname === '/events' || url.pathname === '/events-stream') {
    const p = url.searchParams
    // Acquiring tails every index, so `head` is exact and a stream started at `after=head` has no gap.
    // An empty pick means every session that has a WAL.
    const picked = idsOf(p)
    const got = indexes.acquire(picked.length ? picked : discovery.list().sessions.filter((s) => s.walSize > 0).map((s) => s.id))
    if (!got) return void res.writeHead(400).end('bad id')
    const { ixs, unknown } = got

    if (url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(query(ixs, p, unknown)))
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
    const pos = parseVector(req.headers['last-event-id'] as string | undefined) ?? parseVector(p.get('after')) ?? new Map(ixs.map((ix) => [ix.id, ix.entries.length]))
    const gens = parseVector(p.get('gens')) ?? new Map(ixs.map((ix) => [ix.id, ix.gen]))
    const client: Client = { res, ixs, hit: matcher(p), pos, gens }
    clients.add(client)
    req.on('close', () => clients.delete(client))
    return
  }

  if (url.pathname === '/record') {
    const p = url.searchParams
    const id = p.get('id')
    if (!validId(id)) return void res.writeHead(400).end('bad id')
    // Acquiring tails first, catching a truncation since the last tick before `off` points at new bytes.
    const ix = indexes.acquire([id])?.ixs[0]
    if (!ix) return void res.writeHead(404).end('no such session')
    if (Number(p.get('gen')) !== ix.gen) return void res.writeHead(409).end('stale gen')
    const seq = p.get('seq')
    const r = seq !== null && /^\d+$/.test(seq) ? ix.entries[Number(seq)] : undefined
    if (!r) return void res.writeHead(404).end('no such record')
    const fd = openSync(ix.path, 'r')
    const read = (e: IndexEntry): WalRecord => {
      const buf = Buffer.alloc(e.len)
      readSync(fd, buf, 0, e.len, e.off)
      return parse(buf.toString('utf8'))
    }
    let body: RecordResponse
    try {
      body = r.virtual ? { virtual: true, pre: read(ix.entries[r.virtual.pre]!), post: read(r) } : read(r)
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
