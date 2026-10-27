import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SessionMeta, TrashResult } from '../../../shared/api.ts'
import { fmtAgo, short } from '../lib/format.ts'
import { chipValues, defaultFilter, groupByProject, type Range, type SidebarFilter, sidebarSummary, toLocalInput } from '../lib/sidebar.ts'
import { fmtDuration } from '../lib/tokens.ts'
import { splitBusy, summarizeResults } from '../lib/trash.ts'
import { useStored } from '../useStored.ts'
import { FilterActs } from './AgentPicker.tsx'
import { Chip } from './Chip.tsx'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { SidePanel } from './SidePanel.tsx'

export type Tab = 'events' | 'sessions' | 'trash'
const FOLDS = ['open', 'closed'] as const
const DENSITIES = ['compact', 'comfortable'] as const
const DATES = [
  ['created', 'Created'],
  ['last', 'Last message'],
] as const

interface Props {
  sessions: SessionMeta[]
  // `sessions` through `filter`; App filters them, as an empty pick shows these on Events.
  rows: SessionMeta[]
  filter: SidebarFilter
  setFilter: (f: (f: SidebarFilter) => SidebarFilter) => void
  ready: boolean
  error: string | null
  root: string
  pick: readonly string[]
  toggle: (id: string) => void
  clear: () => void
  drop: (ids: readonly string[]) => void
  refresh: () => Promise<void>
  unseen: (row: SessionMeta) => number
  pinned: boolean
  onPin: () => void
  tab: Tab
  onTab: (t: Tab) => void
}

const OPEN_MS = 300
const HIDE_MS = 120

const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p

export function Sidebar({
  sessions,
  rows,
  filter,
  setFilter,
  ready,
  error,
  root,
  pick,
  toggle,
  clear,
  drop,
  refresh,
  unseen,
  pinned,
  onPin,
  tab,
  onTab,
}: Props) {
  const { chips, not, project, text } = filter
  const [density, setDensity] = useStored('wal.density', DENSITIES, 'compact')
  const [fold, setFold] = useStored('wal.sbfilters', FOLDS, 'open')
  const folded = fold === 'closed'
  // Unpinned, it is off-canvas and only the left-edge hot zone brings it in.
  const [open, setOpen] = useState(false)

  const all = useMemo(() => groupByProject(sessions), [sessions])
  // A 5 s poll re-sorts live sessions by `last`, which would move rows under the pointer between aim and click.
  const [frozen, setFrozen] = useState<ReadonlyMap<string, number> | null>(null)
  const groups = useMemo(() => groupByProject(rows, frozen ? (r) => frozen.get(r.id) ?? 0 : undefined), [rows, frozen])
  const picked = new Set(pick)
  const now = Date.now()
  // Emptying the chips also drops Not, so the next tick starts as an include again.
  const put = (n: ReadonlySet<string>) => setFilter((f) => ({ ...f, chips: n, not: n.size ? f.not : false }))
  // A `to` covers its whole minute, the input's precision.
  const setBound = (key: 'created' | 'last', end: keyof Range, value: string) =>
    setFilter((f) => ({ ...f, [key]: { ...f[key], [end]: value ? new Date(value).getTime() + (end === 'to' ? 59_999 : 0) : null } }))
  const flip = (c: string) => {
    const n = new Set(chips)
    if (!n.delete(c)) n.add(c)
    put(n)
  }
  const label = (g: { slug: string; cwd: string | null }) => (g.cwd ? base(g.cwd) : g.slug)
  const chosen = all.find((g) => g.slug === project)
  const date = (key: 'created' | 'last', name: string, end: keyof Range) => {
    const t = filter[key][end]
    return (
      <label className="sb-d">
        <input
          type="datetime-local"
          aria-label={`${name} ${end}`}
          value={t === null ? '' : toLocalInput(t)}
          onChange={(e) => setBound(key, end, e.target.value)}
        />
        <button className="ghost" type="button" aria-label={`Clear ${name} ${end}`} title="Clear" hidden={t === null} onClick={() => setBound(key, end, '')}>
          ×
        </button>
      </label>
    )
  }
  const summary = sidebarSummary(filter, chosen ? label(chosen) : project)

  const [ask, setAsk] = useState<{ title: string; rows: readonly SessionMeta[] } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const confirmMove = (title: string, set: readonly SessionMeta[]) => {
    setNote(null)
    setAsk({ title, rows: set })
  }
  const pickedRows = pick.flatMap((id) => sessions.find((s) => s.id === id) ?? [])
  const parts = ask && splitBusy(ask.rows)
  const itemName = (r: SessionMeta) => (r.title ? `${r.title} · ${short(r.id)}` : short(r.id))
  // Busy sessions are never sent; they count in the summary as the server would report them.
  const moveToTrash = async (movable: readonly SessionMeta[], skipped: readonly SessionMeta[]) => {
    setAsk(null)
    try {
      let results: TrashResult[] = []
      if (movable.length) {
        const res = await fetch('/trash', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids: movable.map((r) => r.id) }),
        })
        if (!res.ok) throw new Error(`error ${res.status}`)
        results = ((await res.json()) as { results: TrashResult[] }).results
      }
      const moved = results.filter((r) => r.status === 'ok').map((r) => r.id)
      if (moved.length) drop(moved)
      setNote(summarizeResults([...results, ...skipped.map((r): TrashResult => ({ id: r.id, status: 'live' }))]))
    } catch (e) {
      setNote(`could not move to trash (${(e as Error).message})`)
    }
    await refresh()
  }

  const [tip, setTip] = useState<{ id: string; el: HTMLElement } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const asideRef = useRef<HTMLElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const stop = useCallback(() => window.clearTimeout(timer.current), [])
  const later = (fn: () => void, ms: number) => {
    stop()
    timer.current = window.setTimeout(fn, ms)
  }
  const hide = useCallback(() => {
    stop()
    setTip(null)
  }, [stop])
  useEffect(() => stop, [stop])
  const tipUp = tip !== null
  useEffect(() => {
    if (!tipUp) return
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [tipUp, hide])
  const how = useRef<'pointer' | 'focus'>('pointer')
  const cur = tip && sessions.find((s) => s.id === tip.id)
  const bubble = tip && cur && cur.prompt !== null && tip.el.isConnected ? { prompt: cur.prompt } : null
  const place = () => {
    const b = tipRef.current
    const a = asideRef.current
    if (!b || !a || !tip) return
    let left = a.getBoundingClientRect().right - 1
    const room = window.innerWidth - left - 12
    let width = Math.min(560, room)
    if (room < 240) {
      width = Math.min(560, window.innerWidth - 16)
      left = window.innerWidth - width - 8
    }
    b.style.left = `${left}px`
    b.style.width = `${width}px`
    b.style.top = `${Math.max(8, Math.min(tip.el.getBoundingClientRect().top, window.innerHeight - b.offsetHeight - 8))}px`
  }
  const placeRef = useRef(place)
  placeRef.current = place
  useLayoutEffect(place)
  const bubbleUp = bubble !== null
  useEffect(() => {
    if (!bubbleUp) return
    const on = () => placeRef.current()
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [bubbleUp])
  useEffect(() => {
    if (tip && !tip.el.isConnected) hide()
  })
  const inTip = (t: EventTarget | null) => t instanceof Node && !!tipRef.current?.contains(t)

  const row = (r: SessionMeta) => {
    const k = unseen(r)
    const on = picked.has(r.id)
    return (
      // biome-ignore lint/a11y/useSemanticElements: a two-line row with badges cannot be an <input>; the button keeps it focusable and clickable.
      <button
        key={r.id}
        type="button"
        className="sb-row"
        role="checkbox"
        aria-checked={on}
        aria-labelledby={`sbn-${r.id}`}
        aria-describedby={bubble && tip?.id === r.id ? 'sb-tip' : undefined}
        onPointerEnter={(e) => {
          if (r.prompt === null) {
            later(hide, HIDE_MS)
            return
          }
          const el = e.currentTarget
          stop()
          how.current = 'pointer'
          if (tip) setTip({ id: r.id, el })
          else later(() => setTip({ id: r.id, el }), OPEN_MS)
        }}
        onPointerLeave={() => later(hide, HIDE_MS)}
        onFocus={(e) => {
          if (!e.currentTarget.matches(':focus-visible')) return
          if (r.prompt === null) {
            hide()
            return
          }
          stop()
          how.current = 'focus'
          setTip({ id: r.id, el: e.currentTarget })
        }}
        onBlur={(e) => {
          if (!inTip(e.relatedTarget)) hide()
        }}
        onClick={() => {
          hide()
          toggle(r.id)
        }}
      >
        <span className="sb-b">
          <span className="t">
            <span className="dot" title={r.live ? 'live' : 'idle'} style={{ background: r.live ? 'var(--cat-session)' : 'var(--grid)' }} />
            <span className="n" id={`sbn-${r.id}`} title={r.title || r.id}>
              {r.title || short(r.id)}
            </span>
            {k > 0 && (
              <span className="badge new" title={`${k} new events`}>
                +{k}
              </span>
            )}
          </span>
          <span className="m">
            {r.workspaces.map((w) => (
              <span key={w} className="badge ws">
                {w}
              </span>
            ))}
            {r.worktree !== null && <span className="badge wt">{r.worktree}</span>}
            <span
              className="num"
              title={r.started === null ? new Date(r.last).toLocaleString() : `${new Date(r.started).toLocaleString()} → ${new Date(r.last).toLocaleString()}`}
            >
              {r.started === null ? fmtAgo(r.last, now) : `${fmtDuration(r.last - r.started)} · ${fmtAgo(r.last, now)}`}
            </span>
          </span>
        </span>
        <span className="ck" aria-hidden="true">
          ✓
        </span>
      </button>
    )
  }

  return (
    <SidePanel side="left" label="Sessions" pinned={pinned} onPin={onPin} open={open} setOpen={setOpen} asideRef={asideRef} className="sidebar">
      {/* Only .sb-list scrolls: the tabs and filters above it stay put. */}
      <div className="sb-top">
        <div className="sb-h">
          <fieldset className="seg" id="tabs" aria-label="View">
            <button className="chip" type="button" aria-pressed={tab === 'events'} onClick={() => onTab('events')}>
              Events
            </button>
            <button className="chip" type="button" aria-pressed={tab === 'sessions'} onClick={() => onTab('sessions')}>
              Sessions
            </button>
            <button className="chip" type="button" aria-pressed={tab === 'trash'} onClick={() => onTab('trash')}>
              Trash
            </button>
          </fieldset>
          <button
            className="ghost"
            type="button"
            aria-pressed={density === 'compact'}
            title="One line per session"
            onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
          >
            Compact
          </button>
        </div>
        <div className="sb-n">
          <span>
            {error !== null
              ? `could not load sessions (${error})`
              : `${rows.length}/${sessions.length} sessions · ${pick.length ? `${pick.length} picked` : 'all listed'}`}
          </span>
          {pick.length > 0 && (
            <>
              <button className="ghost" type="button" onClick={clear}>
                Clear all
              </button>
              <button className="ghost danger sb-del" type="button" disabled={!pickedRows.length} onClick={() => confirmMove('Delete picked', pickedRows)}>
                Delete picked
              </button>
            </>
          )}
          <button className="ghost danger sb-del" type="button" disabled={!rows.length} onClick={() => confirmMove(`Delete ${rows.length} filtered`, rows)}>
            Delete {rows.length} filtered
          </button>
        </div>
        {note !== null && (
          <div className="sb-note" role="status">
            {note}
          </div>
        )}
        <div className="sb-f">
          <div className="sb-fh">
            <button
              className="ghost fold"
              id="sbfold"
              type="button"
              aria-expanded={!folded}
              aria-controls="sbfilters"
              onClick={() => setFold(folded ? 'open' : 'closed')}
            >
              {folded ? ['▸ Filters', ...(summary.length ? summary : ['none'])].join(' · ') : '▾ Filters'}
            </button>
            <button className="ghost" type="button" onClick={() => setFilter(() => defaultFilter())}>
              Clear filters
            </button>
          </div>
          <div className="sb-fs" id="sbfilters" hidden={folded}>
            <FilterActs
              ticked={chips.size > 0}
              not={not}
              onAll={() => put(new Set(chipValues(sessions)))}
              onNone={() => put(new Set())}
              onNot={() => setFilter((f) => ({ ...f, not: !f.not }))}
            />
            <div className="sb-chips" data-not={not ? '' : undefined}>
              {chipValues(sessions).map((c) => (
                <Chip key={c} label={c} color="var(--cat-mcp)" on={chips.has(c)} onClick={() => flip(c)} />
              ))}
            </div>
            {DATES.map(([key, name]) => (
              <fieldset key={key} className="sb-dates" aria-label={name}>
                <span>{name}:</span>
                <div>
                  {date(key, name, 'from')}
                  <span aria-hidden="true">–</span>
                  {date(key, name, 'to')}
                </div>
              </fieldset>
            ))}
            <select aria-label="Project" value={project} onChange={(e) => setFilter((f) => ({ ...f, project: e.target.value }))}>
              <option value="">All projects</option>
              {all.map((g) => (
                <option key={g.slug} value={g.slug} title={g.cwd ?? g.slug}>
                  {label(g)}
                </option>
              ))}
            </select>
            <input
              type="search"
              placeholder="Search sessions"
              aria-label="Search sessions"
              value={text}
              onChange={(e) => setFilter((f) => ({ ...f, text: e.target.value }))}
            />
          </div>
        </div>
      </div>
      <div
        className="sb-list"
        data-density={density}
        onScroll={(e) => {
          const r = tip?.el.getBoundingClientRect()
          const l = e.currentTarget.getBoundingClientRect()
          if (how.current === 'pointer' || !r || r.bottom <= l.top || r.top >= l.bottom) hide()
          else place()
        }}
        onPointerEnter={() => setFrozen(new Map(sessions.map((s) => [s.id, s.last])))}
        onPointerLeave={() => setFrozen(null)}
      >
        {groups.map((g) => (
          <section key={g.slug} className="sb-g">
            <h2 title={g.cwd ?? g.slug}>{label(g)}</h2>
            {g.rows.map((r) => row(r))}
          </section>
        ))}
        <div className="empty" hidden={!ready || sessions.length > 0 || error !== null}>
          No sessions found (looked in <code>{root}</code>).
        </div>
        <div className="empty" hidden={sessions.length === 0 || rows.length > 0}>
          No session matches the filter.
        </div>
        {/* Portal children still bubble pointer events through the React tree: the bubble counts as inside .sb-list and the aside. */}
        {bubble &&
          createPortal(
            <div
              className="sb-tip"
              id="sb-tip"
              role="tooltip"
              ref={tipRef}
              tabIndex={-1}
              onPointerEnter={stop}
              onFocus={() => {
                if (!pinned) setOpen(true)
              }}
              onPointerLeave={() => later(hide, HIDE_MS)}
              onBlur={(e) => {
                if (!inTip(e.relatedTarget) && !(e.relatedTarget instanceof Node && tip?.el.contains(e.relatedTarget))) hide()
              }}
            >
              <div className="sb-tip-p">{bubble.prompt}</div>
            </div>,
            asideRef.current?.closest('.viz-root') ?? document.body,
          )}
      </div>
      {ask &&
        parts &&
        createPortal(
          <ConfirmDialog
            title={ask.title}
            confirmLabel="Move to trash"
            items={[...parts.movable.map((r) => ({ name: itemName(r) })), ...parts.skipped.map((s) => ({ name: itemName(s.session), skipped: s.why }))]}
            onConfirm={() =>
              void moveToTrash(
                parts.movable,
                parts.skipped.map((s) => s.session),
              )
            }
            onCancel={() => setAsk(null)}
          />,
          asideRef.current?.closest('.viz-root') ?? document.body,
        )}
    </SidePanel>
  )
}
