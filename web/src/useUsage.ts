import { useEffect, useState } from 'react'
import type { UsageTotals } from '../../shared/api.ts'

// /usage for the first paint, then /usage-stream; every frame carries the whole sum and `unknown`.
export function useUsage(ids: readonly string[] | null) {
  const key = ids?.join(',') ?? ''
  const [usage, setUsage] = useState<UsageTotals | null>(null)
  const [live, setLive] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setUsage(null)
    setLive(null)
    setError(null)
    if (!key) return
    let alive = true
    let es: EventSource | null = null
    const q = new URLSearchParams({ ids: key })
    void (async () => {
      try {
        const res = await fetch(`/usage?${q}`)
        if (!res.ok) throw new Error(`error ${res.status}`)
        const data = (await res.json()) as UsageTotals
        if (alive) setUsage(data)
      } catch (e) {
        if (alive) setError((e as Error).message)
      }
      if (!alive) return
      es = new EventSource(`/usage-stream?${q}`)
      es.onopen = () => setLive(true)
      es.onerror = () => setLive(false)
      es.onmessage = (m: MessageEvent<string>) => {
        setUsage(JSON.parse(m.data) as UsageTotals)
        setError(null)
      }
    })()
    return () => {
      alive = false
      es?.close()
    }
  }, [key])

  return { usage, unknown: usage?.unknown ?? [], live, error }
}
