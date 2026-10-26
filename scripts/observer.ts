// observer.ts — the only writer of targets. Per session, a pass reads the WAL from where the target
// left off and appends one `ev` per line, a `call` per tool call and then a `ck`. After a restart it
// replays the WAL up to the last `ck` without writing, to rebuild the open calls, then continues.

import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { catOf, type McpRole } from '../shared/api.ts'
import type { Discovery } from './discovery.ts'
import { appendRecords, createTargetReader, TARGET_VERSION, type TargetItem, type TargetReader, type TargetRecord, targetPath } from './target.ts'

const MCP_ROLE = new Map<string, McpRole>([
  ['PreToolUse', 'request'],
  ['PostToolUse', 'response'],
  ['PostToolUseFailure', 'response'],
])
// Caps the open-Pre map and the called set: a Pre whose Post never lands (killed session) would otherwise
// be held forever. A duplicate Post more than this many calls after the first gives a second row.
const PENDING_MAX = 10_000
// The budget is checked once per chunk, so a 0 ms budget still reads one chunk.
const CHUNK = 64 * 1024

// The fields the derivation reads, typed as the hook writes them; a line is not validated against it.
interface WalLine {
  ts?: string
  event?: unknown
  tool_name?: unknown
  tool_use_id?: unknown
  agent_id?: unknown
  agent_type?: unknown
  duration_ms?: unknown
  payload?: { tool_input?: unknown; tool_response?: unknown; error?: unknown } | null
}

type Ev = Extract<TargetRecord, { k: 'ev' }>

export interface SyncResult {
  // WAL bytes the target covers, and the WAL size.
  done: number
  total: number
  stale: string | null
}

interface Session {
  file: string
  reader: TargetReader
  head: boolean
  // `head.v` when it is not TARGET_VERSION.
  version: number | null
  stale: string | null
  // The WAL inode the target was built from; 0 until known.
  ino: number
  // The next WAL byte to read, always a line start.
  off: number
  // Lines before this WAL offset are already in the target: replay them without writing.
  replayTo: number
  // `t` of the last `ev` read from the target, and of the last one before its last `ck`: the fallback
  // time of the first line after the replay.
  evT: number | null
  ckT: number | null
  // `ev`s an interrupted pass wrote after the last `ck`, WAL offset → their `t`; they are not written again.
  redo: Map<number, number>
  lastT: number | null
  total: number
  open: Map<string, { t: number; input: unknown }>
  // Tool calls that already have a call row: a second Post gives none.
  called: Set<string>
}

/** Drops the oldest key once the set or map holds more than PENDING_MAX. */
const capped = (keys: Set<string> | Map<string, unknown>): void => {
  if (keys.size <= PENDING_MAX) return
  const oldest = keys.keys().next().value
  if (oldest !== undefined) keys.delete(oldest)
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

const readAt = (fd: number, off: number, len: number): Buffer => {
  const buf = Buffer.allocUnsafe(len)
  return buf.subarray(0, readSync(fd, buf, 0, len, off))
}

export const createObserver = ({ discovery, write }: { discovery: Pick<Discovery, 'locate'>; write: boolean }) => {
  const sessions = new Map<string, Session>()

  const fresh = (file: string, reader = createTargetReader(file)): Session => ({
    file,
    reader,
    head: false,
    version: null,
    stale: null,
    ino: 0,
    off: 0,
    replayTo: 0,
    evT: null,
    ckT: null,
    redo: new Map(),
    lastT: null,
    total: 0,
    open: new Map(),
    called: new Set(),
  })

  const absorb = (s: Session, items: TargetItem[]): void => {
    for (const { rec } of items) {
      if (rec.k === 'head' && !s.head) {
        s.head = true
        if (rec.v !== TARGET_VERSION) s.version = rec.v
      } else if (rec.k === 'ev') {
        s.evT = rec.t
        if (rec.woff !== null) s.redo.set(rec.woff, rec.t)
      } else if (rec.k === 'call') {
        s.called.add(rec.tuid)
        capped(s.called)
      } else if (rec.k === 'ck' && rec.wal) {
        s.ino = rec.wal.ino
        s.replayTo = rec.wal.off
        s.ckT = s.evT
        s.redo.clear()
      } else if (rec.k === 'stale') s.stale = rec.reason
    }
  }

  const result = (s: Session): SyncResult => ({ done: Math.max(s.off, s.replayTo), total: s.total, stale: s.stale })

  const freeze = (s: Session, reason: string): void => {
    s.stale = reason
    appendRecords(s.file, [{ k: 'stale', reason }])
  }

  const line = (s: Session, buf: Buffer, woff: number, now: number, out: TargetRecord[]): void => {
    if (woff === s.replayTo) s.lastT = s.ckT
    const text = buf.toString('utf8')
    if (!text.trim()) return
    let parsed: unknown
    let ok = true
    try {
      parsed = JSON.parse(text)
    } catch {
      ok = false
    }
    const rec: WalLine = ok ? Object(parsed) : { event: 'Unparseable' }
    const keep = woff >= s.replayTo && !s.redo.has(woff)
    // `?? ''` keeps Date.parse's NaN for a missing ts.
    let t = s.redo.get(woff) ?? Date.parse(rec.ts ?? '')
    if (Number.isNaN(t)) t = s.lastT ?? now
    s.lastT = t
    const event = typeof rec.event === 'string' ? rec.event : null
    const tool = str(rec.tool_name)
    const tuid = str(rec.tool_use_id)
    const agent = str(rec.agent_id)
    const agentType = str(rec.agent_type)
    const dur = typeof rec.duration_ms === 'number' ? rec.duration_ms : null
    const mcp = (tool?.startsWith('mcp__') && MCP_ROLE.get(event ?? '')) || null
    if (keep) {
      const base = {
        k: 'ev',
        t,
        event,
        cat: catOf(event ?? undefined),
        tool,
        dur,
        tuid,
        agent,
        agentType,
        mcp,
        err: mcp !== null && event === 'PostToolUseFailure',
        woff,
      } as const
      out.push(ok ? ({ ...base, rec: parsed } satisfies Ev) : ({ ...base, raw: text } satisfies Ev))
    }
    if (tuid === null) return
    const payload = rec.payload
    if (event === 'PreToolUse') {
      s.open.delete(tuid)
      s.open.set(tuid, { t, input: payload?.tool_input ?? null })
      capped(s.open)
    } else if (event === 'PostToolUse' || event === 'PostToolUseFailure') {
      const pre = s.open.get(tuid)
      s.open.delete(tuid)
      // Before the checkpoint `called` is left alone: absorb loaded the target's newest tuids, and a replayed
      // old one would evict them, so a call row after the checkpoint would be written again.
      if (woff < s.replayTo) return
      if (s.called.has(tuid)) return
      s.called.add(tuid)
      capped(s.called)
      out.push({
        k: 'call',
        tuid,
        t: pre?.t ?? t,
        end: t,
        dur,
        tool,
        mcp: tool?.startsWith('mcp__') ?? false,
        err: event === 'PostToolUseFailure',
        agent,
        agentType,
        input: pre ? pre.input : (payload?.tool_input ?? null),
        response: payload?.tool_response ?? payload?.error ?? null,
      })
    }
  }

  /**
   * Reads whole lines from `s.off` until the WAL end or the deadline; a partial last line waits for its newline.
   * Null when the WAL went away after its stat (moved to trash).
   */
  const pass = (s: Session, path: string, size: number, deadline: number, now: number): TargetRecord[] | null => {
    const out: TargetRecord[] = []
    let fd: number
    try {
      fd = openSync(path, 'r')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
    try {
      while (s.off < size) {
        let want = Math.min(CHUNK, size - s.off)
        let buf = readAt(fd, s.off, want)
        let end = buf.lastIndexOf(0x0a)
        while (end === -1 && buf.length === want && want < size - s.off) {
          want = Math.min(want * 2, size - s.off)
          buf = readAt(fd, s.off, want)
          end = buf.lastIndexOf(0x0a)
        }
        if (end === -1) break
        let start = 0
        for (let nl = buf.indexOf(0x0a); nl !== -1; nl = buf.indexOf(0x0a, start)) {
          line(s, buf.subarray(start, nl), s.off + start, now, out)
          start = nl + 1
        }
        s.off += start
        if (Date.now() >= deadline) break
      }
    } finally {
      closeSync(fd)
    }
    return out
  }

  /** Brings the session's target up to its WAL within about `budgetMs`. A missing session or WAL is skipped. */
  const sync = (id: string, budgetMs: number): SyncResult => {
    const now = Date.now()
    let s = sessions.get(id)
    const skip = (): SyncResult => (s ? result(s) : { done: 0, total: 0, stale: null })
    const dir = discovery.locate(id)
    if (dir === null) return skip()
    const wal = join(dir, `${id}.wal.jsonl`)
    const st = statSync(wal, { throwIfNoEntry: false })
    if (st === undefined) return skip()
    if (!s) {
      s = fresh(targetPath({ label: '', projectsDir: dirname(dir) }, id))
      sessions.set(id, s)
      absorb(s, s.reader.read().items)
      if (write && s.stale === null && s.version !== null) freeze(s, `format version ${s.version}`)
    }
    s.total = st.size
    if (!write) {
      const r = s.reader.read()
      if (r.reset) {
        // The reader already restarted from byte 0, so it is kept.
        s = fresh(s.file, s.reader)
        sessions.set(id, s)
        s.total = st.size
      }
      absorb(s, r.items)
      return result(s)
    }
    if (s.stale !== null) return result(s)
    const replaced = s.ino !== 0 && st.ino !== s.ino
    const shrank = st.size < Math.max(s.off, s.replayTo)
    if ((replaced || shrank) && !s.head) {
      // Nothing is built from the old WAL yet, so there is nothing to freeze: start over on the new one.
      s = fresh(s.file)
      sessions.set(id, s)
      s.total = st.size
    } else if (replaced) freeze(s, 'wal replaced')
    else if (shrank) freeze(s, 'wal shrank')
    if (s.stale !== null) return result(s)
    const out = pass(s, wal, st.size, now + budgetMs, now)
    if (out === null) return result(s)
    s.ino = st.ino
    if (out.length) {
      if (!s.head) out.unshift({ k: 'head', v: TARGET_VERSION, id, wal: true })
      out.push({ k: 'ck', wal: { ino: s.ino, off: s.off }, tr: {} })
      try {
        appendRecords(s.file, out)
      } catch (e) {
        // The next sync re-opens from what reached the disk.
        sessions.delete(id)
        throw e
      }
      s.head = true
    }
    return result(s)
  }

  /** The last known progress of a session, without reading anything; null when it was never synced. */
  const state = (id: string): SyncResult | null => {
    const s = sessions.get(id)
    return s ? result(s) : null
  }

  /** Forgets a session's in-memory state; its next sync re-opens the target. */
  const drop = (id: string): void => {
    sessions.delete(id)
  }

  return { sync, state, drop }
}
