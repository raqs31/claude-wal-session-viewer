import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionMeta } from '../../shared/api.ts'
import { effective, toggle as flip, prune, revive, samePick, storedPick } from './lib/pick.ts'
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
export function usePick(sessions: readonly SessionMeta[] | null, listedAt: number | null) {
  const [wanted, setWanted] = useState(() => parse(localStorage.getItem(KEY)))
  const [gone, setGone] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [pick, setPick] = useState<string[] | null>(null)
  const fallback = useRef<string | null>(null)
  // toggle and drop read these, not the render's values: two calls in one JS task would otherwise both
  // start from the same render and the second would undo the first.
  const wantedRef = useRef(wanted)
  const shownRef = useRef<string[] | null>(null)

  const adopt = useCallback((w: string[] | null) => {
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
      if (e.key !== KEY) return
      // Another tab's drop emptied the pick: show the newest session here too, not the old pick.
      if (e.newValue === null) return adopt(null)
      const w = parse(e.newValue)
      if (w) adopt(w)
    }
    addEventListener('storage', on)
    return () => removeEventListener('storage', on)
  }, [adopt])

  useEffect(() => {
    if (sessions === null || listedAt === null) return
    const back = revive(gone, sessions, listedAt)
    if (back !== gone) return setGone(back)
    const ids = [...gone.keys()]
    // A frozen fallback that left the list would otherwise stay shown, since nothing re-picks it.
    let f = fallback.current
    if (f !== null && (ids.includes(f) || !sessions.some((s) => s.id === f))) f = null
    const n = effective(wanted, sessions, ids, f)
    fallback.current = wanted === null || (wanted.length && !prune(wanted, sessions, ids).length) ? (n[0] ?? null) : null
    shownRef.current = n
    setPick((p) => (p !== null && samePick(p, n) ? p : n))
  }, [sessions, listedAt, wanted, gone])

  // For the `unknown` ids a query or stream reports. Stamped, so a list requested later can revive them.
  const forget = useCallback((ids: readonly string[]) => {
    if (!ids.length) return
    const at = Date.now()
    setGone((g) => new Map([...g, ...ids.map((id): [string, number] => [id, at])]))
  }, [])
  const clear = useCallback(() => save([]), [save])
  const toggle = useCallback((id: string) => save(flip(shownRef.current ?? [], id)), [save])
  // For picked sessions the sidebar's date filters exclude: removed for good, unlike a pick pruned while unlisted.
  const unpick = useCallback((ids: readonly string[]) => save((shownRef.current ?? []).filter((id) => !ids.includes(id))), [save])
  // After a trash. Nothing stored stays nothing stored: the newest listed session is shown either way.
  const drop = useCallback(
    (ids: readonly string[]) => {
      // The list held until the next refresh still has them; the fallback must not land on one.
      forget(ids)
      const w = wantedRef.current
      if (w === null) return
      const shown = (shownRef.current ?? []).filter((id) => !ids.includes(id))
      const left = w.filter((id) => !ids.includes(id))
      if (left.length || !w.length) save(left)
      else {
        // A stored [] would show all sessions; nothing stored shows the newest, frozen.
        localStorage.removeItem(KEY)
        adopt(null)
      }
      // save points the ref at the stored list, ids this tab does not list included; a toggle in the same task would write them back.
      shownRef.current = shown
    },
    [save, adopt, forget],
  )

  return { pick, toggle, clear, forget, drop, unpick }
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
