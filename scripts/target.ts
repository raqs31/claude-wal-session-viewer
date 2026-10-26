// target.ts — the on-disk contract of a session's target file, `<config-dir>/wal-viewer/<id>.jsonl`:
// the record types, an append that keeps lines whole, an incremental reader and the single-writer
// lock. The observer writes targets; the Events index and the Sessions store read them.

import { appendFileSync, closeSync, linkSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Category, McpRole, Source } from '../shared/api.ts'
import type { UsageRecord } from './transcripts.ts'

export const TARGET_VERSION = 1

const DIR = 'wal-viewer'
const LOCK = 'observer.lock'
const BATCH_BYTES = 64 * 1024
const CHUNK = 1024 * 1024

export const targetDir = (source: Source): string => join(dirname(source.projectsDir), DIR)
export const targetPath = (source: Source, id: string): string => join(targetDir(source), `${id}.jsonl`)

export interface Pos {
  ino: number
  off: number
}

// An unparseable WAL line holds `raw` instead of `rec`; exactly one of them is set.
interface EvBase {
  k: 'ev'
  t: number
  event: string | null
  cat: Category
  tool: string | null
  dur: number | null
  tuid: string | null
  agent: string | null
  agentType: string | null
  mcp: McpRole | null
  err: boolean
  // Null on a turn row built from a transcript: it has no WAL line.
  woff: number | null
  // Stop / SubagentStop rows built from a transcript carry their output tokens here.
  out?: number
}

export type TargetRecord =
  | { k: 'head'; v: number; id: string; wal: boolean }
  | (EvBase & { rec: unknown; raw?: undefined })
  | (EvBase & { raw: string; rec?: undefined })
  | {
      k: 'call'
      tuid: string
      t: number
      end: number
      dur: number | null
      tool: string | null
      // Whether the tool is an MCP tool; it picks the event name `MCP call` over `Tool call`.
      mcp: boolean
      err: boolean
      agent: string | null
      agentType: string | null
      input: unknown
      response: unknown
    }
  | { k: 'tok'; tuid: string; out: number; res?: number }
  | { k: 'tok'; woff: number; out: number }
  | ({ k: 'use' } & UsageRecord)
  | { k: 'turn'; t: number }
  | { k: 'compact'; agent: string; t: number; trigger: string; pre: number; post: number }
  | { k: 'agent'; id: string; type: string; description: string; model: string; toolUseId: string; parent: string | null; prompt: string | null }
  | { k: 'tools'; agent: string; n: number }
  // `usd` is null when a later `cost-state` has no total: the session then shows no recorded cost.
  | { k: 'cost'; usd: number | null; byModel: Record<string, number> }
  | { k: 'ck'; wal: Pos | null; tr: Record<string, Pos> }
  | { k: 'stale'; reason: string }

// The keys `q` tests from the first one to the end of the line, so they come last.
const SEARCH_TAIL: Partial<Record<TargetRecord['k'], string[]>> = { ev: ['rec', 'raw'], call: ['input', 'response'] }

/** `k` first and the search keys last, whatever order the caller built the record in. */
const serialize = (r: TargetRecord): string => {
  const tail = SEARCH_TAIL[r.k] ?? []
  const own = r as Record<string, unknown>
  const out: Record<string, unknown> = { k: r.k }
  for (const key of Object.keys(own)) if (key !== 'k' && !tail.includes(key)) out[key] = own[key]
  for (const key of tail) if (key in own) out[key] = own[key]
  return JSON.stringify(out)
}

/** Appends whole lines in batches so a write stays small. A file that ends mid-line gets a `\n` first. */
export const appendRecords = (file: string, records: TargetRecord[]): void => {
  mkdirSync(dirname(file), { recursive: true })
  const size = statSync(file, { throwIfNoEntry: false })?.size ?? 0
  let prefix = ''
  if (size > 0) {
    const fd = openSync(file, 'r')
    const last = Buffer.alloc(1)
    try {
      readSync(fd, last, 0, 1, size - 1)
    } finally {
      closeSync(fd)
    }
    if (last[0] !== 0x0a) prefix = '\n'
  }
  let batch = prefix
  let bytes = prefix.length
  for (const r of records) {
    const line = `${serialize(r)}\n`
    const n = Buffer.byteLength(line)
    if (bytes > prefix.length && bytes + n > BATCH_BYTES) {
      appendFileSync(file, batch)
      batch = ''
      bytes = 0
    }
    batch += line
    bytes += n
  }
  if (batch) appendFileSync(file, batch)
}

export interface TargetItem {
  rec: TargetRecord
  // Byte span of the line in the target, without its `\n`.
  off: number
  len: number
}

export interface TargetRead {
  items: TargetItem[]
  // The file shrank or is a new inode: the reader started over from byte 0, so what the caller built from
  // earlier reads is void.
  reset: boolean
}

export interface TargetReader {
  read(): TargetRead
}

const parse = (line: Buffer): TargetRecord | null => {
  try {
    const rec = JSON.parse(line.toString('utf8'))
    return rec !== null && typeof rec === 'object' && typeof rec.k === 'string' ? rec : null
  } catch {
    return null
  }
}

/** Lines are split on the newline byte, never on decoded-string indices, so multibyte UTF-8 keeps offsets right. */
export const createTargetReader = (file: string): TargetReader => {
  const pos = { ino: 0, offset: 0, carry: Buffer.alloc(0) }

  const read = (): TargetRead => {
    const st = statSync(file, { throwIfNoEntry: false })
    const size = st?.size ?? 0
    const reset = size < pos.offset || (st !== undefined && pos.offset > 0 && st.ino !== pos.ino)
    if (reset) {
      pos.offset = 0
      pos.carry = Buffer.alloc(0)
    }
    if (st) pos.ino = st.ino
    const items: TargetItem[] = []
    if (size === pos.offset) return { items, reset }

    const fd = openSync(file, 'r')
    try {
      while (pos.offset < size) {
        const chunk = Buffer.allocUnsafe(Math.min(CHUNK, size - pos.offset))
        const n = readSync(fd, chunk, 0, chunk.length, pos.offset)
        if (n === 0) break
        const view = Buffer.concat([pos.carry, chunk.subarray(0, n)])
        const base = pos.offset - pos.carry.length
        pos.offset += n
        let start = 0
        for (let nl = view.indexOf(0x0a); nl !== -1; nl = view.indexOf(0x0a, start)) {
          const rec = parse(view.subarray(start, nl))
          if (rec !== null) items.push({ rec, off: base + start, len: nl - start })
          start = nl + 1
        }
        // Copied so a partial line does not pin the whole chunk.
        pos.carry = Buffer.from(view.subarray(start))
      }
    } finally {
      closeSync(fd)
    }
    return { items, reset }
  }

  return { read }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const pidOf = (path: string): number | null => {
  try {
    const pid = Number.parseInt(readFileSync(path, 'utf8'), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

/**
 * Takes `<dir>/observer.lock` with this pid. False when another live pid holds it; a dead pid's lock is replaced.
 * The pid is written to a private file and hard-linked into place, so the lock never exists empty.
 */
export const acquireLock = (dir: string): boolean => {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, LOCK)
  const mine = `${path}.${process.pid}`
  writeFileSync(mine, String(process.pid))
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        linkSync(mine, path)
        return pidOf(path) === process.pid
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      }
      const pid = pidOf(path)
      if (pid !== null && alive(pid)) return false
      // Moved aside, not removed: two servers that both saw the dead pid cannot then delete each other's fresh lock.
      const aside = `${path}.stale.${process.pid}`
      try {
        renameSync(path, aside)
      } catch {
        continue
      }
      const moved = pidOf(aside)
      if (moved !== pid) {
        // Took a lock that a live server created after our read: put it back.
        try {
          linkSync(aside, path)
        } catch {}
        rmSync(aside, { force: true })
        return false
      }
      rmSync(aside, { force: true })
    }
    return false
  } finally {
    rmSync(mine, { force: true })
  }
}

/** Removes the lock only when this process holds it. */
export const releaseLock = (dir: string): void => {
  const path = join(dir, LOCK)
  if (pidOf(path) === process.pid) rmSync(path, { force: true })
}
