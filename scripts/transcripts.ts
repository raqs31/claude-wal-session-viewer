// transcripts.ts — turns Claude Code transcript lines into timeline items and usage records, and
// aggregates records into stats and chart series. No fs: the caller feeds bytes and reads bodies
// back through each item's absolute byte span.
//
// Items keep file order, not timestamp order: over this repo's 36 main transcripts (30/09/2026)
// every parentUuid (logicalParentUuid across a compaction) points to an earlier line, while
// timestamps drop 177 times between consecutive entries, mostly prompt → attachment and
// attachment → reply.

import type { AdditiveKey, Scope, SessionSeries, SessionStats, StatRow, Usage } from '../shared/api.ts'

// biome-ignore lint/suspicious/noExplicitAny: deliberate, transcripts are schemaless JSON.
type E = Record<string, any>

export type Span = [off: number, len: number]
export type ItemKind = 'prompt' | 'notification' | 'command' | 'meta' | 'text' | 'thinking' | 'tool' | 'agent' | 'compact' | 'error'
export interface TimelineItem {
  uid: string
  kind: ItemKind
  t: number
  agent: string
  turn: number
  summary: string
  model?: string
  usage?: Usage
  tool?: string
  isError?: true
  agentId?: string
  agentType?: string
  description?: string
  compact?: { pre: number; post: number; trigger: string }
}
export interface ParsedItem extends TimelineItem {
  src: Span
  resultSrc?: Span
}
// Mutated in place when a later entry of the same reply arrives, so aggregates must be recomputed
// from the records, never summed incrementally.
export interface UsageRecord extends Usage {
  id: string
  t: number
  agent: string
  model: string
  turn: number
}
interface TranscriptMeta {
  title: string | null
  first: number | null
  firstPrompt: string | null
  cwd: string | null
  // `tool_use`, `server_tool_use` and Agent calls.
  toolCalls: number
  costUsd: number | null
  costByModel: Record<string, number>
}
interface Price {
  input: number
  output: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
}
export interface Pricing {
  models: Record<string, Price>
}

const MAX = 200
const TAG_RE = /<\/?(?:command-name|command-message|command-args|local-command-caveat|local-command-stdout|task-notification)>/g
const WRAP_RE = /^<(?:command-|local-command-)/

const clip = (s: unknown): string => {
  const one = String(s ?? '')
    .slice(0, 10 * MAX)
    .replace(TAG_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (one.length <= MAX) return one
  const cut = one.slice(0, MAX - 1)
  return `${/[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut}…`
}
// A slash command reads as `/name args`, not as its clipped wrapper with the command message.
const titleOf = (c: string): string => {
  if (!c.startsWith('<command-')) return clip(c)
  const tag = (t: string): string => new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(c)?.[1] ?? ''
  return clip(`${tag('command-name')} ${tag('command-args')}`)
}
const firstString = (v: unknown): string => (v && typeof v === 'object' ? String(Object.values(v).find((x) => typeof x === 'string') ?? '') : '')

const usageOf = (u: E): Usage => ({
  input: u.input_tokens ?? 0,
  output: u.output_tokens ?? 0,
  cacheRead: u.cache_read_input_tokens ?? 0,
  cacheWrite5m: u.cache_creation?.ephemeral_5m_input_tokens ?? 0,
  cacheWrite1h: u.cache_creation?.ephemeral_1h_input_tokens ?? 0,
  thinking: u.output_tokens_details?.thinking_tokens ?? 0,
})

const userKind = (e: E, c: string): ItemKind => {
  if (e.origin?.kind === 'task-notification' || c.startsWith('<task-notification>')) return 'notification'
  // A subagent file opens with a plain-string task that the human-prompt rule would count as a turn.
  if (e.isSidechain || e.isMeta || e.isCompactSummary) return 'meta'
  if (e.origin?.kind === 'human') return 'prompt'
  if (WRAP_RE.test(c)) return 'command'
  return e.origin ? 'meta' : 'prompt'
}

/**
 * `agent` is 'main' or a subagent id. A subagent never starts a turn, so its items and records all
 * carry `turn`: the turn of its spawning Agent call (`main.tools.get(meta.toolUseId)?.turn`).
 * `keepItems: false` keeps only tool calls (for results and spawn turns), so stats over a long
 * session do not hold its whole timeline in memory.
 */
export const createParser = (agent: string, turn = 0, keepItems = true) => {
  const items: ParsedItem[] = []
  const usage: UsageRecord[] = []
  const turnStarts: number[] = []
  const meta: TranscriptMeta = { title: null, first: null, firstPrompt: null, cwd: null, toolCalls: 0, costUsd: null, costByModel: {} }
  const tools = new Map<string, ParsedItem>()
  // Items mutated after they were added: a reader that already streamed them must resend them.
  const touched = new Set<ParsedItem>()
  const replies = new Map<string, { rec: UsageRecord | null; item: ParsedItem | null }>()
  let pending: Buffer = Buffer.alloc(0)
  let offset = 0
  // A typed command without `origin` (/goal) and a local-only one (/clear, /mcp) look alike when
  // they arrive; only the model replying tells them apart. A local one ends in a system
  // local_command entry, so that cancels the candidate before an unrelated reply can claim it
  // (a /loop wakeup after /clear, 30/09/2026).
  let command: { t: number; from: number; title: string } | null = null

  const startTurn = (t: number, title: string, from = items.length): void => {
    turn++
    turnStarts.push(t)
    meta.firstPrompt ??= title
    for (let i = from; i < items.length; i++) {
      const it = items[i]
      if (it === undefined) continue
      it.turn = turn
      touched.add(it)
    }
    command = null
  }

  const add = (e: E, t: number, src: Span, kind: ItemKind, summary: unknown, extra: Partial<TimelineItem> = {}, i = 0): ParsedItem => {
    const it: ParsedItem = { uid: i ? `${e.uuid}:${i}` : e.uuid, kind, t, agent, turn, summary: clip(summary), ...extra, src }
    if (kind === 'tool' || kind === 'agent') meta.toolCalls++
    if (keepItems) items.push(it)
    return it
  }

  const result = (b: E, e: E, src: Span): void => {
    const it = tools.get(b.tool_use_id)
    if (!it) return
    it.resultSrc = src
    if (b.is_error === true) it.isError = true
    if (it.kind === 'agent' && e.toolUseResult?.agentId) it.agentId = e.toolUseResult.agentId
    touched.add(it)
  }

  const assistant = (e: E, t: number, src: Span): void => {
    const m: E = e.message ?? {}
    const blocks: E[] = Array.isArray(m.content) ? m.content : []
    if (command) startTurn(command.t, command.title, command.from)
    if (m.model === '<synthetic>') {
      add(e, t, src, 'error', blocks.find((b) => b.type === 'text')?.text ?? e.error)
      return
    }
    // Every entry of a reply repeats its usage, but in subagent files the early entries are
    // streaming snapshots (15 140 of 24 627 groups on 30/09/2026); the last entry is final.
    const u = m.usage ? usageOf(m.usage) : null
    const key = m.id ?? e.uuid
    let reply = replies.get(key)
    if (!reply) {
      reply = { rec: null, item: null }
      replies.set(key, reply)
    }
    if (u && reply.rec) Object.assign(reply.rec, u)
    else if (u) {
      reply.rec = { id: key, t, agent, model: m.model, turn, ...u }
      usage.push(reply.rec)
    }
    blocks.forEach((b, i) => {
      let it: ParsedItem | null = null
      if (b.type === 'text') it = add(e, t, src, 'text', b.text, {}, i)
      else if (b.type === 'thinking') it = add(e, t, src, 'thinking', b.thinking, {}, i)
      else if (b.type === 'tool_use' && b.name === 'Agent') {
        const { subagent_type: agentType, description } = b.input ?? {}
        it = add(e, t, src, 'agent', agentType ? `${agentType}: ${description}` : description, { tool: b.name, agentType, description }, i)
        tools.set(b.id, it)
      } else if (b.type === 'tool_use' || b.type === 'server_tool_use') {
        it = add(e, t, src, 'tool', `${b.name} ${firstString(b.input)}`, { tool: b.name }, i)
        tools.set(b.id, it)
      } else if (b.tool_use_id) result(b, e, src)
      if (it && !reply.item) {
        reply.item = it
        it.model = m.model
      }
    })
    if (u && reply.item) {
      reply.item.usage = u
      touched.add(reply.item)
    }
  }

  const user = (e: E, t: number, src: Span): void => {
    const c = e.message?.content
    if (typeof c === 'string') {
      const kind = userKind(e, c)
      if (kind === 'prompt') startTurn(t, titleOf(c))
      else if (kind === 'notification' || e.isCompactSummary) command = null
      else if (kind === 'command' && c.startsWith('<command-')) command = { t, from: items.length, title: titleOf(c) }
      add(e, t, src, kind, c)
    } else if (Array.isArray(c)) {
      for (const b of c) if (b.type === 'tool_result') result(b, e, src)
      const text = c
        .filter((b: E) => b.type === 'text')
        .map((b: E) => b.text)
        .join(' ')
      if (text) add(e, t, src, 'meta', text)
    }
  }

  const system = (e: E, t: number, src: Span): void => {
    if (e.subtype === 'compact_boundary') {
      const { trigger = '', preTokens: pre = 0, postTokens: post = 0 } = e.compactMetadata ?? {}
      add(e, t, src, 'compact', `${trigger} ${pre} → ${post}`, { compact: { pre, post, trigger } })
    } else if (e.subtype === 'local_command') {
      command = null
      add(e, t, src, 'command', e.content)
    }
  }

  const line = (text: string, src: Span): void => {
    let e: E
    try {
      e = JSON.parse(text)
    } catch {
      return
    }
    if (!e || typeof e !== 'object') return
    const t = Date.parse(e.timestamp)
    if (!Number.isNaN(t) && (meta.first === null || t < meta.first)) meta.first = t
    if (typeof e.cwd === 'string') meta.cwd ??= e.cwd
    if (e.type === 'ai-title') meta.title = e.aiTitle ?? meta.title
    else if (e.type === 'cost-state') {
      meta.costUsd = e.totalCostUSD ?? null
      meta.costByModel = Object.fromEntries(Object.entries(e.modelUsage ?? {}).map(([m, u]) => [m, (u as E).costUSD ?? 0]))
    } else if (!e.uuid) return
    else if (e.type === 'assistant') assistant(e, t, src)
    else if (e.type === 'user') user(e, t, src)
    else if (e.type === 'system') system(e, t, src)
  }

  return {
    items,
    usage,
    meta,
    turnStarts,
    tools,
    touched,
    /** Consumes complete lines only; decoding per whole line keeps a split multibyte char intact. */
    push(chunk: Buffer): void {
      const buf = pending.length ? Buffer.concat([pending, chunk]) : chunk
      let start = 0
      for (let nl = buf.indexOf(10); nl >= 0; nl = buf.indexOf(10, start)) {
        line(buf.toString('utf8', start, nl), [offset + start, nl - start])
        start = nl + 1
      }
      // A copy, so a pending tail does not pin the whole chunk in memory.
      pending = Buffer.from(buf.subarray(start))
      offset += start
    },
  }
}
export type Parser = ReturnType<typeof createParser>

const KEYS = ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h', 'thinking'] as const
const ADDITIVE: AdditiveKey[] = ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h']

const costOf = (u: Usage, p: Price | undefined): number | null =>
  p ? (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite5m * p.cacheWrite5m + u.cacheWrite1h * p.cacheWrite1h) / 1e6 : null

const inScope = (agent: string, scope: Scope): boolean => scope === 'all' || (scope === 'main' ? agent === 'main' : agent === scope.slice('agent:'.length))

const row = (): StatRow => ({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, thinking: 0, requests: 0, cost: 0 })
const rowOf = (rows: Record<string, StatRow>, key: string): StatRow => {
  let r = rows[key]
  if (!r) {
    r = row()
    rows[key] = r
  }
  return r
}
const addTo = (r: StatRow, u: UsageRecord, cost: number | null): void => {
  for (const k of KEYS) r[k] += u[k]
  r.requests++
  r.cost = r.cost === null || cost === null ? null : r.cost + cost
}
const columns = (n: number): Record<AdditiveKey, number[]> =>
  Object.fromEntries(ADDITIVE.map((k) => [k, Array<number>(n).fill(0)])) as Record<AdditiveKey, number[]>

/** `turnStarts` are the main parser's; turn `i + 1` starts at `turnStarts[i]`, turn 0 precedes the first prompt. */
export const aggregate = (records: UsageRecord[], scope: Scope, pricing: Pricing, turnStarts: number[]): { stats: SessionStats; series: SessionSeries } => {
  // Timestamps interleave across files and run backwards within one; uPlot needs ascending x.
  const rs = records.filter((r) => inScope(r.agent, scope)).sort((a, b) => a.t - b.t)
  const totals = row()
  const agents: Record<string, StatRow> = {}
  const models: Record<string, StatRow> = {}
  const t: number[] = []
  const cumulative = columns(0)
  const perTurn = columns(turnStarts.length + 1)
  const worked = new Set<number>()
  for (const r of rs) {
    const cost = costOf(r, pricing.models[r.model])
    addTo(totals, r, cost)
    addTo(rowOf(agents, r.agent), r, cost)
    addTo(rowOf(models, r.model), r, cost)
    t.push(r.t)
    for (const k of ADDITIVE) {
      cumulative[k].push((cumulative[k].at(-1) ?? 0) + r[k])
      perTurn[k][r.turn] = (perTurn[k][r.turn] ?? 0) + r[k]
    }
    worked.add(r.turn)
  }
  const first = rs[0]
  const last = rs.at(-1)
  return {
    stats: { totals, agents, models, turns: scope.startsWith('agent:') ? worked.size : turnStarts.length, duration: first && last ? last.t - first.t : 0 },
    series: { t, cumulative, perTurn, turnStarts },
  }
}
