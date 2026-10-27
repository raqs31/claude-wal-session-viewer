import { useCallback, useEffect, useRef, useState } from 'react'
import { EventsTab } from './components/EventsTab.tsx'
import { LegacyBanner } from './components/LegacyBanner.tsx'
import { SessionsTab } from './components/SessionsTab.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { TrashTab } from './components/TrashTab.tsx'
import { UsageTiles } from './components/UsageTiles.tsx'
import { EMPTY_FILTERS, type Filters } from './lib/params.ts'
import { FORMATS } from './lib/tree.ts'
import { type Order, VIEWS } from './useEvents.ts'
import { useObserver } from './useObserver.ts'
import { usePick, useUnseen } from './usePick.ts'
import { useSessions } from './useSessions.ts'
import { useStored } from './useStored.ts'
import { useUsage } from './useUsage.ts'

const TABS = ['events', 'sessions', 'trash'] as const
const PINS = ['pinned', 'unpinned'] as const

const NONE: readonly string[] = []

const toggleTheme = () => {
  const r = document.documentElement
  r.dataset.theme = r.dataset.theme === 'dark' ? 'light' : 'dark'
}

export function App() {
  const [tab, setTab] = useStored('wal.tab', TABS, 'events')
  const [view, setView] = useStored('wal.view', VIEWS, 'tail')
  const [format, setFormat] = useStored('wal.format', FORMATS, 'json')
  const [pin, setPin] = useStored('wal.pin', PINS, 'pinned')
  const [fpin, setFpin] = useStored('wal.fpin', PINS, 'unpinned')
  // Held here rather than in the tabs, which unmount on a switch, so filters and follow survive one.
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [follow, setFollow] = useState(true)
  // Not stored: a reload comes back in Time order with Live on.
  const [order, setOrder] = useState<Order>('time')
  const showEvents = useCallback(
    (agent: string) => {
      setFilters({ ...EMPTY_FILTERS, agent: new Set([agent]) })
      setTab('events')
    },
    [setTab],
  )
  const list = useSessions()
  const observer = useObserver()
  const obs = observer.status
  // Bumped by a sidebar move so an open Trash tab refetches; the tab stays mounted, keeping its note and selection.
  const [trashGen, setTrashGen] = useState(0)
  const rows = list.ready ? list.sessions : null
  const { pick, toggle, clear, forget, drop } = usePick(rows, list.listedAt)
  const unseen = useUnseen(rows, pick ?? NONE)
  // null until the first list lands and the newest session is preselected, so no hook queries all sessions on startup.
  const ids = pick
  const usage = useUsage(ids)
  useEffect(() => forget(usage.unknown), [usage.unknown, forget])
  const head = useRef<HTMLElement>(null)
  // The sticky Events head, its table header and the table pill sit below the sticky header.
  useEffect(() => {
    const h = head.current
    if (!h) return
    const o = new ResizeObserver(() => document.documentElement.style.setProperty('--head-h', `${h.offsetHeight}px`))
    o.observe(h)
    return () => o.disconnect()
  }, [])
  const events = pick !== null && tab === 'events'

  return (
    <div className="viz-root" data-pin={pin} data-fpin={events ? fpin : undefined}>
      <Sidebar
        sessions={list.sessions}
        ready={list.ready}
        error={list.error}
        root={list.root}
        pick={pick ?? NONE}
        toggle={toggle}
        clear={clear}
        drop={drop}
        refresh={() => {
          setTrashGen((g) => g + 1)
          return list.refresh()
        }}
        unseen={unseen}
        pinned={pin === 'pinned'}
        onPin={() => setPin(pin === 'pinned' ? 'unpinned' : 'pinned')}
        tab={tab}
        onTab={setTab}
      />
      <div className="main">
        <header ref={head}>
          <div>
            <h1>{tab === 'events' ? 'Claude Code event log' : tab === 'sessions' ? 'Claude Code sessions' : 'Claude Code trash'}</h1>
            {tab === 'sessions' && (
              <div className="file" id="file">
                {list.root}
              </div>
            )}
          </div>
          <span className="spacer" />
          {obs !== null && !obs.owner && obs.elsewhere > 0 ? (
            <span className="badge pipe" id="pipechip">
              read-only — another viewer owns the cache
            </span>
          ) : (
            obs !== null &&
            obs.building.length > 0 && (
              <span className="badge pipe" id="pipechip">
                Indexing {obs.built.toLocaleString()}/{obs.total.toLocaleString()}
              </span>
            )
          )}
          <button className="ghost" id="theme" type="button" onClick={toggleTheme}>
            Toggle theme
          </button>
        </header>
        {/* On Events the tiles ride in the sticky head instead. */}
        {!events && tab !== 'trash' && <UsageTiles usage={usage.usage} live={usage.live} error={usage.error} picked={pick?.length ?? 0} />}
        <LegacyBanner count={list.legacy} />
        {tab === 'trash' ? (
          <TrashTab refreshSessions={list.refresh} gen={trashGen} />
        ) : pick === null ? (
          <div className="empty">Loading sessions…</div>
        ) : tab === 'events' ? (
          <EventsTab
            filters={filters}
            setFilters={setFilters}
            view={view}
            setView={setView}
            format={format}
            setFormat={setFormat}
            follow={follow}
            setFollow={setFollow}
            order={order}
            setOrder={setOrder}
            observer={observer}
            ids={ids}
            onUnknown={forget}
            sessions={list.sessions}
            usage={usage.usage}
            usageLive={usage.live}
            usageError={usage.error}
            picked={pick.length}
            fpinned={fpin === 'pinned'}
            onFpin={() => setFpin(fpin === 'pinned' ? 'unpinned' : 'pinned')}
          />
        ) : (
          <SessionsTab ids={pick} observer={observer} sessions={list.sessions} onUnknown={forget} onShowEvents={showEvents} />
        )}
      </div>
    </div>
  )
}
