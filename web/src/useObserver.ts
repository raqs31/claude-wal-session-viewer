import { useCallback, useEffect, useState } from 'react'
import type { ObserverStatus, RebuildResult } from '../../shared/api.ts'

const BUSY_MS = 2000
const IDLE_MS = 10000

// /observer every 2 s while a target is still building, every 10 s once all are caught up.
export function useObserver() {
  const [status, setStatus] = useState<ObserverStatus | null>(null)
  // Bumped to poll at once, e.g. after a rebuild.
  const [kick, setKick] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies(kick): re-run trigger, restarts the poll loop now.
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      let wait = IDLE_MS
      try {
        const res = await fetch('/observer')
        if (!res.ok) throw new Error(`error ${res.status}`)
        const s = (await res.json()) as ObserverStatus
        if (!alive) return
        setStatus(s)
        if (s.building.length) wait = BUSY_MS
      } catch {
        if (!alive) return
      }
      timer = setTimeout(() => void poll(), wait)
    }
    void poll()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [kick])

  // Resolves to an error text, or null when every id was rebuilt.
  const rebuild = useCallback(async (ids: readonly string[]): Promise<string | null> => {
    try {
      const res = await fetch('/rebuild', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      if (!res.ok) throw new Error(`error ${res.status}`)
      const failed = ((await res.json()) as { results: RebuildResult[] }).results.filter((r) => !r.ok)
      return failed.length ? failed.map((r) => r.error ?? 'failed').join('; ') : null
    } catch (e) {
      return (e as Error).message
    } finally {
      setKick((n) => n + 1)
    }
  }, [])

  return { status, rebuild }
}

export type Observer = ReturnType<typeof useObserver>
