import type { SessionView } from '../../../shared/api.ts'
import { fmtDuration, fmtTokens, fmtUsd } from './tokens.ts'

export interface Detail {
  k: string
  v: string
  title?: string
}

const n = (v: number) => v.toLocaleString('en-US')

// The expansion under a By-agent row. Turns are user prompts, which only the main agent has;
// a subagent's unit of work is the request, so it shows that instead.
// Main has no AgentInfo and the view no per-agent model split, so only a single-model session
// names main's model for certain.
const mainModel = (view: SessionView): string => {
  const [m, ...rest] = Object.keys(view.stats.models)
  return m === undefined ? '—' : rest.length ? 'mixed (see By model)' : m
}

export function agentDetail(view: SessionView, id: string): Detail[] {
  const a = view.agents.find((x) => x.id === id)
  const r = view.stats.agents[id]
  const s = view.agentStats[id]
  const tok = (k: Detail['k'], v: number | undefined): Detail => ({ k, v: v === undefined ? '—' : fmtTokens(v), title: v === undefined ? undefined : n(v) })
  return [
    { k: 'Type', v: id === 'main' ? 'main' : a?.type || '—' },
    { k: 'Model', v: id === 'main' ? mainModel(view) : a?.model || '—' },
    id === 'main' ? { k: 'Turns', v: n(view.stats.turns) } : { k: 'Requests', v: r ? n(r.requests) : '0' },
    tok('Input', r?.input),
    tok('Output', r?.output),
    tok('Thinking (in output)', r?.thinking),
    tok('Cache read', r?.cacheRead),
    tok('Cache write 5m', r?.cacheWrite5m),
    tok('Cache write 1h', r?.cacheWrite1h),
    { k: 'Cost (estimated)', v: fmtUsd(r ? r.cost : null), title: r && r.cost === null ? 'a model of this agent has no price' : undefined },
    { k: 'Duration', v: s ? fmtDuration(s.duration) : '—' },
    { k: 'Tool calls', v: s ? n(s.tools) : '—' },
  ]
}
