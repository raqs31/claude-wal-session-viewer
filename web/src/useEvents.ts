import { useCallback, useEffect, useRef, useState } from 'react'
import type { Category, FirstPage, Page, Pipe, RecordedFrame, Row, SessionAgents, StaleFrame, TokensFrame } from '../../shared/api.ts'
import { buildTree } from './lib/agents.ts'
import { buildParams, type Filters, pruneFilters, sameRows } from './lib/params.ts'

export type View = 'tail' | 'table'
export const VIEWS: readonly View[] = ['tail', 'table']
export type Order = 'time' | 'tokens'
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

// Rows indexed over the pick, summed from the per-session counts.
const recorded = (per: RecordedFrame): number => Object.values(per).reduce((n, c) => n + c, 0)

// Below the oldest loaded row (the cursor `next`), where only loadOlder's pages reach.
const below = (next: string | null, r: Pick<Row, 't' | 'sess' | 'seq'>): boolean => {
  if (next === null) return false
  const [t, sess, seq] = next.split('.')
  return cmp(r, { t: Number(t), sess: sess ?? '', seq: Number(seq) }) < 0
}

const key = (r: Pick<Row, 'sess' | 'seq'>): string => `${r.sess}:${r.seq}`

// The server's Time order (`cmp` in scripts/wal-index.ts), which the web bundle cannot import.
const cmp = (a: Pick<Row, 't' | 'sess' | 'seq'>, b: Pick<Row, 't' | 'sess' | 'seq'>): number =>
  a.t - b.t || (a.sess < b.sess ? -1 : a.sess > b.sess ? 1 : 0) || a.seq - b.seq

// A call row lands at its Post but sorts by its Pre time, so a live row can belong above rows already shown.
// `dir` is 1 for rows oldest first (tail), -1 for newest first (table).
const place = (rows: Row[], add: readonly Row[], dir: 1 | -1): Row[] => {
  const out = rows.slice()
  for (const r of add) {
    let lo = 0
    let hi = out.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (dir * cmp(out[mid] as Row, r) < 0) lo = mid + 1
      else hi = mid
    }
    out.splice(lo, 0, r)
  }
  return out
}

const params = (f: Filters, ids: string | null, order: Order): URLSearchParams => {
  const p = buildParams(f, ids ? ids.split(',') : [])
  if (order === 'tokens') p.set('sort', 'tokens')
  return p
}

export function useEvents(filters: Filters, view: View, ids: readonly string[] | null, order: Order) {
  const filtersRef = useRef(filters)
  filtersRef.current = filters
  const pick = ids === null ? null : ids.join(',')
  const pickRef = useRef<string | null>(pick)
  pickRef.current = pick
  const viewRef = useRef(view)
  viewRef.current = view
  const orderRef = useRef(order)
  orderRef.current = order
  const s = useRef({
    qgen: 0,
    pick: '',
    gens: '',
    sent: '',
    next: null as string | null,
    // `sess:seq` of every row the query has shown or holds, so a stream row sent twice is dropped.
    seen: new Set<string>(),
    // Stream rows left to loadOlder; one its page did not return is placed when the cursor passes it.
    deferred: [] as Row[],
    loading: false,
    es: null as EventSource | null,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  }).current

  // Pending live rows sit beside the shown ones so a flush moves both in one update.
  const [list, setList] = useState<{ rows: Row[]; pending: Row[] }>({ rows: [], pending: [] })
  const [qid, setQid] = useState(0)
  const [gens, setGens] = useState<Record<string, number> | null>(null)
  const [stats, setStats] = useState<Stats>({ total: 0, head: 0, counts: {}, spans: {} })
  const [tools, setTools] = useState<string[]>([])
  const [events, setEvents] = useState<string[]>([])
  const [cats, setCats] = useState<Category[]>([])
  const [agents, setAgents] = useState<SessionAgents[]>([])
  const [unknown, setUnknown] = useState<string[]>([])
  const [pipe, setPipe] = useState<Record<string, Pipe>>({})
  // Reasons from `event: stale` frames since the last first page.
  const [stale, setStale] = useState<Record<string, string>>({})
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
      setPipe({})
      setStale({})
      setStats({ total: 0, head: 0, counts: {}, spans: {} })
      setNext(null)
      setReady(false)
    }
    const f = filtersRef.current
    const order = orderRef.current
    const p = params(f, ids, order)
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
    if (sameRows(f, kept)) s.sent = params(kept, ids, order).toString()
    setGens(data.gens)
    setQid(my)
    setNext(data.next)
    setStats({ total: data.total, head: recorded(data.recorded), counts: data.counts, spans: data.spans })
    setTools((ts) => (same(ts, data.tools) ? ts : data.tools))
    setEvents((es) => (same(es, data.events) ? es : data.events))
    setCats((cs) => (same(cs, data.cats) ? cs : data.cats))
    // The facet ignores the filter, so each first page's tree replaces the last.
    setAgents(data.agents)
    setUnknown(data.unknown)
    setPipe(data.pipe)
    setStale({})
    s.seen = new Set(data.rows.map(key))
    s.deferred = []
    // Tokens order lists the server's order top-down in both views.
    setList({ rows: order === 'time' && viewRef.current === 'tail' ? data.rows.reverse() : data.rows, pending: [] })
    setError(null)
    setReady(true)
    setChange({ kind: 'first' })
    setPages((n) => n + 1)

    // The server refuses a Tokens-order stream: a new row has no place in a ranked list.
    if (order === 'tokens') {
      setLive(false)
      return
    }
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
    es.addEventListener('stale', (m) => {
      if (my !== s.qgen) return
      const f = JSON.parse((m as MessageEvent<string>).data) as StaleFrame
      setStale((st) => ({ ...st, [f.sess]: f.reason }))
    })
    es.addEventListener('recorded', (m) => {
      if (my !== s.qgen) return
      const head = recorded(JSON.parse((m as MessageEvent<string>).data) as RecordedFrame)
      setStats((st) => ({ ...st, head }))
    })
    es.addEventListener('tokens', (m) => {
      if (my !== s.qgen) return
      const patch = new Map((JSON.parse((m as MessageEvent<string>).data) as TokensFrame[]).map((x) => [key(x), x]))
      const apply = (rows: Row[]): Row[] => {
        if (!rows.some((r) => patch.has(key(r)))) return rows
        return rows.map((r) => {
          const x = patch.get(key(r))
          return x ? { ...r, ...x } : r
        })
      }
      setList((l) => ({ rows: apply(l.rows), pending: apply(l.pending) }))
    })
    es.onmessage = (m: MessageEvent<string>) => {
      if (my !== s.qgen) return
      const all = (JSON.parse(m.data) as Row[]).filter((r) => !s.seen.has(key(r)))
      // A late row below the oldest loaded one is left to loadOlder, whose page holds it at its place.
      const rows = all.filter((r) => !below(s.next, r))
      s.deferred.push(...all.filter((r) => below(s.next, r)))
      for (const r of rows) s.seen.add(key(r))
      setStats((st) => {
        const counts = { ...st.counts }
        const spans = { ...st.spans }
        for (const r of all) {
          counts[r.cat] = (counts[r.cat] || 0) + 1
          // Min and max, not append: a folded-in legacy line can be older than the rows before it.
          const b = spans[r.sess]
          spans[r.sess] = b ? [Math.min(b[0], r.t), Math.max(b[1], r.t)] : [r.t, r.t]
        }
        return { total: st.total + all.length, head: st.head, counts, spans }
      })
      setTools((ts) =>
        grow(
          ts,
          all.map((r) => r.tool),
        ),
      )
      setEvents((es) =>
        grow(
          es,
          all.map((r) => r.event ?? null),
        ),
      )
      setCats(
        (cs) =>
          grow(
            cs,
            all.map((r) => r.cat),
          ) as Category[],
      )
      // The table decides after the commit whether these show at once (following) or wait.
      if (rows.length) setList((l) => ({ ...l, pending: [...l.pending, ...rows] }))
    }
  }, [s])

  const loadOlder = useCallback(async (): Promise<void> => {
    if (s.loading || s.next === null) return
    s.loading = true
    const my = s.qgen
    const order = orderRef.current
    const p = params(filtersRef.current, pickRef.current, order)
    p.set('before', String(s.next))
    try {
      const data = (await (await fetch(`/events?${p}`)).json()) as Page
      if (my !== s.qgen) return
      if (JSON.stringify(data.gens) !== s.gens) return void query()
      s.next = data.next
      setNext(data.next)
      for (const r of data.rows) s.seen.add(key(r))
      // A row that arrived while this page was in flight sat below the old cursor; if the page missed it, it is due now.
      const open = s.deferred.filter((r) => !s.seen.has(key(r)))
      const late = open.filter((r) => !below(s.next, r))
      s.deferred = open.filter((r) => below(s.next, r))
      for (const r of late) s.seen.add(key(r))
      if (order === 'time' && viewRef.current === 'tail') {
        const older = data.rows.reverse()
        setList((l) => ({ ...l, rows: [...older, ...l.rows] }))
        setChange({ kind: 'older', h: document.documentElement.scrollHeight })
      } else setList((l) => ({ ...l, rows: [...l.rows, ...data.rows] }))
      // Tokens order has no stream, so `late` is empty there.
      if (late.length) setList((l) => ({ ...l, rows: place(l.rows, late, viewRef.current === 'tail' ? 1 : -1) }))
    } finally {
      s.loading = false
      setPages((n) => n + 1)
    }
  }, [s, query])

  const flush = useCallback((kind: 'live' | 'flush') => {
    setList((l) => ({ rows: place(l.rows, l.pending, viewRef.current === 'tail' ? 1 : -1), pending: [] }))
    setError(null)
    setChange({ kind })
  }, [])

  const started = useRef(false)
  useEffect(() => {
    if (!started.current) return
    clearTimeout(s.timer)
    if (params(filters, pickRef.current, orderRef.current).toString() === s.sent) return
    s.timer = setTimeout(() => void query(), 250)
  }, [filters, s, query])
  // query reads view and pick through refs, so requery and the stream's reset see the latest too.
  // biome-ignore lint/correctness/useExhaustiveDependencies(view): re-run trigger, a new view needs a fresh first page.
  // biome-ignore lint/correctness/useExhaustiveDependencies(pick): re-run trigger, a new pick needs a fresh first page.
  // biome-ignore lint/correctness/useExhaustiveDependencies(order): re-run trigger, a new order needs a fresh first page.
  useEffect(() => {
    if (started.current) void query()
  }, [view, pick, order, query])
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
    tools,
    events,
    cats,
    agents,
    unknown,
    pipe,
    stale,
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
