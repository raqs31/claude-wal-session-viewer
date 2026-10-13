import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionMeta, UsageTotals } from '../../../shared/api.ts'
import { buildTree } from '../lib/agents.ts'
import { EMPTY_FILTERS, type Filters, filterSummary, pruneFilters } from '../lib/params.ts'
import { FORMATS, type Format } from '../lib/tree.ts'
import { useEvents, type View } from '../useEvents.ts'
import { EventTable } from './EventTable.tsx'
import { FilterPanel } from './FilterPanel.tsx'
import { SidePanel } from './SidePanel.tsx'
import { StatsHeader } from './StatsHeader.tsx'
import { UsageTiles } from './UsageTiles.tsx'

const FORMAT_LABEL: Record<Format, string> = { json: 'JSON', yaml: 'YAML', raw: 'Raw' }

const FormatSeg = ({ format, onFormat }: { format: Format; onFormat: (f: Format) => void }) => (
  <fieldset className="seg" id="format" aria-label="Record format">
    {FORMATS.map((f) => (
      <button
        key={f}
        className="chip"
        type="button"
        data-f={f}
        aria-pressed={f === format}
        onClick={() => {
          if (f !== format) onFormat(f)
        }}
      >
        {FORMAT_LABEL[f]}
      </button>
    ))}
  </fieldset>
)

interface Props {
  filters: Filters
  setFilters: Dispatch<SetStateAction<Filters>>
  view: View
  setView: (v: View) => void
  format: Format
  setFormat: (f: Format) => void
  follow: boolean
  setFollow: (f: boolean) => void
  ids: readonly string[] | null
  onUnknown: (ids: string[]) => void
  sessions: readonly SessionMeta[]
  fpinned: boolean
  onFpin: () => void
  usage: UsageTotals | null
  usageLive: boolean | null
  usageError: string | null
  picked: number
}

export function EventsTab({
  filters,
  setFilters,
  view,
  setView,
  format,
  setFormat,
  follow,
  setFollow,
  ids,
  onUnknown,
  sessions,
  fpinned,
  onFpin,
  usage,
  usageLive,
  usageError,
  picked,
}: Props) {
  const bar = useRef<HTMLDivElement>(null)
  const [fopen, setFopen] = useState(false)
  // Remounting on Reset is the only way to clear a badInput field ('-' in a number, a partial date):
  // its value already reads '', so a controlled '' → '' render never writes to the DOM.
  const [resets, setResets] = useState(0)
  const ev = useEvents(filters, view, ids)
  const tree = useMemo(() => buildTree(ev.agents, (id) => sessions.find((x) => x.id === id)?.title), [ev.agents, sessions])
  useEffect(() => {
    const b = bar.current
    if (!b) return
    const o = new ResizeObserver(() => document.documentElement.style.setProperty('--bar-h', `${b.offsetHeight}px`))
    o.observe(b)
    return () => o.disconnect()
  }, [])
  const summary = filterSummary(filters, tree)
  const summaryText = summary.join(' · ')
  // A fresh object, so Reset re-queries even when nothing was set. The MCP search text stays.
  const reset = () => {
    setFilters({ ...EMPTY_FILTERS })
    setResets((n) => n + 1)
  }
  // A chosen value that left the facets (pick changed) would silently filter everything out.
  useEffect(() => {
    if (!ev.ready) return
    setFilters((f) => pruneFilters(f, { tools: ev.tools, events: ev.events, cats: ev.cats, agents: tree }))
  }, [ev.ready, ev.tools, ev.events, ev.cats, tree, setFilters])
  useEffect(() => {
    if (ev.unknown.length) onUnknown(ev.unknown)
  }, [ev.unknown, onUnknown])

  return (
    <>
      <SidePanel
        side="right"
        label="Filters"
        pinned={fpinned}
        onPin={onFpin}
        open={fopen}
        setOpen={setFopen}
        className="fpanel"
        handleLabel={summary.length ? `Filters, ${summary.length} active` : undefined}
        handle={
          <>
            Filters
            {summary.length > 0 && (
              <>
                {' '}
                <span className="fp-n">{summary.length}</span>
              </>
            )}
          </>
        }
      >
        <FilterPanel
          filters={filters}
          setFilters={setFilters}
          tools={ev.tools}
          events={ev.events}
          cats={ev.cats}
          agents={tree}
          resets={resets}
          onReset={reset}
        />
      </SidePanel>
      <div className="bar" id="bar" ref={bar}>
        <UsageTiles usage={usage} live={usageLive} error={usageError} picked={picked} />
        <div className="evline">
          <StatsHeader total={ev.total} head={ev.head} counts={ev.counts} spans={ev.spans} shown={ev.rows.length} ready={ev.ready} error={ev.error} />
          {summary.length > 0 && (
            <span className="evl-sum">
              <span className="evl-sumt" title={summaryText}>
                {summaryText}
              </span>
              <button className="ghost" type="button" onClick={reset}>
                Reset
              </button>
            </span>
          )}
          <span className="spacer" />
          <button className="chip" id="follow" type="button" aria-pressed={follow} onClick={() => setFollow(!follow)}>
            Live
          </button>
          <button
            className="ghost"
            id="view"
            type="button"
            onClick={() => setView(view === 'tail' ? 'table' : 'tail')}
          >{`View: ${view === 'tail' ? 'Tail' : 'Table'}`}</button>
          <FormatSeg format={format} onFormat={setFormat} />
          <span className="live">
            <span className="dot" id="livedot" style={ev.live === null ? undefined : { background: ev.live ? 'var(--cat-session)' : 'var(--muted)' }} />
            <button id="livetext" type="button" onClick={() => void ev.requery()}>
              {ev.live === null ? 'connecting' : ev.live ? 'live' : 'disconnected'}
            </button>
          </span>
        </div>
      </div>
      <EventTable
        rows={ev.rows}
        pending={ev.pending}
        view={view}
        follow={follow}
        ready={ev.ready}
        next={ev.next}
        pages={ev.pages}
        change={ev.change}
        qid={ev.qid}
        gens={ev.gens}
        format={format}
        loadOlder={ev.loadOlder}
        flush={ev.flush}
        requery={ev.requery}
      />
    </>
  )
}
