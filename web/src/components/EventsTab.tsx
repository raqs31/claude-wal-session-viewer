import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionMeta, UsageTotals } from '../../../shared/api.ts'
import { buildTree } from '../lib/agents.ts'
import { EMPTY_FILTERS, type Filters, filterSummary, pruneFilters } from '../lib/params.ts'
import { canSort, type Sort, type View } from '../lib/sort.ts'
import { FORMATS, type Format } from '../lib/tree.ts'
import { useEvents } from '../useEvents.ts'
import type { Observer } from '../useObserver.ts'
import { EventTable } from './EventTable.tsx'
import { FilterPanel } from './FilterPanel.tsx'
import { SidePanel } from './SidePanel.tsx'
import { buildingNote, type Stale, StatsHeader } from './StatsHeader.tsx'
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
  sort: Sort
  setSort: (s: Sort) => void
  observer: Observer
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
  sort,
  setSort,
  observer,
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
  const ev = useEvents(filters, view, ids, sort)
  // Stale from the first page, a stale frame or the observer poll, whichever names the session first.
  const stale = useMemo((): Stale[] => {
    const m = new Map<string, string>()
    for (const [id, p] of Object.entries(ev.pipe)) if (p.stale !== null) m.set(id, p.stale)
    for (const [id, reason] of Object.entries(ev.stale)) m.set(id, reason)
    for (const x of observer.status?.stale ?? []) if (ids?.includes(x.id)) m.set(x.id, x.reason)
    return [...m].map(([id, reason]) => ({ id, reason }))
  }, [ev.pipe, ev.stale, observer.status, ids])
  // The observer says when a session is built; the pipe bytes only give the percent while it runs.
  // Two sources, the first page and the usage stream; whichever object arrived last is the newer one.
  const pipeAt = useRef({ page: ev.pipe, usage: usage?.pipe, newest: 'page' as 'page' | 'usage' })
  if (pipeAt.current.page !== ev.pipe) pipeAt.current = { page: ev.pipe, usage: usage?.pipe, newest: 'page' }
  else if (pipeAt.current.usage !== usage?.pipe) pipeAt.current = { page: ev.pipe, usage: usage?.pipe, newest: usage?.pipe ? 'usage' : 'page' }
  const pipe = pipeAt.current.newest === 'usage' && usage ? { ...ev.pipe, ...usage.pipe } : { ...usage?.pipe, ...ev.pipe }
  const building = useMemo(() => buildingNote(pipe, new Set(observer.status?.building), ids ?? []), [pipe, observer.status, ids])
  const rebuild = async (rids: readonly string[]) => {
    const err = await observer.rebuild(rids)
    void ev.requery()
    return err
  }
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
          <StatsHeader
            total={ev.total}
            head={ev.head}
            counts={ev.counts}
            spans={ev.spans}
            shown={ev.rows.length}
            ready={ev.ready}
            error={ev.error}
            building={building}
            stale={stale}
            readOnly={observer.status?.owner === false}
            rebuild={rebuild}
          />
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
          <button
            className="chip"
            id="follow"
            type="button"
            aria-pressed={follow}
            onClick={() => {
              // In the same handler: one render with Live on and a sort would open a stream the server refuses.
              if (!follow) setSort(null)
              setFollow(!follow)
            }}
          >
            Live
          </button>
          <button
            className="ghost"
            id="view"
            type="button"
            onClick={() => {
              // Tail takes no sort; reset here for the same reason as Live.
              if (view === 'table') setSort(null)
              setView(view === 'tail' ? 'table' : 'tail')
            }}
          >{`View: ${view === 'tail' ? 'Tail' : 'Table'}`}</button>
          <FormatSeg format={format} onFormat={setFormat} />
          <span className="live">
            <span className="dot" id="livedot" style={ev.live === null ? undefined : { background: ev.live ? 'var(--cat-session)' : 'var(--muted)' }} />
            <button id="livetext" type="button" onClick={() => void ev.requery()}>
              {sort ? 'paused' : ev.live === null ? 'connecting' : ev.live ? 'live' : 'disconnected'}
            </button>
          </span>
        </div>
      </div>
      <EventTable
        rows={ev.rows}
        pending={ev.pending}
        // A sorted list reads top-down, so the table pages it down whatever the view.
        view={sort ? 'table' : view}
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
        sort={sort}
        setSort={setSort}
        canSort={canSort(follow, view)}
      />
    </>
  )
}
