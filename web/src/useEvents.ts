import { useCallback, useEffect, useRef, useState } from 'react'
import type { Category, FirstPage, Page, Row, SessionAgents } from '../../shared/api.ts'
import { buildTree } from './lib/agents.ts'
import { buildParams, type Filters, pruneFilters, sameRows } from './lib/params.ts'

export type View = 'tail' | 'table'
export const VIEWS: readonly View[] = ['tail', 'table']
// How the rows last changed, so the table can place the view after the commit. `h` is the
// document height before an older page was prepended.
export type Change = { kind: 'first' | 'live' | 'flush' } | { kind: 'older'; h: number }
export interface Stats {
  total: number
  head: number
  counts: Partial<Record<Category, number>>
  spans: FirstPage['spans']
}

// Stream rows grow a facet in first-seen order within one query; each first page replaces it.
// Unchanged lists keep their identity.
const grow = (xs: string[], add: readonly (string | null)[]): string[] => {
  let out = xs
  for (const x of add) if (x !== null && !out.includes(x)) out = [...out, x]
  return out
}

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

// Rows indexed over the pick, summed from a `<sess>:<n>,…` position vector.
const recorded = (head: string): number => head.split(',').reduce((n, part) => n + (Number(part.split(':')[1]) || 0), 0)

export function useEvents(filters: Filters, view: View, ids: readonly string[] | null) {
  const filtersRef = useRef(filters)
  filtersRef.current = filters
  const pick = ids === null ? null : ids.join(',')
  const pickRef = useRef<string | null>(pick)
  pickRef.current = pick
  const viewRef = useRef(view)
  viewRef.current = view
  const s = useRef({
    qgen: 0,
    pick: '',
    gens: '',
    sent: '',
    next: null as string | null,
    loading: false,
    es: null as EventSource | null,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  }).current

  // Pending live rows sit beside the shown ones so a flush moves both in one update.
  const [list, setList] = useState<{ rows: Row[]; pending: Row[] }>({ rows: [], pending: [] })
  const [qid, setQid] = useState(0)
  const [gens, setGens] = useState<Record<string, number> | null>(null)
  const [stats, setStats] = useState<Stats>({ total: 0, head: 0, counts: {}, spans: {} })
  const [file, setFile] = useState('')
  const [tools, setTools] = useState<string[]>([])
  const [events, setEvents] = useState<string[]>([])
  const [cats, setCats] = useState<Category[]>([])
  const [agents, setAgents] = useState<SessionAgents[]>([])
  const [unknown, setUnknown] = useState<string[]>([])
  const [live, setLive] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [next, setNext] = useState<string | null>(null)
  const [pages, setPages] = useState(0)
  const [change, setChange] = useState<Change | null>(null)

  const query = useCallback(async (): Promise<void> => {
    clearTimeout(s.timer)
    const my = ++s.qgen
    s.es?.close()
    s.es = null
    // Cleared now, not when the page lands: a page load started in between would pair the old
    // cursor with the new filter.
    s.next = null
    const ids = pickRef.current
    if (ids === null) return
    // A failed request after a pick change must not leave the old pick's rows and chips on screen.
    if (ids !== s.pick) {
      s.pick = ids
      setList({ rows: [], pending: [] })
      setTools([])
      setEvents([])
      setCats([])
      setAgents([])
      setStats({ total: 0, head: 0, counts: {}, spans: {} })
      setNext(null)
      setReady(false)
    }
    const f = filtersRef.current
    const p = buildParams(f, ids ? ids.split(',') : [])
    s.sent = p.toString()
    let data: FirstPage
    try {
      const res = await fetch(`/events?${p}`)
      if (!res.ok) throw new Error(`error ${res.status}`)
      data = (await res.json()) as FirstPage
    } catch (e) {
      if (my !== s.qgen) return
      s.sent = ''
      setLive(false)
      setError((e as Error).message)
      return
    }
    if (my !== s.qgen) return
    s.gens = JSON.stringify(data.gens)
    s.next = data.next
    // The facets list every value of the pick whatever the filter, so dropping values they lack (as
    // EventsTab does after a pick change) selects the same rows, unless a set empties: an empty set means no filter.
    const kept = pruneFilters(f, { tools: data.tools, events: data.events, cats: data.cats, agents: buildTree(data.agents) })
    if (sameRows(f, kept)) s.sent = buildParams(kept, ids ? ids.split(',') : []).toString()
    setGens(data.gens)
    setQid(my)
    setNext(data.next)
    setFile(Object.keys(data.gens).join(' · '))
    setStats({ total: data.total, head: recorded(data.head), counts: data.counts, spans: data.spans })
    setTools((ts) => (same(ts, data.tools) ? ts : data.tools))
    setEvents((es) => (same(es, data.events) ? es : data.events))
    setCats((cs) => (same(cs, data.cats) ? cs : data.cats))
    // The facet ignores the filter, so each first page's tree replaces the last.
    setAgents(data.agents)
    setUnknown(data.unknown)
    setList({ rows: viewRef.current === 'tail' ? data.rows.reverse() : data.rows, pending: [] })
    setError(null)
    setReady(true)
    setChange({ kind: 'first' })
    setPages((n) => n + 1)

    p.set('after', data.head)
    p.set(
      'gens',
      Object.entries(data.gens)
        .map(([id, g]) => `${id}:${g}`)
        .join(','),
    )
    const es = new EventSource(`/events-stream?${p}`)
    s.es = es
    es.onopen = () => setLive(true)
    es.onerror = () => setLive(false)
    // The server sends nothing after a reset but leaves the socket open, so it must be closed here.
    es.addEventListener('unknown', (m) => {
      if (my === s.qgen) setUnknown(JSON.parse((m as MessageEvent<string>).data) as string[])
    })
    es.addEventListener('reset', () => {
      es.close()
      if (my === s.qgen) void query()
    })
    es.onmessage = (m: MessageEvent<string>) => {
      if (my !== s.qgen) return
      const rows = JSON.parse(m.data) as Row[]
      setStats((st) => {
        const counts = { ...st.counts }
        const spans = { ...st.spans }
        for (const r of rows) {
          counts[r.cat] = (counts[r.cat] || 0) + 1
          // Min and max, not append: a folded-in legacy line can be older than the rows before it.
          const b = spans[r.sess]
          spans[r.sess] = b ? [Math.min(b[0], r.t), Math.max(b[1], r.t)] : [r.t, r.t]
        }
        return { total: st.total + rows.length, head: recorded(m.lastEventId), counts, spans }
      })
      setTools((ts) =>
        grow(
          ts,
          rows.map((r) => r.tool),
        ),
      )
      setEvents((es) =>
        grow(
          es,
          rows.map((r) => r.event ?? null),
        ),
      )
      setCats(
        (cs) =>
          grow(
            cs,
            rows.map((r) => r.cat),
          ) as Category[],
      )
      // The table decides after the commit whether these show at once (following) or wait.
      setList((l) => ({ ...l, pending: [...l.pending, ...rows] }))
    }
  }, [s])

  const loadOlder = useCallback(async (): Promise<void> => {
    if (s.loading || s.next === null) return
    s.loading = true
    const my = s.qgen
    const ids = pickRef.current
    const p = buildParams(filtersRef.current, ids ? ids.split(',') : [])
    p.set('before', String(s.next))
    try {
      const data = (await (await fetch(`/events?${p}`)).json()) as Page
      if (my !== s.qgen) return
      if (JSON.stringify(data.gens) !== s.gens) return void query()
      s.next = data.next
      setNext(data.next)
      if (viewRef.current === 'tail') {
        const older = data.rows.reverse()
        setList((l) => ({ ...l, rows: [...older, ...l.rows] }))
        setChange({ kind: 'older', h: document.documentElement.scrollHeight })
      } else setList((l) => ({ ...l, rows: [...l.rows, ...data.rows] }))
    } finally {
      s.loading = false
      setPages((n) => n + 1)
    }
  }, [s, query])

  // Stream rows arrive oldest first.
  const flush = useCallback((kind: 'live' | 'flush') => {
    setList((l) => ({
      rows: viewRef.current === 'tail' ? [...l.rows, ...l.pending] : [...l.pending.slice().reverse(), ...l.rows],
      pending: [],
    }))
    setError(null)
    setChange({ kind })
  }, [])

  const started = useRef(false)
  useEffect(() => {
    if (!started.current) return
    clearTimeout(s.timer)
    if (buildParams(filters, pickRef.current ? pickRef.current.split(',') : []).toString() === s.sent) return
    s.timer = setTimeout(() => void query(), 250)
  }, [filters, s, query])
  // query reads view and pick through refs, so requery and the stream's reset see the latest too.
  // biome-ignore lint/correctness/useExhaustiveDependencies(view): re-run trigger, a new view needs a fresh first page.
  // biome-ignore lint/correctness/useExhaustiveDependencies(pick): re-run trigger, a new pick needs a fresh first page.
  useEffect(() => {
    if (started.current) void query()
  }, [view, pick, query])
  useEffect(() => {
    started.current = true
    void query()
    return () => {
      clearTimeout(s.timer)
      s.es?.close()
      s.qgen++
    }
  }, [s, query])

  return {
    rows: list.rows,
    pending: list.pending,
    ...stats,
    qid,
    gens,
    file,
    tools,
    events,
    cats,
    agents,
    unknown,
    live,
    error,
    ready,
    next,
    pages,
    change,
    loadOlder,
    flush,
    requery: query,
  }
}
