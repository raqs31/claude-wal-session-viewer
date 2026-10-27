import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionMeta, SessionView } from '../../../shared/api.ts'
import { short } from '../lib/format.ts'
import { groupByProject } from '../lib/sidebar.ts'
import type { Observer } from '../useObserver.ts'
import { useSessionViews } from '../useSession.ts'
import { ShareBars } from './charts/ShareBars.tsx'
import { TokensOverTime } from './charts/TokensOverTime.tsx'
import { TurnBars } from './charts/TurnBars.tsx'
import { agentName, ByAgent, ByModel, Totals } from './SessionStats.tsx'
import { buildingNote, StaleBadge } from './StatsHeader.tsx'

const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p

// uPlot keeps a canvas per chart; with many picks only blocks within a viewport of the screen hold
// theirs. Off-screen, a placeholder keeps the last measured height so the scroll position holds.
function Charts({ view }: { view: SessionView }) {
  const el = useRef<HTMLDivElement>(null)
  const height = useRef<number | undefined>(undefined)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const box = el.current
    if (!box) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e) return
        if (!e.isIntersecting) height.current = box.offsetHeight
        setNear(e.isIntersecting)
      },
      { rootMargin: '100% 0px' },
    )
    io.observe(box)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={el} className="charts" style={near ? undefined : { height: height.current ?? 600 }}>
      {near && (
        <>
          <TokensOverTime series={view.series} agent={false} />
          <TurnBars series={view.series} agent={false} />
          <div>
            <ShareBars
              agents={view.stats.agents}
              models={view.stats.models}
              agentOrder={view.agents.map((a) => a.id)}
              agentName={(id) => agentName(view.agents, id)}
            />
          </div>
        </>
      )}
    </div>
  )
}

interface BlockMeta {
  meta: SessionMeta | undefined
  project: { label: string; title: string } | undefined
}

// Memoised: a stream frame replaces one session's view, so only that block re-renders.
const Block = memo(function Block({
  id,
  meta,
  project,
  view,
  unknown,
  building,
  readOnly,
  rebuild,
  onShowEvents,
}: {
  id: string
  meta: SessionMeta | undefined
  project: { label: string; title: string } | undefined
  view: SessionView | undefined
  unknown: boolean
  building: string | null
  readOnly: boolean
  rebuild: Observer['rebuild']
  onShowEvents: (agent: string) => void
}) {
  return (
    <section className="sblock" aria-label={meta?.title || id}>
      <div className="sblock-h">
        <span className="dot" title={meta?.live ? 'live' : 'idle'} style={{ background: meta?.live ? 'var(--cat-session)' : 'var(--grid)' }} />
        <h2 title={meta?.title || id}>{meta?.title || short(id)}</h2>
        {project && (
          <span className="p" title={project.title}>
            {project.label}
          </span>
        )}
        {meta?.workspaces.map((w) => (
          <span key={w} className="badge ws">
            {w}
          </span>
        ))}
        {meta && meta.worktree !== null && <span className="badge wt">{meta.worktree}</span>}
        {view && view.pipe.stale !== null && <StaleBadge stale={[{ id, reason: view.pipe.stale }]} readOnly={readOnly} rebuild={rebuild} />}
        {building && <span className="badge building">{building}</span>}
        <span className="num id" title={id}>
          {short(id)}
        </span>
      </div>
      {view ? (
        <>
          <Totals view={view} />
          <ByModel view={view} />
          <Charts view={view} />
          <ByAgent view={view} firstPrompt={meta?.prompt ?? null} onShowEvents={onShowEvents} />
        </>
      ) : (
        <div className="empty">{unknown ? 'No transcript for this session.' : 'Loading…'}</div>
      )}
    </section>
  )
})

export function SessionsTab({
  ids,
  observer,
  sessions,
  onUnknown,
  onShowEvents,
}: {
  ids: readonly string[]
  observer: Observer
  sessions: SessionMeta[]
  onUnknown: (ids: string[]) => void
  onShowEvents: (agent: string) => void
}) {
  const { views, unknown, live, error } = useSessionViews(ids)
  useEffect(() => {
    if (unknown.length) onUnknown(unknown)
  }, [unknown, onUnknown])
  // Every poll brings fresh objects; a block keeps its previous props until its own row changes,
  // or memo(Block) would re-render (and re-measure) every block every poll.
  const held = useRef(new Map<string, BlockMeta>())
  const props = useMemo(() => {
    const meta = new Map(sessions.map((s) => [s.id, s]))
    // Named as the sidebar names its group, so a worktree session reads as its parent project.
    const project = new Map(
      groupByProject(sessions).flatMap((g) => g.rows.map((r) => [r.id, { label: g.cwd ? base(g.cwd) : g.slug, title: g.cwd ?? g.slug }] as const)),
    )
    const next = new Map<string, BlockMeta>()
    for (const id of ids) {
      const b = { meta: meta.get(id), project: project.get(id) }
      const old = held.current.get(id)
      next.set(id, old && JSON.stringify(old) === JSON.stringify(b) ? old : b)
    }
    held.current = next
    return next
  }, [ids, sessions])

  const building = (id: string): string | null => {
    const v = views[id]
    return v ? buildingNote({ [id]: v.pipe }, new Set(observer.status?.building), [id]) : null
  }
  if (ids.length === 0)
    return (
      <div className="sessions">
        <div className="empty">Pick a session in the sidebar.</div>
      </div>
    )
  return (
    <div className="sessions">
      <div className="filters">
        <span className="spacer" />
        <span className="live">
          <span className="dot" style={live === null ? undefined : { background: live ? 'var(--cat-session)' : 'var(--muted)' }} />
          {error !== null ? `could not load sessions (${error})` : live === null ? 'connecting' : live ? 'live' : 'disconnected'}
        </span>
      </div>
      {ids.map((id) => {
        const p = props.get(id)
        return (
          <Block
            key={id}
            id={id}
            meta={p?.meta}
            project={p?.project}
            view={views[id]}
            unknown={unknown.includes(id)}
            building={building(id)}
            readOnly={observer.status?.owner === false}
            rebuild={observer.rebuild}
            onShowEvents={onShowEvents}
          />
        )
      })}
    </div>
  )
}
