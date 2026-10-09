import { useEffect, useRef, useState } from 'react'
import type { SessionSeries, SessionView } from '../../shared/api.ts'

// Scope-all views of every picked session over one multiplexed /session-stream. A 404 on the
// first fetch counts as unknown, like the stream's own `event: unknown`. A pick change fetches
// only the added ids; the views already held stay shown and seed the reopened stream's `since`.
export function useSessionViews(ids: readonly string[]) {
  const key = ids.join(',')
  const [views, setViews] = useState<Record<string, SessionView>>({})
  const [unknown, setUnknown] = useState<string[]>([])
  const [live, setLive] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const held = useRef({ views, unknown })
  held.current = { views, unknown }

  useEffect(() => {
    const want = key ? key.split(',') : []
    const keep = <T,>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).filter(([id]) => want.includes(id)))
    const kept = keep(held.current.views)
    const add = want.filter((id) => !(id in kept) && !held.current.unknown.includes(id))
    setViews(kept); setUnknown((u) => u.filter((id) => want.includes(id))); setError(null)
    if (!key) return void setLive(null)
    let alive = true
    let es: EventSource | null = null
    void (async () => {
      const got: Record<string, SessionView> = {}
      const missing: string[] = []
      await Promise.all(add.map(async (id) => {
        try {
          const res = await fetch('/session?' + new URLSearchParams({ id, scope: 'all' }))
          if (res.status === 404) return void missing.push(id)
          if (!res.ok) throw new Error(`error ${res.status}`)
          got[id] = (await res.json()) as SessionView
        } catch (e) {
          if (alive) setError((e as Error).message)
        }
      }))
      if (!alive) return
      if (add.length) { setViews((vs) => ({ ...vs, ...got })); setUnknown((u) => [...u, ...missing]) }
      // Frames for kept ids stopped when the previous stream closed; their versions make the
      // server resend whatever changed in between.
      const since = Object.values({ ...keep(held.current.views), ...got }).map((v) => `${v.id}:${v.version}`).join(',')
      es = new EventSource('/session-stream?' + new URLSearchParams(since ? { ids: key, since } : { ids: key }))
      es.onopen = () => setLive(true)
      es.onerror = () => setLive(false)
      es.addEventListener('unknown', (m) => setUnknown(JSON.parse((m as MessageEvent<string>).data) as string[]))
      es.onmessage = (m: MessageEvent<string>) => {
        const v = JSON.parse(m.data) as SessionView
        setViews((vs) => ({ ...vs, [v.id]: v })); setError(null)
      }
    })()
    return () => { alive = false; es?.close() }
  }, [key])

  return { views, unknown, live, error }
}

// One agent's own series, fetched when its row opens. A `stamp` change (a live agent made another
// call, or a streaming snapshot updated one in place, which the request count alone misses)
// refetches but keeps the old charts up; only a new sess/agent blanks them.
export function useAgentSeries(sess: string, agent: string, stamp: string) {
  const [series, setSeries] = useState<SessionSeries | null>(null)
  const [error, setError] = useState<string | null>(null)
  const last = useRef('')

  useEffect(() => {
    const key = `${sess}\n${agent}`
    if (last.current !== key) { last.current = key; setSeries(null) }
    const ctrl = new AbortController()
    void (async () => {
      try {
        const res = await fetch('/session?' + new URLSearchParams({ id: sess, scope: `agent:${agent}` }), { signal: ctrl.signal })
        if (!res.ok) throw new Error(`error ${res.status}`)
        const v = (await res.json()) as SessionView
        setSeries(v.series)
        setError(null)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message)
      }
    })()
    return () => ctrl.abort()
  }, [sess, agent, stamp])

  return { series, error }
}
