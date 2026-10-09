import { useEffect, useState } from 'react'

export function useStored<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    const s = localStorage.getItem(key)
    return allowed.includes(s as T) ? (s as T) : fallback
  })
  useEffect(() => { localStorage.setItem(key, v) }, [key, v])
  return [v, setV]
}
