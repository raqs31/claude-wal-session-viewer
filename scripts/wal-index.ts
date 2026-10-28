// wal-index.ts — per-session indexes over the observer's target file, kept in a small LRU, and the
// newest-first merge that /events and /events-stream run over a pick of them.

import { closeSync, openSync, readSync } from 'node:fs'
import { type AgentNode, CATEGORIES, type Category, catOf, type FirstPage, type McpRole, type Page, type Pipe, type Row } from '../shared/api.ts'
import type { Targets } from './observer.ts'
import { validId } from './sessions.ts'
import { createTargetReader } from './target.ts'

// A Pre or Post whose call row never lands (killed session, crashed server) would otherwise be held forever.
const PENDING_MAX = 10_000
// A reader's window: an 8 MB one per picked index per miss kept RSS near the budget, while 1 MB
// still holds hundreds of rows per disk read.
const WINDOW = 1024 * 1024
const OPEN_MAX = 8

// The parts of a WAL line's payload the tree state reads. The line is untyped JSON, so every step is optional.
interface Payload {
  tool_response?: { agentId?: unknown }
  background_tasks?: unknown
}

// Indexes in bounds by construction, which noUncheckedIndexedAccess cannot see.
const nth = <T>(a: readonly T[], i: number): T => {
  const v = a[i]
  if (v === undefined) throw new RangeError(`index ${i} out of bounds`)
  return v
}

// What `q` searches: the source part of a target line, which serialize puts last. Quotes inside string
// values are escaped, so a key's text never matches in the middle of one.
const sourceOf = (line: string): string => {
  const keys = line.startsWith('{"k":"call"') ? ['"input":', '"response":'] : ['"rec":', '"raw":']
  for (const key of keys) {
    const at = line.indexOf(key)
    if (at !== -1) return line.slice(at)
  }
  return ''
}

// Seeded per process so a page reconnecting to a restarted server always sees a new gen, even
// if the file was truncated while the server was down.
let genSeed = Date.now()

export interface IndexEntry {
  // The byte span of the entry's line in the target.
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
  // The WAL's `agent_id`; null is the session's main agent.
  agent: string | null
  agentType: string | null
  mcp: McpRole | null
  err: boolean
  // On a call row: the seqs of the Pre and Post entries it stands for.
  virtual: { pre: number; post: number } | null
  // Output tokens of the reply behind a call or Stop row, and the context its result added; set by a `tok` entry.
  // On a `tok` entry: the numbers its row had before this entry, so a stream can tell a row it already sent.
  out: number | null
  res: number | null
  // Fresh input tokens of the same reply, set by a `tok` entry; null on an old `tok` record that has none.
  inp: number | null
  // A `tok` entry: it has a seq but is no row, so it sits in `entries` only, never in `order`, the sets or a result.
  hidden: boolean
  // On a `tok` entry: the seq of the row it patched; null when that row is not indexed, and on every row.
  target: number | null
}

export interface WalIndex {
  id: string
  // The target file.
  path: string
  gen: number
  entries: IndexEntry[]
  // Seqs sorted by `t` (ties keep seq order): a call row's `t` is its Pre's, earlier than the rows before it.
  order: number[]
  tools: Set<string>
  // Event names in first-seen order, including 'MCP call' and 'Tool call'.
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
  const source = createTargetReader(path)
  // tool_use_id → seqs of its Pre and Post entries, until the call row that pairs them arrives.
  let pending = new Map<string, { pre?: number; post?: number }>()
  // Where a `tok` record lands: a call row by its tool_use_id, a Stop row by its WAL offset.
  let callSeq = new Map<string, number>()
  let stopSeq = new Map<number, number>()

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
    if (e.hidden) return
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

  const noteAgent = (agent: string | null, agentType: string | null, tool: string | null): void => {
    if (tool !== null) ix.tools.add(tool)
    const known = ix.agents.get(agent ?? 'main')
    if (known === undefined || (known === null && agentType !== null)) {
      ix.agents.set(agent ?? 'main', agentType)
      ix.links++
    }
  }

  const notePending = (tuid: string, event: string | null, seq: number): void => {
    const role = event === 'PreToolUse' ? 'pre' : event === 'PostToolUse' || event === 'PostToolUseFailure' ? 'post' : null
    if (role === null) return
    const held = pending.get(tuid)
    if (held) held[role] = seq
    else {
      pending.set(tuid, { [role]: seq })
      if (pending.size > PENDING_MAX) {
        const oldest = pending.keys().next().value
        if (oldest !== undefined) pending.delete(oldest)
      }
    }
  }

  // `w` is the WAL line an ev entry was built from: absent on a raw line, a transcript line on a session without a WAL.
  const noteTree = (event: string | null, tool: string | null, agent: string | null, w: unknown): void => {
    const payload = (w !== null && typeof w === 'object' ? (w as { payload?: Payload | null }).payload : undefined) ?? undefined
    if (tool === 'Agent' && event === 'PostToolUse') {
      const child = payload?.tool_response?.agentId
      if (typeof child === 'string' && child && child !== agent && ix.parents.get(child) !== agent) {
        ix.parents.set(child, agent)
        ix.links++
      }
    }
    const tasks = payload?.background_tasks
    if (event === 'SubagentStop' && agent !== null && Array.isArray(tasks)) {
      // With two background agents running the summary could be about either, so it stays unattributed.
      const subs = tasks.filter((b) => b?.type === 'subagent' && typeof b.id === 'string' && b.id)
      if (subs.length === 1) ix.about.set(agent, subs[0].id)
    }
  }

  const stamp = (t: number): Pick<IndexEntry, 'day' | 'minute'> => {
    const d = new Date(t)
    return { day: d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(), minute: d.getHours() * 60 + d.getMinutes() }
  }

  // A missing target is an empty index until it appears.
  function tail(): void {
    const { items, reset } = source.read()
    // A deleted or replaced target voids every seq: streams must get a new `gen`.
    if (reset) {
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
      callSeq = new Map()
      stopSeq = new Map()
      ix.gen = ++genSeed
    }
    for (const { rec, off, len } of items) {
      if (rec.k === 'ev') {
        const event = rec.event ?? undefined
        noteAgent(rec.agent, rec.agentType, rec.tool)
        noteTree(rec.event, rec.tool, rec.agent, rec.rec)
        // Every entry carries every key, so the index stays one hidden class.
        push({
          off,
          len,
          t: rec.t,
          ...stamp(rec.t),
          event,
          cat: catOf(event),
          tool: rec.tool,
          dur: rec.dur,
          tuid: rec.tuid,
          agent: rec.agent,
          agentType: rec.agentType,
          mcp: rec.mcp,
          err: rec.err,
          virtual: null,
          out: rec.out ?? null,
          res: null,
          inp: rec.inp ?? null,
          hidden: false,
          target: null,
        })
        const seq = ix.entries.length - 1
        if (rec.tuid !== null) notePending(rec.tuid, rec.event, seq)
        if (rec.woff !== null && (rec.event === 'Stop' || rec.event === 'SubagentStop')) stopSeq.set(rec.woff, seq)
      } else if (rec.k === 'call') {
        noteAgent(rec.agent, rec.agentType, rec.tool)
        const held = pending.get(rec.tuid)
        pending.delete(rec.tuid)
        push({
          off,
          len,
          t: rec.t,
          ...stamp(rec.t),
          event: rec.mcp ? 'MCP call' : 'Tool call',
          cat: rec.err ? 'fail' : rec.mcp ? 'mcp' : 'tool',
          tool: rec.tool,
          dur: rec.dur,
          tuid: rec.tuid,
          agent: rec.agent,
          agentType: rec.agentType,
          mcp: null,
          err: rec.err,
          virtual: held?.pre !== undefined && held.post !== undefined ? { pre: held.pre, post: held.post } : null,
          out: null,
          res: null,
          inp: null,
          hidden: false,
          target: null,
        })
        callSeq.set(rec.tuid, ix.entries.length - 1)
      } else if (rec.k === 'tok') {
        const at = ('tuid' in rec ? callSeq.get(rec.tuid) : stopSeq.get(rec.woff)) ?? null
        const target = at === null ? undefined : ix.entries[at]
        const before = { out: target?.out ?? null, res: target?.res ?? null, inp: target?.inp ?? null }
        if (target) {
          target.out = rec.out
          target.res = 'res' in rec ? (rec.res ?? null) : null
          target.inp = rec.inp ?? null
        }
        push({
          off,
          len,
          t: 0,
          day: 0,
          minute: 0,
          event: undefined,
          cat: 'session',
          tool: null,
          dur: null,
          tuid: null,
          agent: null,
          agentType: null,
          mcp: null,
          err: false,
          virtual: null,
          out: before.out,
          res: before.res,
          inp: before.inp,
          hidden: true,
          target: target ? at : null,
        })
      }
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
        return sourceOf(buf.toString('utf8', r.off - start, r.off - start + r.len))
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
 * Indexes by target path, created lazily. Beyond OPEN_MAX the least recently used go, except those
 * a stream holds (`busy`) or the current request asked for.
 */
export const createIndexes = (targets: Pick<Targets, 'target'>, busy: (id: string) => boolean) => {
  const open = new Map<string, WalIndex>()

  /** null: an invalid id. Ids with no target are skipped into `unknown`. Tails every index it returns. */
  const acquire = (ids: string[]): { ixs: WalIndex[]; unknown: string[] } | null => {
    if (!ids.every(validId)) return null
    const ixs: WalIndex[] = []
    const unknown: string[] = []
    for (const id of ids) {
      const path = targets.target(id)
      if (path === null) {
        unknown.push(id)
        continue
      }
      let ix = open.get(path)
      if (!ix) ix = createWalIndex(id, path)
      else ix.tail()
      open.delete(path)
      open.set(path, ix)
      ixs.push(ix)
    }
    for (const [k, ix] of open) if (open.size > OPEN_MAX && !ids.includes(ix.id) && !busy(ix.id)) open.delete(k)
    return { ixs, unknown }
  }

  /** Unlike the LRU, also drops an index a stream holds: its next acquire builds a fresh one. */
  const drop = (id: string): void => {
    for (const [k, ix] of open) if (ix.id === id) open.delete(k)
  }

  return { acquire, drop }
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
/** A row's Total, output plus result; null until a `tok` lands on it. */
const tokensOf = (r: IndexEntry): number | null => (r.out === null ? null : r.out + (r.res ?? 0))

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
  const minTok = num(p.get('min_tok'))
  const maxTok = num(p.get('max_tok'))
  const notok = p.get('notok') === 'include'
  const q = (p.get('q') || '').toLowerCase()
  return (r, ix, text) => {
    if (r.hidden) return false
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
    if (minTok !== null || maxTok !== null) {
      const tok = tokensOf(r)
      if (tok === null ? !notok : (minTok !== null && tok < minTok) || (maxTok !== null && tok > maxTok)) return false
    }
    // Last, so the disk read only happens for rows every index filter already passed.
    return !q || text(r).toLowerCase().includes(q)
  }
}

export const summary = (ix: WalIndex, seq: number): Row => {
  const { cat, t, event, tool, dur, mcp, err, virtual, out, res, inp } = nth(ix.entries, seq)
  const s: Row = { sess: ix.id, seq, cat, t, event, tool, dur }
  if (out !== null) s.out = out
  if (res !== null) s.res = res
  if (inp !== null) s.inp = inp
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
// The value as `${number}` writes it, a fraction, exponent or Infinity included (JSON reads 1e400 as Infinity), so any
// key value round-trips.
const KEY_CURSOR = /^(-?(?:Infinity|\d+(?:\.\d+)?(?:e[+-]\d+)?)|n)\.(-?\d+)\.([0-9a-f-]{36})\.(\d+)$/

interface Scan {
  rows: Row[]
  next: string | null
  // Null on a page after the first.
  first: Pick<FirstPage, 'total' | 'counts' | 'spans'> | null
}

const pageOf = (ixs: WalIndex[], s: Scan, unknown: string[], pipe: Record<string, Pipe>): Page | FirstPage => {
  const page: Page = {
    gens: Object.fromEntries(ixs.map((ix) => [ix.id, ix.gen])),
    head: vector(ixs),
    rows: s.rows,
    next: s.next,
    unknown,
  }
  if (!s.first) return page
  const tools = new Set<string>()
  for (const ix of ixs) for (const tl of ix.tools) tools.add(tl)
  const events = new Set<string>()
  for (const ix of ixs) for (const ev of ix.events) events.add(ev)
  const live = ixs.filter((ix) => ix.entries.length > 0)
  const agents = live.map((ix) => ({ sess: ix.id, main: agentTree(ix) }))
  return {
    ...page,
    ...s.first,
    tools: [...tools],
    events: [...events],
    cats: CATEGORIES.filter((c) => ixs.some((ix) => ix.cats.has(c))),
    agents,
    sessions: live.map((ix) => ix.id),
    recorded: Object.fromEntries(ixs.map((ix) => [ix.id, ix.order.length])),
    pipe,
  }
}

/** The value a row sorts by under `sort=<key>`, null when it has none. A plain field read: each page scans every row. */
type KeyOf = (e: IndexEntry) => number | null
// A Map, so a `sort` such as `constructor` finds no key.
const KEYS = new Map<string, KeyOf>([
  ['inp', (e) => e.inp],
  ['out', (e) => e.out],
  ['res', (e) => e.res],
  ['tot', tokensOf],
  ['all', (e) => (e.out === null ? null : (e.inp ?? 0) + e.out + (e.res ?? 0))],
  ['dur', (e) => e.dur],
])

interface SortKey {
  v: number | null
  t: number
  sess: string
  seq: number
}
/**
 * Positive when `a` comes first: by value in `dir` (1 desc, -1 asc), a row with no value after every row with one,
 * then the time order's tie-breaks, newest first in both directions.
 */
const ahead = (a: SortKey, b: SortKey, dir: number): number =>
  (a.v === null ? (b.v === null ? 0 : -1) : b.v === null ? 1 : dir * (a.v - b.v)) || cmp(a.t, a.sess, a.seq, b.t, b.sess, b.seq)

/** `sort=<key>&dir=<asc|desc>`: one scan of the pick keeps the top rows past the cursor. */
const byKey = (ixs: WalIndex[], readers: Reader[], p: URLSearchParams, hit: Matcher, limit: number, keyOf: KeyOf, dir: number): Scan => {
  const c = KEY_CURSOR.exec(p.get('before') ?? '')
  const sess = c?.[3]
  const before: SortKey | null = sess === undefined ? null : { v: c?.[1] === 'n' ? null : Number(c?.[1]), t: Number(c?.[2]), sess, seq: Number(c?.[4]) }
  // A later page has no totals to count, so `q` (a disk read per row) runs only in order until the page fills.
  const lazy = before !== null && !!p.get('q')
  let pass = hit
  if (lazy) {
    const rest = new URLSearchParams(p)
    rest.delete('q')
    pass = matcher(rest)
  }
  const keep = limit + 1
  // First in order first: the top `keep` rows past the cursor, or with `lazy` all of them.
  const top: (SortKey & { i: number })[] = []
  const first: Scan['first'] = before ? null : { total: 0, counts: {}, spans: {} }
  for (let i = 0; i < ixs.length; i++) {
    const ix = nth(ixs, i)
    const text = nth(readers, i).text
    for (let pos = ix.order.length - 1; pos >= 0; pos--) {
      const seq = nth(ix.order, pos)
      const e = nth(ix.entries, seq)
      if (!pass(e, ix, text)) continue
      const k = { v: keyOf(e), t: e.t, sess: ix.id, seq, i }
      if (before && ahead(k, before, dir) >= 0) continue
      if (first) {
        first.total++
        first.counts[e.cat] = (first.counts[e.cat] || 0) + 1
        // Each index is walked newest first, so its first hit is the last matching row.
        const b = first.spans[ix.id]
        if (b) b[0] = e.t
        else first.spans[ix.id] = [e.t, e.t]
      }
      if (lazy) top.push(k)
      else if (top.length < keep || ahead(k, nth(top, keep - 1), dir) > 0) {
        let lo = 0
        let hi = top.length
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (ahead(nth(top, mid), k, dir) > 0) lo = mid + 1
          else hi = mid
        }
        top.splice(lo, 0, k)
        if (top.length > keep) top.pop()
      }
    }
  }
  let picked = top
  if (lazy) {
    top.sort((a, b) => ahead(b, a, dir))
    picked = []
    for (const k of top) {
      const ix = nth(ixs, k.i)
      if (hit(nth(ix.entries, k.seq), ix, nth(readers, k.i).text) && picked.push(k) === keep) break
    }
  }
  const rows = picked.slice(0, limit)
  const last = rows.at(-1)
  return {
    rows: rows.map((k) => summary(nth(ixs, k.i), k.seq)),
    next: picked.length > limit && last ? `${last.v ?? 'n'}.${last.t}.${last.sess}.${last.seq}` : null,
    first,
  }
}

export const query = (ixs: WalIndex[], p: URLSearchParams, unknown: string[], pipe: Record<string, Pipe>): Page | FirstPage => {
  const hit = matcher(p)
  const n = Math.floor(Number(p.get('limit')))
  const limit = n > 0 ? n : 200
  const c = CURSOR.exec(p.get('before') ?? '')
  const sess = c?.[2]
  const before = sess === undefined ? null : { t: Number(c?.[1]), sess, seq: Number(c?.[3]) }
  const readers = ixs.map((ix) => ix.reader())
  try {
    const keyOf = KEYS.get(p.get('sort') ?? '')
    const d = p.get('dir') ?? 'desc'
    const dir = d === 'desc' ? 1 : d === 'asc' ? -1 : 0
    if (keyOf && dir) return pageOf(ixs, byKey(ixs, readers, p, hit, limit, keyOf, dir), unknown, pipe)
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
    const next = more && last ? `${last.t}.${last.sess}.${last.seq}` : null
    return pageOf(ixs, { rows, next, first: before ? null : { total, counts, spans } }, unknown, pipe)
  } finally {
    for (const r of readers) r.close()
  }
}
