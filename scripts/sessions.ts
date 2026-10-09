// sessions.ts — keeps the picked Claude Code sessions parsed for stats, following their
// transcripts as they grow. Ids come from the page, so no path is ever built from one unless it
// matched its pattern and discovery found its transcript.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentInfo, AgentStat, RecordedCost, Scope, SessionView, StatRow, UsageTotals } from '../shared/api.ts'
import { readAt, SESSION_RE, type Discovery } from './discovery.ts'
import { aggregate, createParser, type Parser, type Pricing, type UsageRecord } from './transcripts.ts'

const AGENT_RE = /^[A-Za-z0-9_-]+$/
const CHUNK = 8 * 1024 * 1024
// A full pick of 8, as the WAL indexes.
const OPEN_MAX = 8

const pricing = JSON.parse(readFileSync(join(import.meta.dirname, 'pricing.json'), 'utf8')) as Pricing

export const validId = (id: string | null): id is string => id !== null && SESSION_RE.test(id)

export const parseScope = (s: string | null): Scope | null =>
  s === 'all' || s === 'main' ? s : s?.startsWith('agent:') && AGENT_RE.test(s.slice(6)) ? (s as Scope) : null

interface Tracked {
  path: string
  parser: Parser
  read: number
}
interface Agent extends Tracked {
  info: AgentInfo
}
export interface Session {
  id: string
  gen: number
  // Unique across re-opens: bumped from one clock whenever bytes are consumed or an agent appears.
  version: number
  // The folder holding `<id>.jsonl`.
  dir: string
  main: Tracked
  agents: Map<string, Agent>
}

export const createStore = (discovery: Pick<Discovery, 'locate'>, busy: (id: string) => boolean) => {
  const open = new Map<string, Session>()
  // Seeded per process, as the WAL's, so a page reconnecting to a restarted server sees a new gen.
  let gen = Date.now()
  let clock = 0

  // null: the file shrank or vanished, so every offset into it is void.
  const grow = (f: Tracked): boolean | null => {
    const size = existsSync(f.path) ? statSync(f.path).size : -1
    if (size < f.read) return null
    const from = f.read
    while (f.read < size) {
      const buf = readAt(f.path, f.read, Math.min(CHUNK, size - f.read))
      if (!buf.length) break
      f.parser.push(buf)
      f.read += buf.length
    }
    // Nothing reads timeline updates any more; cleared so the set does not grow with the file.
    f.parser.touched.clear()
    return f.read > from
  }

  const discover = (s: Session): boolean => {
    const sub = join(s.dir, s.id, 'subagents')
    if (!existsSync(sub)) return false
    let added = false
    for (const name of readdirSync(sub)) {
      const id = /^agent-(.+)\.meta\.json$/.exec(name)?.[1]
      if (!id || !AGENT_RE.test(id) || s.agents.has(id) || !existsSync(join(sub, `agent-${id}.jsonl`))) continue
      let m: Record<string, any>
      try {
        m = JSON.parse(readFileSync(join(sub, name), 'utf8'))
      } catch {
        continue
      }
      // Nested agents are spawned from another subagent's transcript, not main's. A spawn not
      // flushed yet belongs to the turn in progress.
      const spawn = s.main.parser.tools.get(m.toolUseId) ?? [...s.agents.values()].map((a) => a.parser.tools.get(m.toolUseId)).find(Boolean)
      const a: Agent = {
        path: join(sub, `agent-${id}.jsonl`),
        parser: createParser(id, spawn?.turn ?? s.main.parser.turnStarts.length, false),
        read: 0,
        info: { id, type: m.agentType ?? '', description: m.description ?? '', model: m.model ?? '' },
      }
      s.agents.set(id, a)
      grow(a)
      added = true
    }
    return added
  }

  // false: the session must be re-parsed from scratch.
  const advance = (s: Session): boolean => {
    let changed = false
    for (const f of [s.main, ...s.agents.values()]) {
      const g = grow(f)
      if (g === null) return false
      if (g) changed = true
    }
    if (discover(s) || changed) s.version = ++clock
    return true
  }

  const load = (id: string): Session | null => {
    let s = open.get(id)
    if (s && !advance(s)) s = undefined
    if (!s) {
      const dir = discovery.locate(id)
      if (!dir) {
        open.delete(id)
        return null
      }
      s = {
        id,
        gen: ++gen,
        version: ++clock,
        dir,
        main: { path: join(dir, `${id}.jsonl`), parser: createParser('main', 0, false), read: 0 },
        agents: new Map(),
      }
      grow(s.main)
      discover(s)
    }
    open.delete(id)
    open.set(id, s)
    return s
  }

  /** Advances (or opens) each session; null if any id is malformed. Ids with no transcript are skipped into `unknown`. */
  const acquire = (ids: string[]): { sessions: Session[]; unknown: string[] } | null => {
    if (!ids.every(validId)) return null
    const sessions: Session[] = []
    const unknown: string[] = []
    for (const id of ids) {
      const s = load(id)
      if (s) sessions.push(s)
      else unknown.push(id)
    }
    for (const k of open.keys()) if (open.size > OPEN_MAX && !ids.includes(k) && !busy(k)) open.delete(k)
    return { sessions, unknown }
  }

  const get = (id: string): Session | null => acquire([id])?.sessions[0] ?? null

  const records = (s: Session): UsageRecord[] => [s.main.parser.usage, ...[...s.agents.values()].map((a) => a.parser.usage)].flat()

  // Keys carry context-window suffixes (`claude-opus-5-5[1m]`) that transcripts and pricing lack.
  const recorded = (s: Session): RecordedCost => {
    const { costUsd, costByModel } = s.main.parser.meta
    if (costUsd === null) return null
    const models: Record<string, number> = {}
    for (const [key, c] of Object.entries(costByModel)) {
      const m = key.replace(/\[.*\]$/, '')
      models[m] = (models[m] ?? 0) + c
    }
    return { total: costUsd, models }
  }

  const agentStat = (p: Parser): AgentStat => {
    let lo = Infinity
    let hi = -Infinity
    for (const r of p.usage) {
      lo = Math.min(lo, r.t)
      hi = Math.max(hi, r.t)
    }
    return { tools: p.meta.toolCalls, duration: p.usage.length > 1 ? hi - lo : 0 }
  }

  const has = (s: Session, scope: Scope): boolean => !scope.startsWith('agent:') || s.agents.has(scope.slice(6))

  const view = (s: Session, scope: Scope): SessionView | null => {
    if (!has(s, scope)) return null
    const parsers: [string, Parser][] = [['main', s.main.parser], ...[...s.agents].map(([id, a]): [string, Parser] => [id, a.parser])]
    const inScope = parsers.filter(([id]) => scope === 'all' || (scope === 'main' ? id === 'main' : `agent:${id}` === scope))
    return {
      id: s.id,
      gen: s.gen,
      version: s.version,
      scope,
      ...aggregate(records(s), scope, pricing, s.main.parser.turnStarts),
      agents: [...s.agents.values()].map((a) => a.info),
      agentStats: Object.fromEntries(inScope.map(([id, p]) => [id, agentStat(p)])),
      recordedCostUsd: scope === 'all' ? recorded(s) : null,
    }
  }

  const usage = (ss: Session[], unknown: string[]): UsageTotals => {
    const totals: StatRow = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, thinking: 0, requests: 0, cost: 0 }
    let rec: number | null = null
    let missing = 0
    for (const s of ss) {
      const t = aggregate(records(s), 'all', pricing, s.main.parser.turnStarts).stats.totals
      for (const k of ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h', 'thinking', 'requests'] as const) totals[k] += t[k]
      totals.cost = totals.cost === null || t.cost === null ? null : totals.cost + t.cost
      const r = s.main.parser.meta.costUsd
      if (r === null) missing++
      else rec = (rec ?? 0) + r
    }
    return { totals, recorded: rec, missing, unknown }
  }

  return { acquire, get, view, usage }
}
