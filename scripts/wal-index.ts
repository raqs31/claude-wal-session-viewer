// wal-index.ts — per-session indexes over `<id>.wal.jsonl`, kept in a small LRU, and the
// newest-first merge that /events and /events-stream run over a pick of them.

import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { type AgentNode, CATEGORIES, type Category, catOf, type FirstPage, type McpRole, type Page, type Row } from '../shared/api.ts'
import type { Discovery } from './discovery.ts'
import { validId } from './sessions.ts'

const MCP_ROLE: Record<string, McpRole> = { PreToolUse: 'request', PostToolUse: 'response', PostToolUseFailure: 'response' }
// A Pre whose Post never lands (killed session, crashed server) would otherwise be held forever.
const PENDING_MAX = 10_000
const CHUNK = 8 * 1024 * 1024
// A reader's window: an 8 MB one per picked index per miss kept RSS near the budget, while 1 MB
// still holds hundreds of rows per disk read.
const WINDOW = 1024 * 1024
const OPEN_MAX = 8

// The fields indexLine reads, typed as the hook writes them; a line is not validated against it.
interface WalLine {
  ts?: string
  event?: string
  tool_name?: string | null
  tool_use_id?: string | null
  agent_id?: unknown
  agent_type?: unknown
  duration_ms?: unknown
  payload?: { tool_response?: { agentId?: unknown }; background_tasks?: unknown }
}

// Indexes in bounds by construction, which noUncheckedIndexedAccess cannot see.
const nth = <T>(a: readonly T[], i: number): T => {
  const v = a[i]
  if (v === undefined) throw new RangeError(`index ${i} out of bounds`)
  return v
}

// Seeded per process so a page reconnecting to a restarted server always sees a new gen, even
// if the file was truncated while the server was down.
let genSeed = Date.now()

export interface IndexEntry {
  off: number
  len: number
  t: number
  day: number
  minute: number
  event: string | undefined
  cat: Category
  tool: string | null
  dur: number | null
  tuid: string | null
  // `agent_id`; null is the session's main agent.
  agent: string | null
  agentType: string | null
  mcp: McpRole | null
  err: boolean
  virtual: { pre: number; post: number } | null
}

export interface WalIndex {
  id: string
  path: string
  gen: number
  entries: IndexEntry[]
  // Seqs sorted by `t` (ties keep seq order): legacy lines folded in can be out of time order.
  order: number[]
  tools: Set<string>
  // Event names in first-seen order, including the synthetic 'MCP call'.
  events: Set<string>
  cats: Set<Category>
  // First-seen order; 'main' for rows without `agent_id`.
  agents: Map<string, string | null>
  // Spawned agent_id → the agent whose Agent call returned it (null: main), from that call's PostToolUse.
  parents: Map<string, string | null>
  // Bumped whenever `agents` or `parents` changes, so tree lineage cached against it goes stale.
  links: number
  // Progress summary agent_id → the subagent its lone running background task names.
  about: Map<string, string>
  tail(): void
  reader(asc?: boolean): Reader
}

export interface Reader {
  text(r: IndexEntry): string
  close(): void
}

export const createWalIndex = (id: string, path: string): WalIndex => {
  // tool_use_id → seq of an MCP PreToolUse still waiting for its Post.
  let pending = new Map<string, number>()
  const pos: { ino: number; offset: number; carry: Buffer } = { ino: 0, offset: 0, carry: Buffer.alloc(0) }

  const ix: WalIndex = {
    id,
    path,
    gen: ++genSeed,
    entries: [],
    order: [],
    tools: new Set(),
    events: new Set(),
    cats: new Set(),
    agents: new Map(),
    parents: new Map(),
    about: new Map(),
    links: 0,
    tail,
    reader,
  }

  const push = (e: IndexEntry): void => {
    const seq = ix.entries.length
    ix.entries.push(e)
    if (e.event !== undefined) ix.events.add(e.event)
    ix.cats.add(e.cat)
    const o = ix.order
    const top = o.at(-1)
    if (top === undefined || nth(ix.entries, top).t <= e.t) return void o.push(seq)
    let lo = 0
    let hi = o.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (nth(ix.entries, nth(o, mid)).t <= e.t) lo = mid + 1
      else hi = mid
    }
    o.splice(lo, 0, seq)
  }

  const indexLine = (buf: Buffer, off: number): void => {
    const line = buf.toString('utf8')
    if (!line.trim()) return
    let rec: WalLine
    try {
      rec = Object(JSON.parse(line))
    } catch {
      rec = { event: 'Unparseable' }
    }
    const { entries } = ix
    // Falling back to the previous row's time, not now, keeps old unparseable lines from looking
    // new after every restart.
    // `?? ''` keeps Date.parse's NaN for a missing ts.
    let t = Date.parse(rec.ts ?? '')
    if (Number.isNaN(t)) t = entries.at(-1)?.t ?? Date.now()
    const d = new Date(t)
    const tool = rec.tool_name ?? null
    if (tool !== null) ix.tools.add(tool)
    const agent = typeof rec.agent_id === 'string' && rec.agent_id ? rec.agent_id : null
    const agentType = typeof rec.agent_type === 'string' && rec.agent_type ? rec.agent_type : null
    const known = ix.agents.get(agent ?? 'main')
    if (known === undefined || (known === null && agentType !== null)) {
      ix.agents.set(agent ?? 'main', agentType)
      ix.links++
    }
    const payload = rec.payload
    if (tool === 'Agent' && rec.event === 'PostToolUse') {
      const child = payload?.tool_response?.agentId
      if (typeof child === 'string' && child && child !== agent && ix.parents.get(child) !== agent) {
        ix.parents.set(child, agent)
        ix.links++
      }
    }
    const tasks = payload?.background_tasks
    if (rec.event === 'SubagentStop' && agent !== null && Array.isArray(tasks)) {
      // With two subagents running the summary could be about either, so it stays unattributed.
      const subs = tasks.filter((b) => b?.type === 'subagent' && typeof b.id === 'string' && b.id)
      if (subs.length === 1) ix.about.set(agent, subs[0].id)
    }
    const tuid = rec.tool_use_id ?? null
    const mcp = (typeof tool === 'string' && tool.startsWith('mcp__') && MCP_ROLE[rec.event ?? '']) || null
    // Every entry carries every key, so the index stays one hidden class.
    const entry: IndexEntry = {
      off,
      len: buf.length,
      t,
      day: d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(),
      minute: d.getHours() * 60 + d.getMinutes(),
      event: rec.event,
      cat: catOf(rec.event),
      tool,
      dur: typeof rec.duration_ms === 'number' ? rec.duration_ms : null,
      tuid,
      agent,
      agentType,
      mcp,
      err: mcp !== null && rec.event === 'PostToolUseFailure',
      virtual: null,
    }
    push(entry)
    if (tuid === null) return
    if (mcp === 'request') {
      pending.set(tuid, entries.length - 1)
      if (pending.size > PENDING_MAX) {
        const oldest = pending.keys().next().value
        if (oldest !== undefined) pending.delete(oldest)
      }
    } else if (mcp === 'response') {
      const pre = pending.get(tuid)
      if (pre === undefined) return
      // Deleted on pairing, so a duplicate Post never yields a second call row.
      pending.delete(tuid)
      push({ ...entry, event: 'MCP call', cat: 'mcp', mcp: null, virtual: { pre, post: entries.length - 1 } })
    }
  }

  // Lines are split on the newline byte, never on decoded-string indices: multibyte UTF-8 would
  // otherwise shift every later offset. A missing file is an empty index until it appears.
  function tail(): void {
    // A deleted file is a truncation to zero: streams must get `reset` and the index must not
    // outlive the bytes it points at. A new inode is a replaced file, whatever its size.
    const st = statSync(path, { throwIfNoEntry: false })
    const size = st?.size ?? 0
    if (size < pos.offset || (st && pos.offset > 0 && st.ino !== pos.ino)) {
      ix.entries = []
      ix.order = []
      ix.tools = new Set()
      ix.events = new Set()
      ix.cats = new Set()
      ix.agents = new Map()
      ix.parents = new Map()
      ix.about = new Map()
      ix.links++
      pending = new Map()
      ix.gen = ++genSeed
      pos.offset = 0
      pos.carry = Buffer.alloc(0)
    }
    if (st) pos.ino = st.ino
    if (size === pos.offset) return

    const fd = openSync(path, 'r')
    // One buffer per call: the carried partial line moves to its front, and the buffer grows only
    // once a long line leaves less than half a read of room.
    let buf = Buffer.allocUnsafe(pos.carry.length + Math.min(CHUNK, size - pos.offset))
    let have = pos.carry.copy(buf)
    try {
      while (pos.offset < size) {
        const next = Math.min(CHUNK, size - pos.offset)
        if (buf.length - have < next / 2) {
          const wider = Buffer.allocUnsafe(have + next)
          buf.copy(wider, 0, 0, have)
          buf = wider
        }
        const n = readSync(fd, buf, have, Math.min(buf.length - have, next), pos.offset)
        if (n === 0) break
        const view = buf.subarray(0, have + n)
        const base = pos.offset - have
        pos.offset += n
        let start = 0
        for (let nl = view.indexOf(0x0a); nl !== -1; nl = view.indexOf(0x0a, start)) {
          indexLine(view.subarray(start, nl), base + start)
          start = nl + 1
        }
        have = buf.copy(buf, 0, start, view.length)
      }
    } finally {
      closeSync(fd)
      // Copied so the carry does not pin the whole buffer.
      pos.carry = Buffer.from(buf.subarray(0, have))
    }
  }

  // A query visits rows newest first, a stream tick oldest first, so on a miss the window extends
  // in the direction of travel. It never extends past the last indexed line, so a tick with one
  // new row reads only that row's bytes.
  function reader(asc = false): Reader {
    let fd: number | null = null
    let start = 0
    // The window is a view into `room`, reused across misses; it grows only for a longer line.
    let room = Buffer.alloc(0)
    let buf = room
    return {
      text(r) {
        if (r.off < start || r.off + r.len > start + buf.length) {
          fd ??= openSync(path, 'r')
          let end = r.off + r.len
          if (asc) {
            // `r` is itself indexed, so the fallback never applies.
            const last = ix.entries.at(-1) ?? r
            start = r.off
            end = Math.max(end, Math.min(r.off + WINDOW, last.off + last.len))
          } else {
            start = Math.min(r.off, Math.max(0, end - WINDOW))
          }
          if (room.length < end - start) room = Buffer.allocUnsafe(end - start)
          buf = room.subarray(0, readSync(fd, room, 0, end - start, start))
        }
        return buf.toString('utf8', r.off - start, r.off - start + r.len)
      },
      close() {
        if (fd !== null) closeSync(fd)
      },
    }
  }

  tail()
  return ix
}

/**
 * Indexes by session id, created lazily from discovery. Beyond OPEN_MAX the least recently used
 * go, except those a stream holds (`busy`) or the current request asked for.
 */
export const createIndexes = (discovery: Pick<Discovery, 'locate'>, busy: (id: string) => boolean) => {
  const open = new Map<string, WalIndex>()

  /** null: an invalid id. Ids with no transcript are skipped into `unknown`. Tails every index it returns. */
  const acquire = (ids: string[]): { ixs: WalIndex[]; unknown: string[] } | null => {
    if (!ids.every(validId)) return null
    const ixs: WalIndex[] = []
    const unknown: string[] = []
    for (const id of ids) {
      let ix = open.get(id)
      if (!ix) {
        const dir = discovery.locate(id)
        if (!dir) {
          unknown.push(id)
          continue
        }
        ix = createWalIndex(id, join(dir, `${id}.wal.jsonl`))
      } else ix.tail()
      open.delete(id)
      open.set(id, ix)
      ixs.push(ix)
    }
    for (const k of open.keys()) if (open.size > OPEN_MAX && !ids.includes(k) && !busy(k)) open.delete(k)
    return { ixs, unknown }
  }

  return { acquire }
}

// ---- queries over a pick ----

// For cat, tool, event and agent, present-but-empty is a real filter (every chip off), not unset.
// For their `_not` twins an empty set simply excludes nothing.
const list = (p: URLSearchParams, name: string): Set<string> | null => {
  const v = p.get(name)
  return v === null ? null : new Set(v.split(',').filter(Boolean))
}
const dayOf = (s: string | null): number | null => (s !== null && /^\d{4}-\d{2}-\d{2}$/.test(s) ? Number(s.replaceAll('-', '')) : null)
const minuteOf = (s: string | null): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? '')
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h < 24 && min < 60 ? h * 60 + min : null
}
const num = (s: string | null | undefined): number | null => (s?.trim() && Number.isFinite(Number(s)) ? Number(s) : null)

type Tree = Pick<WalIndex, 'agents' | 'parents' | 'about' | 'links'>
export type Matcher = (r: IndexEntry, ix: Tree & Pick<WalIndex, 'id'>, text: (r: IndexEntry) => string) => boolean

// A subagent whose type never arrives on any record: Claude Code's one-line background-task
// progress summaries, each a lone SubagentStop.
const isSummary = (ix: Tree, agent: string | null): boolean => agent !== null && ix.agents.get(agent) == null
const typed = (ix: Tree, a: string | null | undefined): a is string => a != null && ix.agents.get(a) != null

/** The subagent an agent hangs under in the tree, null for main: its spawner, unless that is untyped or spawned by it. */
export const parentOf = (ix: Tree, a: string): string | null => {
  const p = ix.parents.get(a)
  if (!typed(ix, p)) return null
  const seen = new Set<string>()
  for (let q: string | null | undefined = p; q != null && !seen.has(q); q = ix.parents.get(q)) {
    if (q === a) return null
    seen.add(q)
  }
  return p
}

// An agent and its tree ancestors as a linked chain shared between siblings, so a row walks its
// lineage in O(depth) without re-checking spawn cycles at each step.
interface Lineage {
  id: string
  up: Lineage | null
}
const lineages = new WeakMap<Tree, { links: number; of: Map<string, Lineage> }>()
export const lineageOf = (ix: Tree, a: string): Lineage => {
  let c = lineages.get(ix)
  if (!c || c.links !== ix.links) {
    c = { links: ix.links, of: new Map() }
    lineages.set(ix, c)
  }
  const path: string[] = []
  let top: Lineage | null = null
  for (let q: string | null = a; q !== null; q = parentOf(ix, q)) {
    top = c.of.get(q) ?? null
    if (top) break
    path.push(q)
  }
  for (const id of path.reverse()) {
    top = { id, up: top }
    c.of.set(id, top)
  }
  // The first step visits `a` itself, so it is either cached or on `path`.
  if (!top) throw new Error(`no lineage for ${a}`)
  return top
}

/** The subagent a progress summary describes, null when it names none or one this session never saw. */
export const ownerOf = (ix: Tree, summary: string): string | null => {
  const d = ix.about.get(summary)
  return typed(ix, d) ? d : null
}

/** One session's agents as the facet tree: main at the root, each subagent under its spawner. */
export const agentTree = (ix: Tree): AgentNode => {
  const main: AgentNode = { id: 'main', type: null, summaries: 0, children: [] }
  const nodes = new Map<string, AgentNode>()
  for (const [id, type] of ix.agents) if (id !== 'main' && type !== null) nodes.set(id, { id, type, summaries: 0, children: [] })
  for (const id of ix.agents.keys()) {
    if (id === 'main') continue
    const node = nodes.get(id)
    if (node === undefined) {
      const o = ownerOf(ix, id)
      ;((o && nodes.get(o)) || main).summaries++
    } else {
      const p = lineageOf(ix, id).up?.id
      ;((p && nodes.get(p)) || main).children.push(node)
    }
  }
  return main
}

const TOKEN = /^([0-9a-f-]{36}):(.+)$/

/**
 * `agent` tokens, each scoped to a session since agent ids mean nothing outside theirs:
 * `<sess>:*` the whole session, `<sess>:<agent>` that agent's own rows (`main` included),
 * `<sess>:<agent>*` it and everything below it in the tree (`main*` is the whole session),
 * `<sess>:summaries:<agent|main>` the progress summaries attached there. Subtrees resolve per
 * row, so a stream picks up agents spawned after it opened. null when no token parses (an
 * unscoped one saved by an older page): no filter, rather than an empty page.
 */
const agentMatch = (tokens: Set<string>): ((r: IndexEntry, ix: Tree & Pick<WalIndex, 'id'>) => boolean) | null => {
  const by = new Map<string, Set<string>>()
  for (const t of tokens) {
    const m = TOKEN.exec(t)
    const sess = m?.[1]
    const agent = m?.[2]
    if (sess === undefined || agent === undefined) continue
    let set = by.get(sess)
    if (!set) {
      set = new Set()
      by.set(sess, set)
    }
    set.add(agent === 'main*' ? '*' : agent)
  }
  if (tokens.size && !by.size) return null
  return (r, ix) => {
    const spec = by.get(ix.id)
    if (!spec) return false
    if (spec.has('*')) return true
    let node: string | null
    if (r.agent !== null && isSummary(ix, r.agent)) {
      node = ownerOf(ix, r.agent)
      if (spec.has(`summaries:${node ?? 'main'}`)) return true
    } else {
      node = r.agent
      if (spec.has(node ?? 'main')) return true
    }
    for (let l = node === null ? null : lineageOf(ix, node); l; l = l.up) if (spec.has(`${l.id}*`)) return true
    return false
  }
}

export const matcher = (p: URLSearchParams): Matcher => {
  const cats = list(p, 'cat')
  const tls = list(p, 'tool')
  const evs = list(p, 'event')
  const agents = list(p, 'agent')
  const inAgents = agents && agentMatch(agents)
  const catsNot = list(p, 'cat_not')
  const tlsNot = list(p, 'tool_not')
  const evsNot = list(p, 'event_not')
  const agentsNot = list(p, 'agent_not')
  // agentMatch is false for a session with no token, which is exactly what keeps that session's rows here.
  const outAgents = agentsNot && agentMatch(agentsNot)
  const dayFrom = dayOf(p.get('date_from'))
  const dayTo = dayOf(p.get('date_to'))
  const lo = minuteOf(p.get('time_from')) ?? 0
  const hi = minuteOf(p.get('time_to')) ?? 1439
  const min = num(p.get('min_ms'))
  const max = num(p.get('max_ms'))
  const nodur = p.get('nodur') === 'include'
  const q = (p.get('q') || '').toLowerCase()
  return (r, ix, text) => {
    if (cats && !cats.has(r.cat)) return false
    if (tls && !tls.has(r.tool ?? '-')) return false
    if (evs && !evs.has(r.event ?? '')) return false
    if (inAgents && !inAgents(r, ix)) return false
    if (catsNot?.has(r.cat)) return false
    if (tlsNot?.has(r.tool ?? '-')) return false
    if (evsNot?.has(r.event ?? '')) return false
    if (outAgents?.(r, ix)) return false
    if (dayFrom !== null && r.day < dayFrom) return false
    if (dayTo !== null && r.day > dayTo) return false
    if (lo <= hi ? r.minute < lo || r.minute > hi : r.minute < lo && r.minute > hi) return false
    if (min !== null || max !== null) {
      if (r.dur === null ? !nodur : (min !== null && r.dur < min) || (max !== null && r.dur > max)) return false
    }
    // Last, so the disk read only happens for rows every index filter already passed.
    return !q || text(r).toLowerCase().includes(q)
  }
}

export const summary = (ix: WalIndex, seq: number): Row => {
  const { cat, t, event, tool, dur, mcp, err, virtual } = nth(ix.entries, seq)
  const s: Row = { sess: ix.id, seq, cat, t, event, tool, dur }
  if (mcp) s.mcp = mcp
  if (err) s.err = true
  if (virtual) s.virtual = virtual
  return s
}

/** Total order of rows across sessions: by time, then session id, then seq. */
export const cmp = (at: number, as: string, aq: number, bt: number, bs: string, bq: number): number => at - bt || (as < bs ? -1 : as > bs ? 1 : 0) || aq - bq

/** `<sess>:<n>,…` — how far each index has been read; `/events` head, stream frame ids. */
export const vector = (ixs: WalIndex[], at: (ix: WalIndex) => number = (ix) => ix.entries.length): string => ixs.map((ix) => `${ix.id}:${at(ix)}`).join(',')

export const parseVector = (s: string | null | undefined): Map<string, number> | null => {
  if (s == null) return null
  const out = new Map<string, number>()
  for (const part of s.split(',')) {
    const m = /^([0-9a-f-]{36}):(\d+)$/.exec(part)
    const id = m?.[1]
    if (id === undefined) return null
    out.set(id, Number(m?.[2]))
  }
  return out
}

const CURSOR = /^(-?\d+)\.([0-9a-f-]{36})\.(\d+)$/

export const query = (ixs: WalIndex[], p: URLSearchParams, unknown: string[] = []): Page | FirstPage => {
  const hit = matcher(p)
  const n = Math.floor(Number(p.get('limit')))
  const limit = n > 0 ? n : 200
  const c = CURSOR.exec(p.get('before') ?? '')
  const sess = c?.[2]
  const before = sess === undefined ? null : { t: Number(c?.[1]), sess, seq: Number(c?.[3]) }
  const readers = ixs.map((ix) => ix.reader())
  try {
    // Per index, the next position in `order` to visit, walking down; -1 when exhausted.
    const at = ixs.map((ix) => {
      const { order, entries } = ix
      if (!before) return order.length - 1
      let lo = 0
      let hi = order.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        const seq = nth(order, mid)
        if (cmp(nth(entries, seq).t, ix.id, seq, before.t, before.sess, before.seq) < 0) lo = mid + 1
        else hi = mid
      }
      return lo - 1
    })
    const rows: Row[] = []
    let more = false
    let total = 0
    const counts: FirstPage['counts'] = {}
    const spans: FirstPage['spans'] = {}
    for (;;) {
      let best = -1
      for (let i = 0; i < ixs.length; i++) {
        const ai = nth(at, i)
        if (ai < 0) continue
        if (best === -1) {
          best = i
          continue
        }
        const a = nth(ixs, i)
        const b = nth(ixs, best)
        const sa = nth(a.order, ai)
        const sb = nth(b.order, nth(at, best))
        if (cmp(nth(a.entries, sa).t, a.id, sa, nth(b.entries, sb).t, b.id, sb) > 0) best = i
      }
      if (best === -1) break
      const ix = nth(ixs, best)
      const pos = nth(at, best)
      at[best] = pos - 1
      const seq = nth(ix.order, pos)
      const e = nth(ix.entries, seq)
      if (!hit(e, ix, nth(readers, best).text)) continue
      if (rows.length >= limit) {
        more = true
        if (before) break
      } else rows.push(summary(ix, seq))
      if (!before) {
        total++
        counts[e.cat] = (counts[e.cat] || 0) + 1
        // Each index is walked newest first, so its first hit is the last matching row.
        const b = spans[ix.id]
        if (b) b[0] = e.t
        else spans[ix.id] = [e.t, e.t]
      }
    }
    const last = rows[rows.length - 1]
    const page: Page = {
      gens: Object.fromEntries(ixs.map((ix) => [ix.id, ix.gen])),
      head: vector(ixs),
      rows,
      next: more && last ? `${last.t}.${last.sess}.${last.seq}` : null,
      unknown,
    }
    if (before) return page
    const tools = new Set<string>()
    for (const ix of ixs) for (const tl of ix.tools) tools.add(tl)
    const events = new Set<string>()
    for (const ix of ixs) for (const ev of ix.events) events.add(ev)
    const live = ixs.filter((ix) => ix.entries.length > 0)
    const agents = live.map((ix) => ({ sess: ix.id, main: agentTree(ix) }))
    return {
      ...page,
      total,
      counts,
      spans,
      tools: [...tools],
      events: [...events],
      cats: CATEGORIES.filter((c) => ixs.some((ix) => ix.cats.has(c))),
      agents,
      sessions: live.map((ix) => ix.id),
    }
  } finally {
    for (const r of readers) r.close()
  }
}
