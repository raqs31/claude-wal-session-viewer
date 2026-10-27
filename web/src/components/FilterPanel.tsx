import type { Dispatch, SetStateAction } from 'react'
import { type Category, catOf } from '../../../shared/api.ts'
import { countNodes, type PickNode, selectAll, toggle } from '../lib/agents.ts'
import { CATEGORY } from '../lib/categories.ts'
import { mcpParts, toolColor } from '../lib/mcp.ts'
import type { Filters, NotField } from '../lib/params.ts'
import { AgentPicker, FilterActs } from './AgentPicker.tsx'
import { Chip } from './Chip.tsx'
import { McpPanel } from './McpPanel.tsx'

type TextField = 'q' | 'date_from' | 'date_to' | 'time_from' | 'time_to' | 'min_ms' | 'max_ms' | 'min_tok' | 'max_tok'

const flip = <T,>(set: ReadonlySet<T>, key: T): Set<T> => {
  const s = new Set(set)
  if (!s.delete(key)) s.add(key)
  return s
}

interface Props {
  filters: Filters
  setFilters: Dispatch<SetStateAction<Filters>>
  tools: readonly string[]
  events: readonly string[]
  cats: readonly Category[]
  agents: readonly PickNode[]
  resets: number
  onReset: () => void
}

export function FilterPanel({ filters, setFilters, tools, events, cats, agents, resets, onReset }: Props) {
  const text = (id: TextField) => ({
    id,
    value: filters[id],
    onChange: (e: { target: { value: string } }) => {
      const v = e.target.value
      setFilters((f) => ({ ...f, [id]: v }))
    },
  })
  // A section whose set empties also drops its Not flag, so the next tick starts as an include again.
  const put = (f: Filters, k: NotField, set: ReadonlySet<string>): Filters => {
    const not = new Set(f.not)
    if (set.size === 0) not.delete(k)
    return { ...f, [k]: set, not }
  }
  const toggleTool = (t: string) => setFilters((f) => put(f, 'tool', flip(f.tool, t)))
  const setTools = (ts: readonly string[], on: boolean) =>
    setFilters((f) => {
      const tool = new Set(f.tool)
      for (const t of ts)
        if (on) tool.add(t)
        else tool.delete(t)
      return put(f, 'tool', tool)
    })
  const setNot = (k: NotField) =>
    setFilters((f) => {
      const not = new Set(f.not)
      if (!not.delete(k)) not.add(k)
      return { ...f, not }
    })
  const none = (k: NotField) => setFilters((f) => put(f, k, new Set()))
  const acts = (k: NotField, ticked: number, all: () => void) => (
    <FilterActs ticked={ticked > 0} not={filters.not.has(k)} onAll={all} onNone={() => none(k)} onNot={() => setNot(k)} />
  )
  const nots = (k: NotField) => (filters.not.has(k) ? '' : undefined)

  return (
    <>
      <h2 className="fp-h">Filters</h2>
      <div className="fp-body">
        <section className="fp-s">
          <h3>Search</h3>
          <input type="search" placeholder="Filter by event, tool or text…" aria-label="Filter events" key={`q${resets}`} {...text('q')} />
        </section>
        <section className="fp-s" id="cats" data-not={nots('cat')}>
          <h3>Category</h3>
          {/* The category chips double as the legend: identity is available as a labelled swatch, never
              by matching a colour to a row unaided. */}
          {acts('cat', filters.cat.size, () => setFilters((f) => ({ ...f, cat: new Set(cats) })))}
          <div className="filters">
            {cats.map((c) => (
              <Chip
                key={c}
                label={CATEGORY[c].label}
                color={CATEGORY[c].color}
                on={filters.cat.has(c)}
                onClick={() => setFilters((f) => put(f, 'cat', flip(f.cat, c)))}
              />
            ))}
          </div>
        </section>
        {countNodes(agents) > 1 && (
          <section className="fp-s">
            <h3>Agent</h3>
            <AgentPicker
              tree={agents}
              selected={filters.agent}
              not={filters.not.has('agent')}
              onToggle={(key) => setFilters((f) => put(f, 'agent', toggle(agents, f.agent, key)))}
              onAll={() => setFilters((f) => ({ ...f, agent: selectAll(agents) }))}
              onClear={() => none('agent')}
              onNot={() => setNot('agent')}
            />
          </section>
        )}
        <section className="fp-s" id="tools" aria-label="Filter by tool" data-not={nots('tool')}>
          <h3>Tool</h3>
          {acts('tool', filters.tool.size, () => setFilters((f) => ({ ...f, tool: new Set(['-', ...tools]) })))}
          <div className="filters">
            <Chip label="(no tool)" color={toolColor('-')} on={filters.tool.has('-')} onClick={() => toggleTool('-')} />
            {tools
              .filter((t) => !mcpParts(t))
              .map((t) => (
                <Chip key={t} label={t} color={toolColor(t)} on={filters.tool.has(t)} onClick={() => toggleTool(t)} />
              ))}
          </div>
          <McpPanel tools={tools} selected={filters.tool} onSet={setTools} />
        </section>
        <section className="fp-s" id="events" aria-label="Filter by event" data-not={nots('event')}>
          <h3>Event</h3>
          {acts('event', filters.event.size, () => setFilters((f) => ({ ...f, event: new Set(events) })))}
          <div className="filters">
            {events.map((e) => (
              <Chip
                key={e}
                label={e}
                color={CATEGORY[catOf(e)].color}
                on={filters.event.has(e)}
                onClick={() => setFilters((f) => put(f, 'event', flip(f.event, e)))}
              />
            ))}
          </div>
        </section>
        <section className="fp-s">
          <h3>Date</h3>
          <div className="fp-range">
            <input type="date" aria-label="From date" key={`date_from${resets}`} {...text('date_from')} /> –{' '}
            <input type="date" aria-label="To date" key={`date_to${resets}`} {...text('date_to')} />
          </div>
        </section>
        <section className="fp-s">
          <h3>Time</h3>
          <div className="fp-range">
            <input type="time" aria-label="From time" key={`time_from${resets}`} {...text('time_from')} /> –{' '}
            <input type="time" aria-label="To time" key={`time_to${resets}`} {...text('time_to')} />
          </div>
        </section>
        <section className="fp-s">
          <h3>Duration</h3>
          <div className="fp-range">
            ≥ <input type="number" min="0" placeholder="ms" aria-label="Minimum duration in ms" key={`min_ms${resets}`} {...text('min_ms')} /> ≤{' '}
            <input type="number" min="0" placeholder="ms" aria-label="Maximum duration in ms" key={`max_ms${resets}`} {...text('max_ms')} />
          </div>
          <button
            className="chip"
            id="nodur"
            type="button"
            aria-pressed={filters.nodur}
            disabled={!filters.min_ms && !filters.max_ms}
            onClick={() => setFilters((f) => ({ ...f, nodur: !f.nodur }))}
          >{`no duration: ${filters.nodur ? 'include' : 'exclude'}`}</button>
        </section>
        <section className="fp-s">
          <h3>Tokens</h3>
          <div className="fp-range">
            ≥ <input type="number" min="0" placeholder="tokens" aria-label="Minimum tokens" key={`min_tok${resets}`} {...text('min_tok')} /> ≤{' '}
            <input type="number" min="0" placeholder="tokens" aria-label="Maximum tokens" key={`max_tok${resets}`} {...text('max_tok')} />
          </div>
          <button
            className="chip"
            id="notok"
            type="button"
            aria-pressed={filters.notok}
            disabled={!filters.min_tok && !filters.max_tok}
            onClick={() => setFilters((f) => ({ ...f, notok: !f.notok }))}
          >{`no tokens: ${filters.notok ? 'include' : 'exclude'}`}</button>
        </section>
        <button className="ghost" id="reset" type="button" onClick={onReset}>
          Reset
        </button>
      </div>
    </>
  )
}
