import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SessionMeta } from '../../../shared/api.ts'
import { fmtAgo, short } from '../lib/format.ts'
import { chipValues, filterRows, groupByProject, pinPicked, sidebarSummary } from '../lib/sidebar.ts'
import { fmtDuration } from '../lib/tokens.ts'
import { useStored } from '../useStored.ts'
import { Chip } from './Chip.tsx'
import { SidePanel } from './SidePanel.tsx'

export type Tab = 'events' | 'sessions'
const FOLDS = ['open', 'closed'] as const

interface Props {
  sessions: SessionMeta[]
  ready: boolean
  error: string | null
  root: string
  pick: readonly string[]
  toggle: (id: string) => void
  clear: () => void
  unseen: (row: SessionMeta) => number
  pinned: boolean
  onPin: () => void
  tab: Tab
  onTab: (t: Tab) => void
}

const OPEN_MS = 300
const HIDE_MS = 120

const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p

export function Sidebar({ sessions, ready, error, root, pick, toggle, clear, unseen, pinned, onPin, tab, onTab }: Props) {
  const [chips, setChips] = useState<ReadonlySet<string>>(new Set())
  const [project, setProject] = useState('')
  const [text, setText] = useState('')
  const [fold, setFold] = useStored('wal.sbfilters', FOLDS, 'open')
  const folded = fold === 'closed'
  // Unpinned, it is off-canvas and only the left-edge hot zone brings it in.
  const [open, setOpen] = useState(false)

  const all = useMemo(() => groupByProject(sessions), [sessions])
  // A 5 s poll re-sorts live sessions by `last`, which would move rows under the pointer between aim and click.
  const [frozen, setFrozen] = useState<ReadonlyMap<string, number> | null>(null)
  const rows = useMemo(() => filterRows(sessions, { chips, project, text }), [sessions, chips, project, text])
  const top = useMemo(() => pinPicked(sessions, pick).picked, [sessions, pick])
  const rest = useMemo(() => pinPicked(rows, pick).rest, [rows, pick])
  const groups = useMemo(() => groupByProject(rest, frozen ? (r) => frozen.get(r.id) ?? 0 : undefined), [rest, frozen])
  const picked = new Set(pick)
  const shown = top.length + groups.reduce((n, g) => n + g.rows.length, 0)
  const now = Date.now()
  const flip = (c: string) =>
    setChips((s) => {
      const n = new Set(s)
      if (!n.delete(c)) n.add(c)
      return n
    })
  const label = (g: { slug: string; cwd: string | null }) => (g.cwd ? base(g.cwd) : g.slug)
  const chosen = all.find((g) => g.slug === project)
  const projectOf = new Map(all.flatMap((g) => g.rows.map((r) => [r.id, label(g)] as const)))
  const summary = sidebarSummary({ chips, project, text }, chosen ? label(chosen) : project)

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

  const row = (r: SessionMeta, proj?: string) => {
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
            {proj !== undefined && <span className="badge">{proj}</span>}
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
          </fieldset>
        </div>
        <div className="sb-n">
          {error !== null
            ? `could not load sessions (${error})`
            : `${shown}/${sessions.length} sessions · ${pick.length ? `${pick.length} picked` : 'all sessions'}`}
        </div>
        {pick.length > 0 && (
          <div className="sb-chips sb-pk">
            {pick.map((id) => {
              const meta = sessions.find((s) => s.id === id)
              const name = meta?.title || short(id)
              return (
                <button key={id} className="chip pk" type="button" title={meta?.title || id} aria-label={`Deselect ${name}`} onClick={() => toggle(id)}>
                  <span className="n">{name}</span>
                  <span aria-hidden="true">×</span>
                </button>
              )
            })}
            <button className="chip" type="button" onClick={clear}>
              Clear all
            </button>
          </div>
        )}
        <div className="sb-f">
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
          <div className="sb-fs" id="sbfilters" hidden={folded}>
            <div className="sb-chips">
              {chipValues(sessions).map((c) => (
                <Chip key={c} label={c} color="var(--cat-mcp)" on={chips.has(c)} onClick={() => flip(c)} />
              ))}
            </div>
            <select aria-label="Project" value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">All projects</option>
              {all.map((g) => (
                <option key={g.slug} value={g.slug} title={g.cwd ?? g.slug}>
                  {label(g)}
                </option>
              ))}
            </select>
            <input type="search" placeholder="Search sessions" aria-label="Search sessions" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        </div>
      </div>
      <div
        className="sb-list"
        onScroll={(e) => {
          const r = tip?.el.getBoundingClientRect()
          const l = e.currentTarget.getBoundingClientRect()
          if (how.current === 'pointer' || !r || r.bottom <= l.top || r.top >= l.bottom) hide()
          else place()
        }}
        onPointerEnter={() => setFrozen(new Map(sessions.map((s) => [s.id, s.last])))}
        onPointerLeave={() => setFrozen(null)}
      >
        {top.length > 0 && (
          <section className="sb-g">
            <h2>Selected</h2>
            {top.map((r) => row(r, projectOf.get(r.id)))}
          </section>
        )}
        {groups.map((g) => (
          <section key={g.slug} className="sb-g">
            <h2 title={g.cwd ?? g.slug}>{label(g)}</h2>
            {g.rows.map((r) => row(r))}
          </section>
        ))}
        <div className="empty" hidden={!ready || sessions.length > 0 || error !== null}>
          No sessions found (looked in <code>{root}</code>).
        </div>
        <div className="empty" hidden={sessions.length === 0 || shown > 0}>
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
    </SidePanel>
  )
}
