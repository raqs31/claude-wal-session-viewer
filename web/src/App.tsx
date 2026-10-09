import { useEffect, useRef, useState } from 'react'
import { EventsTab } from './components/EventsTab.tsx'
import { LegacyBanner } from './components/LegacyBanner.tsx'
import { SessionsTab } from './components/SessionsTab.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { UsageTiles } from './components/UsageTiles.tsx'
import { EMPTY_FILTERS, type Filters } from './lib/params.ts'
import { FORMATS } from './lib/tree.ts'
import { VIEWS } from './useEvents.ts'
import { usePick, useUnseen } from './usePick.ts'
import { useSessions } from './useSessions.ts'
import { useStored } from './useStored.ts'
import { useUsage } from './useUsage.ts'

const TABS = ['events', 'sessions'] as const
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
  const [path, setPath] = useState('')
  const list = useSessions()
  const rows = list.ready ? list.sessions : null
  const { pick, toggle, clear, forget } = usePick(rows)
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
        unseen={unseen}
        pinned={pin === 'pinned'}
        onPin={() => setPin(pin === 'pinned' ? 'unpinned' : 'pinned')}
        tab={tab}
        onTab={setTab}
      />
      <div className="main">
        <header ref={head}>
          <div>
            <h1>{tab === 'events' ? 'Claude Code event log' : 'Claude Code sessions'}</h1>
            <div className="file" id="file">
              {tab === 'events' ? path : list.root}
            </div>
          </div>
          <span className="spacer" />
          <button className="ghost" id="theme" type="button" onClick={toggleTheme}>
            Toggle theme
          </button>
        </header>
        {/* On Events the tiles ride in the sticky head instead. */}
        {!events && <UsageTiles usage={usage.usage} live={usage.live} error={usage.error} picked={pick?.length ?? 0} />}
        <LegacyBanner count={list.legacy} />
        {pick === null ? (
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
            onPath={setPath}
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
          <SessionsTab ids={pick} sessions={list.sessions} onUnknown={forget} />
        )}
      </div>
    </div>
  )
}
