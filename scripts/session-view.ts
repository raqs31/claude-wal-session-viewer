// session-view.ts — builds a session's Sessions stats from the transcript records of its target (`use`,
// `turn`, `compact`, `agent`, `tools`, `cost`), with the rules of the store's parser-based view.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentInfo, AgentStat, Compact, RecordedCost, Scope, SessionView, StatRow, UsageTotals } from '../shared/api.ts'
import type { TargetRecord } from './target.ts'
import { aggregate, type Pricing, type UsageRecord } from './transcripts.ts'

const MAIN = 'main'

const pricing = JSON.parse(readFileSync(join(import.meta.dirname, 'pricing.json'), 'utf8')) as Pricing

export interface SessionData {
  // Agent → reply id → record. A Map keeps a key where it first appeared when its value is replaced, so each
  // agent's records stay in transcript order with the last value of each reply.
  use: Map<string, Map<string, UsageRecord>>
  turnStarts: number[]
  compacts: Map<string, Compact[]>
  agents: Map<string, AgentInfo>
  tools: Map<string, number>
  cost: { usd: number; byModel: Record<string, number> } | null
}

export const createSessionData = (): SessionData => ({ use: new Map(), turnStarts: [], compacts: new Map(), agents: new Map(), tools: new Map(), cost: null })

/** Folds target records into the data; the row, checkpoint and stale records are not stats and are skipped. */
export const absorb = (d: SessionData, records: Iterable<TargetRecord>): void => {
  for (const r of records) {
    if (r.k === 'use') {
      const { k: _, ...u } = r
      let m = d.use.get(u.agent)
      if (!m) {
        m = new Map()
        d.use.set(u.agent, m)
      }
      m.set(u.id, u)
    } else if (r.k === 'turn') d.turnStarts.push(r.t)
    else if (r.k === 'compact') {
      const list = d.compacts.get(r.agent) ?? []
      list.push({ t: r.t, trigger: r.trigger, pre: r.pre, post: r.post })
      d.compacts.set(r.agent, list)
    } else if (r.k === 'agent') d.agents.set(r.id, { id: r.id, type: r.type, description: r.description, model: r.model, prompt: r.prompt, parent: r.parent })
    else if (r.k === 'tools') d.tools.set(r.agent, r.n)
    else if (r.k === 'cost') d.cost = r.usd === null ? null : { usd: r.usd, byModel: r.byModel }
  }
}

const usageOf = (d: SessionData, agent: string): UsageRecord[] => [...(d.use.get(agent)?.values() ?? [])]

/** Main first, then the agents in the order their `agent` records first appeared, as the store's file order. */
const records = (d: SessionData): UsageRecord[] => {
  const order = [MAIN, ...d.agents.keys()]
  const rest = [...d.use.keys()].filter((a) => !order.includes(a))
  return [...order, ...rest].flatMap((a) => usageOf(d, a))
}

// Keys carry context-window suffixes (`claude-opus-5-5[1m]`) that transcripts and pricing lack.
const recorded = (d: SessionData): RecordedCost => {
  if (d.cost === null) return null
  const models: Record<string, number> = {}
  for (const [key, c] of Object.entries(d.cost.byModel)) {
    const m = key.replace(/\[.*\]$/, '')
    models[m] = (models[m] ?? 0) + c
  }
  return { total: d.cost.usd, models }
}

const agentStat = (d: SessionData, agent: string): AgentStat => {
  const usage = usageOf(d, agent)
  let lo = Infinity
  let hi = -Infinity
  for (const r of usage) {
    lo = Math.min(lo, r.t)
    hi = Math.max(hi, r.t)
  }
  // Last in file order: timestamps run backwards within a file.
  const u = usage.at(-1)
  return {
    // The observer writes no `tools` record while the count is 0.
    tools: d.tools.get(agent) ?? 0,
    duration: usage.length > 1 ? hi - lo : 0,
    context: u ? u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h : 0,
    compacts: d.compacts.get(agent) ?? [],
  }
}

/** `id`, `gen` and `version` are the store's, not the target's. Null when an agent scope names no agent. */
export const view = (d: SessionData, head: Pick<SessionView, 'id' | 'gen' | 'version'>, scope: Scope): Omit<SessionView, 'pipe'> | null => {
  const agent = scope.startsWith('agent:') ? scope.slice(6) : null
  if (agent !== null && !d.agents.has(agent)) return null
  const inScope = [MAIN, ...d.agents.keys()].filter((id) => scope === 'all' || (scope === 'main' ? id === MAIN : id === agent))
  return {
    ...head,
    scope,
    ...aggregate(records(d), scope, pricing, d.turnStarts, d.compacts.get(agent ?? MAIN) ?? []),
    agents: [...d.agents.values()],
    agentStats: Object.fromEntries(inScope.map((id) => [id, agentStat(d, id)])),
    recordedCostUsd: scope === 'all' ? recorded(d) : null,
  }
}

export const usage = (ds: SessionData[], unknown: string[]): Omit<UsageTotals, 'pipe'> => {
  const totals: StatRow = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, thinking: 0, requests: 0, cost: 0 }
  let rec: number | null = null
  let missing = 0
  for (const d of ds) {
    const t = aggregate(records(d), 'all', pricing, d.turnStarts).stats.totals
    for (const k of ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h', 'thinking', 'requests'] as const) totals[k] += t[k]
    totals.cost = totals.cost === null || t.cost === null ? null : totals.cost + t.cost
    if (d.cost === null) missing++
    else rec = (rec ?? 0) + d.cost.usd
  }
  return { totals, recorded: rec, missing, unknown }
}
