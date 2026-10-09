import type { Category } from '../../../shared/api.ts'
import { agentSelection, pruneAgents, type PickNode } from './agents.ts'

// Opt-in: an empty set sends no param, which the server reads as no filter.
export interface Filters {
  q: string
  date_from: string
  date_to: string
  time_from: string
  time_to: string
  min_ms: string
  max_ms: string
  cat: ReadonlySet<Category>
  tool: ReadonlySet<string>
  event: ReadonlySet<string>
  // Session-scoped agent tokens built by the picker's tree (see lib/agents.ts).
  agent: ReadonlySet<string>
  nodur: boolean
}

export const EMPTY_FILTERS: Filters = {
  q: '',
  date_from: '',
  date_to: '',
  time_from: '',
  time_to: '',
  min_ms: '',
  max_ms: '',
  cat: new Set(),
  tool: new Set(),
  event: new Set(),
  agent: new Set(),
  nodur: false,
}

// Field names double as the query parameter names.
const FIELDS = ['q', 'date_from', 'date_to', 'time_from', 'time_to', 'min_ms', 'max_ms'] as const

// One builder serves /events and /events-stream, so a live row always matches the listed ones.
export const buildParams = (f: Filters, ids: readonly string[]): URLSearchParams => {
  const p = new URLSearchParams()
  p.set('ids', ids.join(','))
  for (const id of FIELDS) {
    const v = f[id].trim()
    if (v) p.set(id, v)
  }
  if (f.cat.size) p.set('cat', [...f.cat].join(','))
  if (f.tool.size) p.set('tool', [...f.tool].join(','))
  if (f.event.size) p.set('event', [...f.event].join(','))
  if (f.agent.size) p.set('agent', [...f.agent].join(','))
  if (f.nodur) p.set('nodur', 'include')
  return p
}

const range = (lo: string, hi: string, sep = '–'): string => `${lo.trim()}${sep}${hi.trim()}`

// One-line digest of every active filter, shown in the Events head; empty when none is set.
export const filterSummary = (f: Filters, agents: readonly PickNode[]): string[] => {
  const out: string[] = []
  if (f.cat.size) out.push(`cat: ${f.cat.size}`)
  if (f.tool.size) out.push(`tool: ${f.tool.size}`)
  if (f.event.size) out.push(`event: ${f.event.size}`)
  if (f.agent.size) out.push(`agent: ${agentSelection(f.agent, agents)}`)
  if (f.q.trim()) out.push(`q: ${f.q.trim()}`)
  if (f.date_from.trim() || f.date_to.trim()) out.push(`date: ${range(f.date_from, f.date_to)}`)
  if (f.time_from.trim() || f.time_to.trim()) out.push(`time: ${range(f.time_from, f.time_to)}`)
  if (f.min_ms.trim() || f.max_ms.trim()) out.push(`ms: ${range(f.min_ms, f.max_ms)}${f.nodur ? ' +none' : ''}`)
  return out
}

/** What the selected sessions offer; every filter chip list is drawn from it. */
export interface Facets {
  tools: readonly string[]
  events: readonly string[]
  cats: readonly Category[]
  agents: readonly PickNode[]
}

const keep = <T>(sel: ReadonlySet<T>, ok: (v: T) => boolean): ReadonlySet<T> => {
  const next = new Set([...sel].filter(ok))
  return next.size === sel.size ? sel : next
}

/** Drops selections the facets no longer offer; `f` itself when nothing drops. */
export const pruneFilters = (f: Filters, x: Facets): Filters => {
  const cats = new Set(x.cats)
  const tools = new Set(x.tools)
  const events = new Set(x.events)
  const cat = keep(f.cat, (c) => cats.has(c))
  // '-' is the no-tool bucket, which no facet lists.
  const tool = keep(f.tool, (t) => t === '-' || tools.has(t))
  const event = keep(f.event, (e) => events.has(e))
  const agent = pruneAgents(f.agent, x.agents)
  return cat === f.cat && tool === f.tool && event === f.event && agent === f.agent ? f : { ...f, cat, tool, event, agent }
}

/** False when pruning emptied a filter that was set, so the loaded rows no longer match it. */
export const sameRows = (f: Filters, g: Filters): boolean => !(['cat', 'tool', 'event', 'agent'] as const).some((k) => f[k].size > 0 && g[k].size === 0)
