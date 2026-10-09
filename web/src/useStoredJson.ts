import { type Dispatch, type SetStateAction, useEffect, useState } from 'react'

// A stored value that fails `valid` (absent, unparseable, an older shape) reads as `fallback`.
export function useStoredJson<T>(key: string, valid: (v: unknown) => v is T, fallback: T): [T, Dispatch<SetStateAction<T>>] {
  const [v, setV] = useState<T>(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
      return valid(parsed) ? parsed : fallback
    } catch {
      return fallback
    }
  })
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(v))
  }, [key, v])
  // Another tab's write is adopted rather than overwritten by this tab's next one. Fires only in
  // the other tabs, and the write-back above stores the same string, so the tabs do not ping-pong.
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key !== key || e.newValue === null) return
      try {
        const parsed: unknown = JSON.parse(e.newValue)
        if (valid(parsed)) setV(parsed)
      } catch {
        /* a foreign value keeps ours */
      }
    }
    addEventListener('storage', on)
    return () => removeEventListener('storage', on)
  }, [key, valid])
  return [v, setV]
}
