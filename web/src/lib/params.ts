import type { Category } from '../../../shared/api.ts'
import { agentSelection, type PickNode, pruneAgents } from './agents.ts'

export type NotField = 'cat' | 'tool' | 'event' | 'agent'

// Opt-in: an empty set sends no param, which the server reads as no filter.
export interface Filters {
  q: string
  date_from: string
  date_to: string
  time_from: string
  time_to: string
  min_ms: string
  max_ms: string
  min_tok: string
  max_tok: string
  cat: ReadonlySet<Category>
  tool: ReadonlySet<string>
  event: ReadonlySet<string>
  // Session-scoped agent tokens built by the picker's tree (see lib/agents.ts).
  agent: ReadonlySet<string>
  nodur: boolean
  notok: boolean
  // Sections whose set excludes instead of includes; sent as `<field>_not`.
  not: ReadonlySet<NotField>
}

export const EMPTY_FILTERS: Filters = {
  q: '',
  date_from: '',
  date_to: '',
  time_from: '',
  time_to: '',
  min_ms: '',
  max_ms: '',
  min_tok: '',
  max_tok: '',
  cat: new Set(),
  tool: new Set(),
  event: new Set(),
  agent: new Set(),
  nodur: false,
  notok: false,
  not: new Set(),
}

// Field names double as the query parameter names.
const FIELDS = ['q', 'date_from', 'date_to', 'time_from', 'time_to', 'min_ms', 'max_ms', 'min_tok', 'max_tok'] as const

const SETS = ['cat', 'tool', 'event', 'agent'] as const

// One builder serves /events and /events-stream, so a live row always matches the listed ones.
export const buildParams = (f: Filters, ids: readonly string[]): URLSearchParams => {
  const p = new URLSearchParams()
  p.set('ids', ids.join(','))
  for (const id of FIELDS) {
    const v = f[id].trim()
    if (v) p.set(id, v)
  }
  for (const k of SETS) if (f[k].size) p.set(f.not.has(k) ? `${k}_not` : k, [...f[k]].join(','))
  if (f.nodur) p.set('nodur', 'include')
  if (f.notok) p.set('notok', 'include')
  return p
}

const range = (lo: string, hi: string, sep = '–'): string => `${lo.trim()}${sep}${hi.trim()}`

// One-line digest of every active filter, shown in the Events head; empty when none is set.
export const filterSummary = (f: Filters, agents: readonly PickNode[]): string[] => {
  const out: string[] = []
  const op = (k: NotField) => (f.not.has(k) ? '≠' : '')
  if (f.cat.size) out.push(`cat: ${op('cat')}${f.cat.size}`)
  if (f.tool.size) out.push(`tool: ${op('tool')}${f.tool.size}`)
  if (f.event.size) out.push(`event: ${op('event')}${f.event.size}`)
  if (f.agent.size) out.push(`agent: ${op('agent')}${agentSelection(f.agent, agents)}`)
  if (f.q.trim()) out.push(`q: ${f.q.trim()}`)
  if (f.date_from.trim() || f.date_to.trim()) out.push(`date: ${range(f.date_from, f.date_to)}`)
  if (f.time_from.trim() || f.time_to.trim()) out.push(`time: ${range(f.time_from, f.time_to)}`)
  if (f.min_ms.trim() || f.max_ms.trim()) out.push(`ms: ${range(f.min_ms, f.max_ms)}${f.nodur ? ' +none' : ''}`)
  if (f.min_tok.trim() || f.max_tok.trim()) out.push(`tok: ${range(f.min_tok, f.max_tok)}${f.notok ? ' +none' : ''}`)
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
  if (cat === f.cat && tool === f.tool && event === f.event && agent === f.agent) return f
  const sets = { cat, tool, event, agent }
  const not = new Set([...f.not].filter((k) => sets[k].size > 0))
  return { ...f, ...sets, not }
}

/** False when pruning emptied a filter that was set, so the loaded rows no longer match it. */
export const sameRows = (f: Filters, g: Filters): boolean => !SETS.some((k) => f[k].size > 0 && g[k].size === 0)
