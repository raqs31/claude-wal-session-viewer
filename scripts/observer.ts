// observer.ts — the only writer of targets. Per session, a pass reads the transcripts (main, then its
// subagents, spawner first) and then the WAL from where the target left off. It appends the transcript
// records that changed, one `ev` per WAL line, a `call` per tool call, the `tok` records of the token
// join and then a `ck`. A session without a WAL gets its call and turn rows from the transcripts instead.
// After a restart a pass replays each source up to the last `ck` without writing, to rebuild its parser
// state, then continues.

import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { catOf, type McpRole, type Pipe, type RebuildResult } from '../shared/api.ts'
import { createDiscovery, type Discovery, SESSION_RE } from './discovery.ts'
import {
  acquireLock,
  appendRecords,
  createTargetReader,
  type Pos,
  releaseLock,
  TARGET_VERSION,
  type TargetItem,
  type TargetReader,
  type TargetRecord,
  targetDir,
  targetPath,
} from './target.ts'
import { createParser, LAST_TEXT, type Parser, type UsageRecord } from './transcripts.ts'

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
const MAIN = 'main'
const AGENT_RE = /^[A-Za-z0-9_-]+$/
// The hook clamps a long string to its first 2000 chars plus this suffix.
const CLAMP_RE = /…\[\+\d+ chars\]$/

// The fields the derivation reads, typed as the hook writes them; a line is not validated against it.
interface WalLine {
  ts?: string
  event?: unknown
  tool_name?: unknown
  tool_use_id?: unknown
  agent_id?: unknown
  agent_type?: unknown
  duration_ms?: unknown
  payload?: { tool_input?: unknown; tool_response?: unknown; error?: unknown; last_assistant_message?: unknown } | null
}

// biome-ignore lint/suspicious/noExplicitAny: deliberate, transcripts are schemaless JSON.
type Line = Record<string, any>

type Ev = Extract<TargetRecord, { k: 'ev' }>
type Head = Extract<TargetRecord, { k: 'head' }>

export type SyncResult = Pipe

interface AgentMeta {
  toolUseId: string
  agentType?: string
  description?: string
  model?: string
}

interface Transcript {
  // 'main' or the subagent id: the key in `ck.tr`.
  name: string
  path: string
  parser: Parser
  ino: number
  // The next byte to read, always a line start.
  off: number
  // Lines before this offset are already in the target: replay them without writing.
  replayTo: number
  // The file size at its last stat.
  size: number
  // New, or bytes were read in this pass: its records may have changed.
  grew: boolean
  // The row fields: null for main.
  agent: string | null
  agentType: string | null
  meta: AgentMeta | null
  // The rows of a session without a WAL: tool_use blocks waiting for their result, the replies that already
  // gave a Stop row, and the last slash command line, which a turn the model's reply starts belongs to.
  open: Map<string, { t: number; tool: string | null; input: unknown }>
  stopped: Set<string>
  command: Line | null
  // The token join's index into `parser.usage`, by reply id: usage order is the replies' file order.
  at: Map<string, number>
}

interface Session {
  file: string
  reader: TargetReader
  // Write mode: the target byte offset absorbed so far, and whether the rest is still to absorb. A new
  // session reads its target in pieces under the sync budget; `fresh` makes sessions with nothing to absorb.
  absorbed: number
  absorbing: boolean
  // The last pass stopped short of its sources' last whole lines (at its deadline), or none ran yet.
  behind: boolean
  // The last pass left a subagent unread: its spawn is in a part of a transcript not read yet.
  deferred: boolean
  head: boolean
  // `head.wal`; null until the head is known.
  wal: boolean | null
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
  // Main first, then the subagents in the order they were read.
  tr: Map<string, Transcript>
  // The last `ck.tr`, where each transcript's replay ends.
  ckTr: Record<string, Pos>
  // Turn rows an interrupted pass wrote after the last `ck`, by transcript line uuid; not written again.
  trRedo: Set<string>
  // The token join: call rows (by tuid) and WAL Stop / SubagentStop rows (by WAL offset) with no `tok` yet,
  // retried on every pass in which a source moved. `ended`: a SessionEnd came after the entry; an entry that
  // is still unjoinable then goes, with no `tok`.
  waiting: Map<string, { agent: string | null; ended: boolean }>
  stops: Map<number, { agent: string | null; t: number; text: string; ended: boolean }>
  // SessionEnds read from the WAL: a pass that sees it grow reads the transcripts once more.
  ends: number
  rejoin: boolean
  // What the target holds: the keyed records as their JSON, and the length of the listed ones.
  written: {
    use: Map<string, string>
    agent: Map<string, string>
    tools: Map<string, number>
    compacts: Map<string, number>
    turns: number
    cost: string | null
  }
}

/** Drops the oldest key once the set or map holds more than PENDING_MAX. */
const capped = (keys: Set<unknown> | Map<unknown, unknown>): void => {
  if (keys.size <= PENDING_MAX) return
  const oldest = keys.keys().next().value
  if (oldest !== undefined) keys.delete(oldest)
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

const prompt = (u: UsageRecord): number => u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h

/** The input a reply paid for fresh: the prompt without its cache reads. */
const freshInput = (u: UsageRecord): number => u.input + u.cacheWrite5m + u.cacheWrite1h

/** `freshInput` of a transcript line's raw `usage`, by the parser's rule: the cache writes count only from their 5m and 1h breakdown. */
const rawFresh = (u: Line): number =>
  (u.input_tokens ?? 0) + (u.cache_creation?.ephemeral_5m_input_tokens ?? 0) + (u.cache_creation?.ephemeral_1h_input_tokens ?? 0)

/** Part `i` of `total` split by `weights` (evenly when all are 0). Each part rounds the running sum, so the parts add up to `total`. */
const share = (total: number, weights: number[], i: number): number => {
  const w = weights.some((x) => x > 0) ? weights : weights.map(() => 1)
  const sum = w.reduce((a, b) => a + b, 0)
  const before = w.slice(0, i).reduce((a, b) => a + b, 0)
  return Math.round((total * (before + (w[i] ?? 0))) / sum) - Math.round((total * before) / sum)
}

const readAt = (fd: number, off: number, len: number): Buffer => {
  const buf = Buffer.allocUnsafe(len)
  return buf.subarray(0, readSync(fd, buf, 0, len, off))
}

/**
 * Calls `each` with every whole line (with its `\n`) from `from` until `size` or the deadline; a partial
 * last line waits for its newline. Returns the next line start, or null when the file went away after its stat.
 */
const lines = (path: string, from: number, size: number, deadline: number, each: (line: Buffer, off: number) => void): number | null => {
  let off = from
  let fd: number
  try {
    fd = openSync(path, 'r')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
  try {
    while (off < size) {
      let want = Math.min(CHUNK, size - off)
      let buf = readAt(fd, off, want)
      let end = buf.lastIndexOf(0x0a)
      while (end === -1 && buf.length === want && want < size - off) {
        want = Math.min(want * 2, size - off)
        buf = readAt(fd, off, want)
        end = buf.lastIndexOf(0x0a)
      }
      if (end === -1) break
      let start = 0
      for (let nl = buf.indexOf(0x0a); nl !== -1; nl = buf.indexOf(0x0a, start)) {
        each(buf.subarray(start, nl + 1), off + start)
        start = nl + 1
      }
      off += start
      if (Date.now() >= deadline) break
    }
  } finally {
    closeSync(fd)
  }
  return off
}

/** A target line as `createTargetReader` reads it: null when it is not JSON or has no string `k`. */
const targetRecord = (line: Buffer): TargetRecord | null => {
  try {
    const rec = JSON.parse(line.toString('utf8'))
    return rec !== null && typeof rec === 'object' && typeof rec.k === 'string' ? rec : null
  } catch {
    return null
  }
}

/** Line 1 of a target, without reading the rest. */
const headOf = (file: string): Head | null => {
  let fd: number
  try {
    fd = openSync(file, 'r')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
  try {
    const buf = readAt(fd, 0, 4096)
    const nl = buf.indexOf(0x0a)
    const rec = JSON.parse(buf.toString('utf8', 0, nl === -1 ? buf.length : nl))
    return rec?.k === 'head' ? rec : null
  } catch {
    return null
  } finally {
    closeSync(fd)
  }
}

export const createObserver = ({ discovery, write }: { discovery: Pick<Discovery, 'locate'>; write: boolean }) => {
  const sessions = new Map<string, Session>()

  const fresh = (file: string, reader = createTargetReader(file)): Session => ({
    file,
    reader,
    absorbed: 0,
    absorbing: false,
    behind: true,
    deferred: false,
    head: false,
    wal: null,
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
    tr: new Map(),
    ckTr: {},
    trRedo: new Set(),
    waiting: new Map(),
    stops: new Map(),
    ends: 0,
    rejoin: true,
    written: { use: new Map(), agent: new Map(), tools: new Map(), compacts: new Map(), turns: 0, cost: null },
  })

  /** A call row now waits for its `tok`. */
  const wait = (s: Session, tuid: string, agent: string | null): void => {
    s.waiting.set(tuid, { agent, ended: false })
    capped(s.waiting)
    s.rejoin = true
  }

  /** What a WAL `ev` changes in the join: a SessionEnd ends the waiting calls, a Stop with its message waits. */
  const watch = (s: Session, e: Ev): void => {
    if (e.woff === null) return
    if (e.event === 'SessionEnd') {
      for (const c of s.waiting.values()) c.ended = true
      for (const c of s.stops.values()) c.ended = true
      s.ends++
      s.rejoin = true
    } else if (e.event === 'Stop' || e.event === 'SubagentStop') {
      const text = (e.rec as WalLine | undefined)?.payload?.last_assistant_message
      if (typeof text !== 'string') return
      s.stops.set(e.woff, { agent: e.agent, t: e.t, text: text.replace(CLAMP_RE, '').slice(0, LAST_TEXT), ended: false })
      capped(s.stops)
      s.rejoin = true
    }
  }

  const absorb = (s: Session, items: TargetItem[]): void => {
    const w = s.written
    for (const { rec } of items) {
      if (rec.k === 'head' && !s.head) {
        s.head = true
        s.wal = rec.wal
        if (rec.v !== TARGET_VERSION) s.version = rec.v
      } else if (rec.k === 'ev') {
        if (rec.woff !== null) {
          s.evT = rec.t
          s.redo.set(rec.woff, rec.t)
          watch(s, rec)
        } else {
          const uuid = str((rec.rec as Line | undefined)?.uuid)
          if (uuid !== null) s.trRedo.add(uuid)
        }
      } else if (rec.k === 'call') {
        s.called.add(rec.tuid)
        capped(s.called)
        wait(s, rec.tuid, rec.agent)
      } else if (rec.k === 'tok') {
        if ('tuid' in rec) s.waiting.delete(rec.tuid)
        else s.stops.delete(rec.woff)
      } else if (rec.k === 'use') w.use.set(`${rec.agent}\n${rec.id}`, JSON.stringify(rec))
      else if (rec.k === 'agent') w.agent.set(rec.id, JSON.stringify(rec))
      else if (rec.k === 'tools') w.tools.set(rec.agent, rec.n)
      else if (rec.k === 'compact') w.compacts.set(rec.agent, (w.compacts.get(rec.agent) ?? 0) + 1)
      else if (rec.k === 'turn') w.turns++
      else if (rec.k === 'cost') w.cost = JSON.stringify(rec)
      else if (rec.k === 'ck') {
        if (rec.wal) {
          s.ino = rec.wal.ino
          s.replayTo = rec.wal.off
        }
        s.ckT = s.evT
        s.redo.clear()
        s.ckTr = rec.tr
        s.trRedo.clear()
      } else if (rec.k === 'stale') s.stale = rec.reason
    }
  }

  /** Absorbs the next whole lines of the target until its end or the deadline; clears `absorbing` at the end. */
  const absorbSome = (s: Session, deadline: number): void => {
    const size = statSync(s.file, { throwIfNoEntry: false })?.size ?? 0
    const items: TargetItem[] = []
    const end = lines(s.file, s.absorbed, size, deadline, (buf, off) => {
      const rec = targetRecord(buf.subarray(0, -1))
      if (rec !== null) items.push({ rec, off, len: buf.length - 1 })
    })
    absorb(s, items)
    // `lines` stops short of the end only at the deadline or at a rest with no newline, a torn tail that the
    // next append completes: before the deadline it can only be the tail.
    if (end === null || end === s.absorbed || end >= size || Date.now() < deadline) s.absorbing = false
    else s.absorbed = end
  }

  /** WAL plus transcript bytes. A transcript known only from the last `ck` (not read in this process) counts as done. */
  const result = (s: Session): SyncResult => {
    let done = Math.max(s.off, s.replayTo)
    let total = s.total
    for (const [name, ck] of Object.entries(s.ckTr)) {
      if (s.tr.has(name)) continue
      done += ck.off
      total += ck.off
    }
    for (const tr of s.tr.values()) {
      const at = Math.max(tr.off, tr.replayTo)
      done += at
      total += Math.max(tr.size, at)
    }
    return { done, total, stale: s.stale }
  }

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
      const ev: Ev = ok ? { ...base, rec: parsed } : { ...base, raw: text }
      out.push(ev)
      watch(s, ev)
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
      wait(s, tuid, agent)
    }
  }

  /** A turn row of a session without a WAL: an `ev` whose `rec` is the transcript line. */
  const turnRow = (s: Session, tr: Transcript, event: string, e: Line, t: number, keep: boolean, out: TargetRecord[], usage?: Line): void => {
    if (!keep || s.trRedo.has(e.uuid)) return
    out.push({
      k: 'ev',
      t,
      event,
      cat: catOf(event),
      tool: null,
      dur: null,
      tuid: null,
      agent: tr.agent,
      agentType: tr.agentType,
      mcp: null,
      err: false,
      woff: null,
      ...(typeof usage?.output_tokens === 'number' ? { out: usage.output_tokens, inp: rawFresh(usage) } : {}),
      rec: e,
    })
  }

  const callRow = (s: Session, tr: Transcript, b: Line, end: number, keep: boolean, out: TargetRecord[]): void => {
    const tuid = str(b.tool_use_id)
    const use = tuid === null ? undefined : tr.open.get(tuid)
    if (tuid === null || use === undefined) return
    tr.open.delete(tuid)
    // As for the WAL: a replayed line leaves `called` alone.
    if (!keep || s.called.has(tuid)) return
    s.called.add(tuid)
    capped(s.called)
    out.push({
      k: 'call',
      tuid,
      t: use.t,
      end,
      dur: end - use.t,
      tool: use.tool,
      mcp: use.tool?.startsWith('mcp__') ?? false,
      err: b.is_error === true,
      agent: tr.agent,
      agentType: tr.agentType,
      input: use.input,
      response: b.content ?? null,
    })
    wait(s, tuid, tr.agent)
  }

  const trLine = (s: Session, tr: Transcript, buf: Buffer, off: number, rows: boolean, now: number, out: TargetRecord[]): void => {
    const p = tr.parser
    const turns = p.turnStarts.length
    const task = p.meta.task
    p.push(buf)
    if (!rows) return
    let e: Line
    try {
      e = JSON.parse(buf.toString('utf8'))
    } catch {
      return
    }
    // The parser skips these lines too.
    if (!e || typeof e !== 'object' || typeof e.uuid !== 'string') return
    const keep = off >= tr.replayTo
    const when = (t: number): number => (Number.isNaN(t) ? now : t)
    const t = when(Date.parse(e.timestamp))
    const m: Line = e.message ?? {}
    const c = m.content
    if (e.type === 'user' && typeof c === 'string' && c.startsWith('<command-') && !e.isSidechain && !e.isMeta && !e.isCompactSummary) tr.command = e
    for (let i = turns; i < p.turnStarts.length; i++) {
      // A turn that a reply starts belongs to the slash command before it.
      turnRow(s, tr, 'UserPromptSubmit', e.type === 'user' ? e : (tr.command ?? e), when(p.turnStarts[i] ?? Number.NaN), keep, out)
      tr.command = null
    }
    if (tr.agent !== null && task === null && p.meta.task !== null) turnRow(s, tr, 'UserPromptSubmit', e, t, keep, out)
    const blocks: Line[] = Array.isArray(c) ? c : []
    if (e.type === 'assistant') {
      for (const b of blocks) {
        const id = str(b.id)
        if ((b.type === 'tool_use' || b.type === 'server_tool_use') && id !== null) {
          tr.open.delete(id)
          tr.open.set(id, { t, tool: str(b.name), input: b.input ?? null })
          capped(tr.open)
        } else if (b.tool_use_id) callRow(s, tr, b, t, keep, out)
      }
      // A reply's blocks can span several lines that all carry its stop_reason: one Stop per reply.
      const reply = str(m.id) ?? e.uuid
      if (m.stop_reason === 'end_turn' && !tr.stopped.has(reply)) {
        tr.stopped.add(reply)
        turnRow(s, tr, tr.agent === null ? 'Stop' : 'SubagentStop', e, t, keep, out, m.usage)
      }
    } else if (e.type === 'user') for (const b of blocks) if (b.type === 'tool_result') callRow(s, tr, b, t, keep, out)
  }

  const transcript = (s: Session, name: string, path: string, parser: Parser, meta: AgentMeta | null): Transcript => {
    const ck = s.ckTr[name]
    const tr: Transcript = {
      name,
      path,
      parser,
      ino: ck?.ino ?? 0,
      off: 0,
      replayTo: ck?.off ?? 0,
      size: 0,
      // A new agent gets its `agent` record even before its transcript has a line.
      grew: true,
      agent: meta ? name : null,
      agentType: str(meta?.agentType),
      meta,
      open: new Map(),
      stopped: new Set(),
      command: null,
      at: new Map(),
    }
    s.tr.set(name, tr)
    return tr
  }

  /** The deadline passed with a transcript still short of its stat size: a torn tail cannot be told from it. */
  const short = (s: Session, deadline: number): boolean => Date.now() >= deadline && [...s.tr.values()].some((tr) => tr.off < tr.size)

  /**
   * Reads a transcript's new whole lines until its end or the deadline, one chunk at least; the stale reason when it
   * shrank or is a new inode.
   */
  const grow = (s: Session, tr: Transcript, rows: boolean, now: number, deadline: number, out: TargetRecord[]): string | null => {
    const st = statSync(tr.path, { throwIfNoEntry: false })
    if (st === undefined) return null
    if (tr.ino !== 0 && st.ino !== tr.ino) return 'transcript replaced'
    if (st.size < Math.max(tr.off, tr.replayTo)) return 'transcript shrank'
    tr.size = st.size
    const end = lines(tr.path, tr.off, st.size, deadline, (buf, off) => trLine(s, tr, buf, off, rows, now, out))
    // Nothing reads timeline updates; cleared so the set does not grow with the file, as the store does.
    tr.parser.touched.clear()
    if (end === null || end === tr.off) return null
    tr.off = end
    tr.ino = st.ino
    tr.grew = true
    s.rejoin = true
    return null
  }

  const spawnOf = (s: Session, toolUseId: string) => {
    for (const tr of s.tr.values()) {
      const it = tr.parser.tools.get(toolUseId)
      if (it) return it
    }
    return undefined
  }

  /**
   * Adds and reads the subagents that got a `.meta.json` since the last pass. Once the deadline has passed with a
   * transcript unread, an agent whose spawn is not parsed yet waits: it would take the turn in progress, not its own.
   */
  const discover = (s: Session, dir: string, id: string, rows: boolean, now: number, deadline: number, out: TargetRecord[]): string | null => {
    const sub = join(dir, id, 'subagents')
    if (!existsSync(sub)) return null
    const left: { name: string; path: string; meta: AgentMeta }[] = []
    for (const file of readdirSync(sub)) {
      const name = /^agent-(.+)\.meta\.json$/.exec(file)?.[1]
      const path = join(sub, `agent-${name}.jsonl`)
      if (!name || !AGENT_RE.test(name) || s.tr.has(name) || !existsSync(path)) continue
      try {
        left.push({ name, path, meta: JSON.parse(readFileSync(join(sub, file), 'utf8')) })
      } catch {}
    }
    const main = s.tr.get(MAIN)
    while (left.length) {
      // A spawner is read before the agents it spawned. A spawn not flushed yet belongs to the turn in progress.
      const known = left.findIndex((x) => spawnOf(s, x.meta.toolUseId) !== undefined)
      if (known === -1 && short(s, deadline)) {
        s.deferred = true
        break
      }
      const [a] = left.splice(Math.max(0, known), 1)
      if (!a) break
      const turn = spawnOf(s, a.meta.toolUseId)?.turn ?? main?.parser.turnStarts.length ?? 0
      const stale = grow(s, transcript(s, a.name, a.path, createParser(a.name, turn, false), a.meta), rows, now, deadline, out)
      if (stale !== null) return stale
    }
    return null
  }

  /** Appends each keyed record whose value changed and each new listed record, from the transcripts that grew. */
  const changes = (s: Session, out: TargetRecord[]): void => {
    const w = s.written
    const all = [...s.tr.values()]
    if (!all.some((tr) => tr.grew)) return
    for (const tr of all) {
      if (!tr.grew) continue
      tr.grew = false
      const p = tr.parser
      if (tr.meta === null) {
        for (const t of p.turnStarts.slice(w.turns)) out.push({ k: 'turn', t })
        w.turns = Math.max(w.turns, p.turnStarts.length)
      }
      for (const u of p.usage) {
        const rec: TargetRecord = { k: 'use', ...u }
        const json = JSON.stringify(rec)
        const key = `${u.agent}\n${u.id}`
        if (w.use.get(key) === json) continue
        w.use.set(key, json)
        out.push(rec)
      }
      for (const c of p.compacts.slice(w.compacts.get(tr.name) ?? 0))
        out.push({ k: 'compact', agent: tr.name, t: c.t, trigger: c.trigger, pre: c.pre, post: c.post })
      w.compacts.set(tr.name, Math.max(w.compacts.get(tr.name) ?? 0, p.compacts.length))
      if (p.meta.toolCalls !== (w.tools.get(tr.name) ?? 0)) {
        w.tools.set(tr.name, p.meta.toolCalls)
        out.push({ k: 'tools', agent: tr.name, n: p.meta.toolCalls })
      }
    }
    for (const tr of all) {
      if (tr.meta === null) continue
      const { toolUseId, agentType, description, model } = tr.meta
      const rec: TargetRecord = {
        k: 'agent',
        id: tr.name,
        type: agentType ?? '',
        description: description ?? '',
        model: model ?? '',
        toolUseId,
        // The parent's transcript may be read after this agent's, so it is looked up on every pass.
        parent: all.find((o) => o.meta !== null && o.parser.tools.has(toolUseId))?.name ?? null,
        prompt: tr.parser.meta.task,
      }
      const json = JSON.stringify(rec)
      if (w.agent.get(tr.name) === json) continue
      w.agent.set(tr.name, json)
      out.push(rec)
    }
    const meta = s.tr.get(MAIN)?.parser.meta
    // A null cost is written only to replace one already written.
    if (meta && (meta.costUsd !== null || w.cost !== null)) {
      const rec: TargetRecord = { k: 'cost', usd: meta.costUsd, byModel: meta.costByModel }
      const json = JSON.stringify(rec)
      if (w.cost !== json) {
        w.cost = json
        out.push(rec)
      }
    }
  }

  /** The transcript part of a pass, until the deadline; `rows` also writes the call and turn rows. The stale reason, if any. */
  const transcripts = (s: Session, dir: string, id: string, rows: boolean, now: number, deadline: number, out: TargetRecord[]): string | null => {
    s.deferred = false
    if (!s.tr.has(MAIN)) transcript(s, MAIN, join(dir, `${id}.jsonl`), createParser(MAIN, 0, false), null)
    for (const tr of s.tr.values()) {
      const stale = grow(s, tr, rows, now, deadline, out)
      if (stale !== null) return stale
    }
    const stale = discover(s, dir, id, rows, now, deadline, out)
    if (stale !== null) return stale
    changes(s, out)
    return null
  }

  /** The transcript a row joins against: its agent's file; for the main agent, the first file read that holds the call. */
  const joinFile = (s: Session, agent: string | null, tuid: string | null): Transcript | undefined => {
    if (agent !== null) {
      const tr = s.tr.get(agent)
      return tr?.agent === agent ? tr : undefined
    }
    if (tuid === null) return s.tr.get(MAIN)
    for (const tr of s.tr.values()) if (tr.parser.toolInfo.has(tuid)) return tr
    return undefined
  }

  /** The `tok` of a waiting call by "Token rules"; null while it stays open. */
  const callTok = (s: Session, tuid: string, ended: boolean, agent: string | null): TargetRecord | null => {
    const tr = joinFile(s, agent, tuid)
    if (tr === undefined) return null
    const p = tr.parser
    for (let i = tr.at.size; i < p.usage.length; i++) tr.at.set(p.usage[i]?.id ?? '', i)
    const info = p.toolInfo.get(tuid)
    const reply = info && p.replyInfo.get(info.reply)
    const i = info && tr.at.get(info.reply)
    const r = i === undefined ? undefined : p.usage[i]
    if (reply === undefined || i === undefined || r === undefined) return null
    const at = reply.calls.findIndex((c) => c.id === tuid)
    const out = share(
      r.output,
      reply.calls.map((c) => c.size),
      at,
    )
    const inp = share(
      freshInput(r),
      reply.calls.map((c) => c.size),
      at,
    )
    const n = p.usage[i + 1]
    if (n === undefined) return ended ? { k: 'tok', tuid, out, inp } : null
    const growth = prompt(n) - prompt(r) - r.output
    if (growth < 0 || reply.prompted) return { k: 'tok', tuid, out, inp }
    const res = share(
      growth,
      reply.calls.map((c) => p.toolInfo.get(c.id)?.resultSize ?? 0),
      at,
    )
    return { k: 'tok', tuid, out, res, inp }
  }

  /** The `out` and `inp` of a WAL Stop: the agent's last reply at or before it, when its last text starts with the Stop's message. */
  const stopOut = (s: Session, stop: { agent: string | null; t: number; text: string }): { out: number; inp: number } | null => {
    const tr = joinFile(s, stop.agent, null)
    if (tr === undefined) return null
    const p = tr.parser
    for (let i = p.usage.length - 1; i >= 0; i--) {
      const r = p.usage[i]
      if (r === undefined || !(r.t <= stop.t)) continue
      return p.replyInfo.get(r.id)?.lastText.startsWith(stop.text) ? { out: r.output, inp: freshInput(r) } : null
    }
    return null
  }

  /**
   * Appends a `tok` for each waiting call and Stop that the transcripts now answer. While `cut`, a transcript is read
   * only in part, so a reply is missing or an earlier one could answer: nothing joins, and the next pass tries again.
   */
  const joinTokens = (s: Session, out: TargetRecord[], cut: boolean): void => {
    s.rejoin = cut
    if (cut) return
    for (const [tuid, c] of s.waiting) {
      const tok = callTok(s, tuid, c.ended, c.agent)
      if (tok === null) {
        if (c.ended) s.waiting.delete(tuid)
        continue
      }
      s.waiting.delete(tuid)
      out.push(tok)
    }
    for (const [woff, stop] of s.stops) {
      const n = stopOut(s, stop)
      if (n === null) {
        if (stop.ended) s.stops.delete(woff)
        continue
      }
      s.stops.delete(woff)
      out.push({ k: 'tok', woff, out: n.out, inp: n.inp })
    }
  }

  /** The WAL part of a pass, until the WAL end or the deadline. False when the WAL went away after its stat. */
  const walPass = (s: Session, path: string, size: number, deadline: number, now: number, out: TargetRecord[]): boolean => {
    const end = lines(path, s.off, size, deadline, (buf, woff) => line(s, buf.subarray(0, -1), woff, now, out))
    if (end === null) return false
    s.off = end
    return true
  }

  /**
   * Brings the session's target up to its sources within about `budgetMs` of reading, the transcripts first and then the
   * WAL; each source gets one chunk at least. A missing session is
   * skipped, and so is a missing WAL of a target built from one (it may be in trash). Read-only, a session without a
   * WAL still reads its target, so a frozen one reports its stale reason.
   */
  const sync = (id: string, budgetMs: number): SyncResult => {
    const now = Date.now()
    // One deadline for the whole pass: the transcripts are read first, so a large one leaves the WAL one chunk.
    const deadline = now + budgetMs
    let s = sessions.get(id)
    const skip = (): SyncResult => (s ? result(s) : { done: 0, total: 0, stale: null })
    const dir = discovery.locate(id)
    if (dir === null) return skip()
    const wal = join(dir, `${id}.wal.jsonl`)
    const st = statSync(wal, { throwIfNoEntry: false })
    const file = s?.file ?? targetFile(discovery, id)
    if (file === null) return skip()
    if (st === undefined && (s ? s.wal === true : headOf(file)?.wal === true)) return skip()
    if (!s) {
      s = fresh(file)
      sessions.set(id, s)
      if (write) s.absorbing = true
      else absorb(s, s.reader.read().items)
    }
    s.total = st?.size ?? 0
    if (!write) {
      const r = s.reader.read()
      if (r.reset) {
        // The reader already restarted from byte 0, so it is kept.
        s = fresh(s.file, s.reader)
        sessions.set(id, s)
        s.total = st?.size ?? 0
      }
      absorb(s, r.items)
      return result(s)
    }
    if (s.absorbing) {
      absorbSome(s, deadline)
      if (s.absorbing) return result(s)
      if (s.stale === null && s.version !== null) freeze(s, `format version ${s.version}`)
    }
    if (s.stale !== null) return result(s)
    if (st !== undefined) {
      const replaced = s.ino !== 0 && st.ino !== s.ino
      const shrank = st.size < Math.max(s.off, s.replayTo)
      if (s.head && s.wal === false) freeze(s, 'wal appeared')
      else if ((replaced || shrank) && !s.head) {
        // Nothing is built from the old WAL yet, so there is nothing to freeze: start over on the new one.
        s = fresh(s.file)
        sessions.set(id, s)
        s.total = st.size
      } else if (replaced) freeze(s, 'wal replaced')
      else if (shrank) freeze(s, 'wal shrank')
      if (s.stale !== null) return result(s)
    }
    const out: TargetRecord[] = []
    let stale = transcripts(s, dir, id, st === undefined, now, deadline, out)
    if (stale !== null && !s.head) {
      // As for the WAL: nothing is built from the old transcript yet, so start over.
      s = fresh(s.file)
      sessions.set(id, s)
      s.total = st?.size ?? 0
      out.length = 0
      stale = transcripts(s, dir, id, st === undefined, now, deadline, out)
    }
    if (stale !== null) {
      freeze(s, stale)
      return result(s)
    }
    const ends = s.ends
    if (st !== undefined) {
      if (!walPass(s, wal, st.size, deadline, now, out)) {
        // The transcript records of this pass are not written: the next sync re-opens from the target.
        sessions.delete(id)
        return result(s)
      }
      s.ino = st.ino
    }
    // A reply written between the transcript reads and the WAL read, with its SessionEnd in that WAL read,
    // would otherwise give its call `out` only for good.
    if (s.ends > ends) {
      stale = transcripts(s, dir, id, st === undefined, now, deadline, out)
      if (stale !== null) {
        freeze(s, stale)
        return result(s)
      }
    }
    const cut = s.deferred || short(s, deadline)
    if (s.rejoin) joinTokens(s, out, cut)
    // Short of the WAL end before the deadline is a torn tail: the pass is caught up to the last whole line.
    s.behind = cut || (st !== undefined && s.off < st.size && Date.now() >= deadline)
    if (out.length) {
      if (!s.head) out.unshift({ k: 'head', v: TARGET_VERSION, id, wal: st !== undefined })
      const tr = Object.fromEntries([...s.tr.values()].filter((t) => t.off > 0).map((t) => [t.name, { ino: t.ino, off: t.off }]))
      out.push({ k: 'ck', wal: st === undefined ? null : { ino: s.ino, off: s.off }, tr })
      try {
        appendRecords(s.file, out)
      } catch (e) {
        // The next sync re-opens from what reached the disk. Until it does, the session is not built.
        const again = fresh(s.file)
        again.absorbing = true
        sessions.set(id, again)
        throw e
      }
      s.head = true
      s.wal = st !== undefined
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

  /** Whether the last pass caught the session up to its sources' last whole lines; false while it absorbs its target. */
  const built = (id: string): boolean => {
    const s = sessions.get(id)
    return s !== undefined && !s.absorbing && !s.behind
  }

  return { sync, state, drop, built }
}

export type Observer = ReturnType<typeof createObserver>

/** The target file of a session; null when discovery does not know the session. */
export const targetFile = (discovery: Pick<Discovery, 'locate'>, id: string): string | null => {
  const dir = discovery.locate(id)
  return dir === null ? null : targetPath({ label: '', projectsDir: dirname(dir) }, id)
}

/** What the index and the store read the pipeline through: where a session's target is, and how far it is built. */
export interface Targets {
  target: (id: string) => string | null
  observer: Pick<Observer, 'state'>
}

/**
 * Deletes a session's target and forgets its in-memory state, so its next sync builds it again from the sources.
 * A target built from a WAL that is gone is kept, as sync keeps it: its events exist nowhere else.
 * The caller holds the cache lock; the id must have passed `validId`.
 */
export const rebuild = (observer: Pick<Observer, 'drop'>, discovery: Pick<Discovery, 'locate'>, id: string): RebuildResult => {
  const dir = discovery.locate(id)
  const file = targetFile(discovery, id)
  if (dir === null || file === null) return { id, ok: false, error: 'unknown session' }
  if (!existsSync(join(dir, `${id}.wal.jsonl`)) && headOf(file)?.wal === true) return { id, ok: false, error: 'wal missing' }
  try {
    rmSync(file, { force: true })
  } catch (e) {
    return { id, ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  observer.drop(id)
  return { id, ok: true }
}

export const pipeOf = (observer: Pick<Observer, 'state'>, id: string): Pipe => observer.state(id) ?? { done: 0, total: 0, stale: null }

// WAL_SYNC_BUDGET_MS exists for tests only, so they can make the budget 0.
export const syncBudget = (): number => {
  const env = process.env.WAL_SYNC_BUDGET_MS?.trim()
  const ms = env ? Number(env) : Number.NaN
  return Number.isFinite(ms) && ms >= 0 ? ms : 150
}

/** Syncs the sessions in order under one shared deadline. A session whose sync throws keeps its last known progress. */
export const syncAll = (observer: Pick<Observer, 'sync' | 'state'>, ids: string[], budgetMs = syncBudget()): Record<string, Pipe> => {
  const deadline = Date.now() + budgetMs
  const pipe: Record<string, Pipe> = {}
  for (const id of ids) {
    try {
      pipe[id] = observer.sync(id, Math.max(0, deadline - Date.now()))
    } catch (e) {
      console.error(`observer: sync ${id}: ${e instanceof Error ? e.message : String(e)}`)
      pipe[id] = pipeOf(observer, id)
    }
  }
  return pipe
}

/**
 * `wal rebuild [ids…]`: deletes the targets of the given sessions, or of all, and builds them again, one session at
 * a time, saying how far each is. Takes the cache lock of every source for the run. Returns the exit code.
 */
export const runRebuild = (discovery: Discovery, ids: string[], say: (s: string) => void, complain: (s: string) => void): number => {
  const taken: string[] = []
  const release = (): void => {
    for (const dir of taken) releaseLock(dir)
  }
  for (const dir of new Set(discovery.sources().map(targetDir))) {
    if (!acquireLock(dir)) {
      release()
      complain('server running — use Rebuild in the page')
      return 1
    }
    taken.push(dir)
  }
  try {
    const observer = createObserver({ discovery, write: true })
    const all = ids.length === 0 ? discovery.list().sessions.map((s) => s.id) : ids
    let failed = 0
    for (const id of all) {
      const r = rebuild(observer, discovery, id)
      if (!r.ok) {
        failed++
        complain(`${id}: ${r.error}`)
        continue
      }
      let pipe = observer.sync(id, 50)
      // A pass that moves nothing ends the session: a partial last line would otherwise never reach `total`.
      for (let last = -1; pipe.stale === null && pipe.done < pipe.total && pipe.done !== last; ) {
        last = pipe.done
        pipe = observer.sync(id, 50)
      }
      say(`${id} ${pipe.done}/${pipe.total}${pipe.stale === null ? '' : ` stale: ${pipe.stale}`}`)
    }
    return failed === 0 ? 0 : 1
  } finally {
    release()
  }
}

if (process.argv[1] === import.meta.filename) {
  const args = process.argv.slice(2)
  const extra = args.filter((a) => a.startsWith('--source=')).map((a) => a.slice('--source='.length))
  const flag = args.find((a) => a.startsWith('-') && !a.startsWith('--source='))
  if (flag !== undefined) {
    console.error(`unknown option: ${flag}\nusage: wal rebuild [ids…] [--source=<config-dir>]...`)
    process.exit(2)
  }
  const ids = args.filter((a) => !a.startsWith('--source='))
  const bad = ids.find((id) => !SESSION_RE.test(id))
  if (bad !== undefined) {
    console.error(`not a session id: ${bad}`)
    process.exit(2)
  }
  process.exit(runRebuild(createDiscovery(extra), ids, console.log, console.error))
}
