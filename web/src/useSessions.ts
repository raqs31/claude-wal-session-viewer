import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionList } from '../../shared/api.ts'

const POLL_MS = 5000

// Polled rather than fetched once: live dots, `+N` badges and new sessions all come from here.
export function useSessions() {
  const qgen = useRef(0)
  // `at`: when the request that returned `list` started, so usePick can tell a list that predates a trash.
  const [list, setList] = useState<{ list: SessionList; at: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const my = ++qgen.current
    const at = Date.now()
    try {
      const res = await fetch('/sessions')
      if (!res.ok) throw new Error(`error ${res.status}`)
      const data = (await res.json()) as SessionList
      if (my === qgen.current) {
        setList({ list: data, at })
        setError(null)
      }
    } catch (e) {
      if (my === qgen.current) setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => {
      clearInterval(timer)
      qgen.current++
    }
  }, [refresh])

  return {
    ready: list !== null,
    listedAt: list?.at ?? null,
    sessions: list?.list.sessions ?? [],
    sources: list?.list.sources ?? [],
    legacy: list?.list.legacy ?? 0,
    root: list?.list.sources.map((s) => s.projectsDir).join(' · ') ?? '',
    refresh,
    error,
  }
}
