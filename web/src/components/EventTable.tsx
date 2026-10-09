import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Row } from '../../../shared/api.ts'
import type { Format } from '../lib/tree.ts'
import type { Change, View } from '../useEvents.ts'
import { EventRow } from './EventRow.tsx'

interface Props {
  rows: Row[]
  pending: Row[]
  view: View
  follow: boolean
  ready: boolean
  next: string | null
  pages: number
  change: Change | null
  qid: number
  gens: Record<string, number> | null
  format: Format
  loadOlder: () => Promise<void>
  flush: (kind: 'live' | 'flush') => void
  requery: () => Promise<void>
}

export function EventTable({ rows, pending, view, follow, ready, next, pages, change, qid, gens, format, loadOlder, flush, requery }: Props) {
  const tbody = useRef<HTMLTableSectionElement>(null)
  const thead = useRef<HTMLTableSectionElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const io = useRef<IntersectionObserver>(null)
  const tail = view === 'tail'

  const atEdge = () =>
    tail
      ? innerHeight + scrollY >= document.documentElement.scrollHeight - 40
      : tbody.current!.getBoundingClientRect().top > thead.current!.getBoundingClientRect().bottom - 40
  const toEdge = () => scrollTo(0, tail ? document.documentElement.scrollHeight : 0)
  const latest = useRef({ follow, pending, atEdge })
  latest.current = { follow, pending, atEdge }

  // Runs before paint, so neither a prepended page nor a live row is ever drawn at the wrong offset.
  useLayoutEffect(() => {
    if (!change) return
    if (change.kind === 'older') scrollBy(0, document.documentElement.scrollHeight - change.h)
    else if (change.kind !== 'live' || tail) toEdge()
  }, [change])
  // Live rows land in `pending`; they are shown at once only when following at the edge.
  useLayoutEffect(() => {
    if (follow && pending.length && atEdge()) flush('live')
  }, [pending])
  useEffect(() => {
    if (follow && pending.length && atEdge()) flush('flush')
  }, [follow])
  useEffect(() => {
    const onScroll = () => {
      const l = latest.current
      if (l.follow && l.pending.length && l.atEdge()) {
        l.pending = []
        flush('flush')
      }
    }
    addEventListener('scroll', onScroll, { passive: true })
    return () => removeEventListener('scroll', onScroll)
  }, [flush])

  useEffect(() => {
    const o = (io.current = new IntersectionObserver(
      (es) => {
        if (es[0]?.isIntersecting) void loadOlder()
      },
      { rootMargin: '300px' },
    ))
    return () => o.disconnect()
  }, [loadOlder])
  // Re-observing reports the current intersection again, so a sentinel still on screen after a
  // short page keeps loading.
  useEffect(() => {
    const o = io.current,
      s = sentinel.current
    if (!o || !s) return
    o.disconnect()
    o.observe(s)
  }, [pages, view])

  const sentinelEl = <div id="sentinel" ref={sentinel} hidden={next === null} />
  return (
    <>
      {tail && sentinelEl}
      <table id="table">
        <thead ref={thead}>
          <tr>
            <th style={{ width: '110px' }}>Date</th>
            <th style={{ width: '120px' }}>Time</th>
            <th style={{ width: '230px' }}>Event</th>
            <th style={{ width: '150px' }}>Tool</th>
            <th style={{ width: '90px' }}>Duration</th>
            <th>Session</th>
          </tr>
        </thead>
        <tbody id="rows" ref={tbody}>
          {rows.map((r) => (
            <EventRow key={`${qid}:${r.sess}:${r.seq}`} r={r} gens={gens} format={format} requery={requery} />
          ))}
        </tbody>
      </table>
      {!tail && sentinelEl}
      <div className="empty" id="empty" hidden={!ready || rows.length + pending.length > 0}>
        No events match this filter.
      </div>
      <button className={`pill ${view}`} id="pill" type="button" hidden={pending.length === 0} onClick={() => flush('flush')}>
        {`${tail ? '↓' : '↑'} ${pending.length} new`}
      </button>
    </>
  )
}
