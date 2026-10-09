import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionList } from '../../shared/api.ts'

const POLL_MS = 5000

// Polled rather than fetched once: live dots, `+N` badges and new sessions all come from here.
export function useSessions() {
  const qgen = useRef(0)
  const [list, setList] = useState<SessionList | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const my = ++qgen.current
    try {
      const res = await fetch('/sessions')
      if (!res.ok) throw new Error(`error ${res.status}`)
      const data = (await res.json()) as SessionList
      if (my === qgen.current) { setList(data); setError(null) }
    } catch (e) {
      if (my === qgen.current) setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => { clearInterval(timer); qgen.current++ }
  }, [refresh])

  return {
    ready: list !== null, sessions: list?.sessions ?? [], sources: list?.sources ?? [], legacy: list?.legacy ?? 0,
    root: list?.sources.map((s) => s.projectsDir).join(' · ') ?? '', refresh, error,
  }
}
