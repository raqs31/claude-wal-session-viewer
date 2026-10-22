import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionMeta } from '../../shared/api.ts'
import { effective, toggle as flip, prune, samePick, storedPick } from './lib/pick.ts'
import { advance, type Baselines, isBaselines, unseen } from './lib/unseen.ts'
import { useStoredJson } from './useStoredJson.ts'

const KEY = 'wal.pick'

const parse = (raw: string | null): string[] | null => {
  try {
    return storedPick(JSON.parse(raw ?? 'null'))
  } catch {
    return null
  }
}

// `wanted` is what storage holds and the tabs share; `pick` is what this tab shows (see effective),
// null until the first /sessions lands. Storage is written only by toggle, clear and drop: writing back
// a pruned or fallback pick is what made a tab re-pick the newest session in the other tabs.
export function usePick(sessions: readonly SessionMeta[] | null) {
  const [wanted, setWanted] = useState(() => parse(localStorage.getItem(KEY)))
  const [gone, setGone] = useState<readonly string[]>([])
  const [pick, setPick] = useState<string[] | null>(null)
  const fallback = useRef<string | null>(null)
  // toggle and drop read these, not the render's values: two calls in one JS task would otherwise both
  // start from the same render and the second would undo the first.
  const wantedRef = useRef(wanted)
  const shownRef = useRef<string[] | null>(null)

  const adopt = useCallback((w: string[]) => {
    fallback.current = null
    wantedRef.current = w
    setWanted(w)
  }, [])
  const save = useCallback(
    (w: string[]) => {
      localStorage.setItem(KEY, JSON.stringify(w))
      shownRef.current = w
      adopt(w)
    },
    [adopt],
  )

  useEffect(() => {
    const on = (e: StorageEvent) => {
      const w = e.key === KEY ? parse(e.newValue) : null
      if (w) adopt(w)
    }
    addEventListener('storage', on)
    return () => removeEventListener('storage', on)
  }, [adopt])

  useEffect(() => {
    if (sessions === null) return
    // A frozen fallback that left the list would otherwise stay shown, since nothing re-picks it.
    let f = fallback.current
    if (f !== null && (gone.includes(f) || !sessions.some((s) => s.id === f))) f = null
    const n = effective(wanted, sessions, gone, f)
    fallback.current = wanted === null || (wanted.length && !prune(wanted, sessions, gone).length) ? (n[0] ?? null) : null
    shownRef.current = n
    setPick((p) => (p !== null && samePick(p, n) ? p : n))
  }, [sessions, wanted, gone])

  // For the `unknown` ids a query or stream reports. Keeping the old array spares consumers a requery.
  const forget = useCallback((ids: readonly string[]) => {
    setGone((g) => {
      const add = [...new Set(ids)].filter((id) => !g.includes(id))
      return add.length ? [...g, ...add] : g
    })
  }, [])
  const clear = useCallback(() => save([]), [save])
  const toggle = useCallback((id: string) => save(flip(shownRef.current ?? [], id)), [save])
  // After a trash. Nothing stored stays nothing stored: the newest listed session is shown either way.
  const drop = useCallback(
    (ids: readonly string[]) => {
      const w = wantedRef.current
      if (w !== null) save(w.filter((id) => !ids.includes(id)))
    },
    [save],
  )

  return { pick, toggle, clear, forget, drop }
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
