import { useCallback, useEffect, useState } from 'react'
import type { SessionMeta } from '../../shared/api.ts'
import { prune, samePick, settlePick, toggle as flip } from './lib/pick.ts'
import { advance, isBaselines, unseen, type Baselines } from './lib/unseen.ts'
import { useStoredJson } from './useStoredJson.ts'

// null until the first /sessions landed and the newest session was preselected; afterwards the pick
// only shrinks by pruning and may become empty (empty = all sessions). Nothing is persisted.
export function usePick(sessions: readonly SessionMeta[] | null) {
  const [pick, setPick] = useState<string[] | null>(null)

  useEffect(() => {
    if (sessions === null) return
    setPick((p) => {
      const n = settlePick(p, sessions)
      return p !== null && samePick(p, n) ? p : n
    })
  }, [sessions])

  // For the `unknown` ids a query or stream reports. Keeping the old array spares consumers a requery.
  const forget = useCallback(
    (ids: readonly string[]) => {
      if (ids.length && sessions !== null) {
        setPick((p) => {
          if (p === null) return p
          const n = prune(p, sessions, ids)
          return samePick(p, n) ? p : n
        })
      }
    },
    [sessions],
  )
  const clear = useCallback(() => setPick([]), [])
  const toggle = useCallback((id: string) => setPick((p) => flip(p ?? [], id)), [])

  return { pick, toggle, clear, forget }
}

const visible = () => document.visibilityState === 'visible'

// `+N` per session; picked sessions are marked seen while the page is visible.
export function useUnseen(sessions: readonly SessionMeta[] | null, pick: readonly string[]) {
  const [seen, setSeen] = useStoredJson<Baselines>('wal.seen', isBaselines, {})
  const [shown, setShown] = useState(visible)
  useEffect(() => {
    const on = () => setShown(visible())
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  useEffect(() => {
    if (sessions !== null) setSeen((b) => advance(b, shown ? pick : [], sessions))
  }, [sessions, pick, shown, setSeen])

  return useCallback((row: SessionMeta) => unseen(row, seen[row.id]), [seen])
}
