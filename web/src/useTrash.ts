import { useCallback, useEffect, useRef, useState } from 'react'
import type { TrashEntry, TrashRef, TrashResult } from '../../shared/api.ts'

// Fetched on mount, that is on opening the Trash tab, by the tab after each action, and when `gen` changes (a sidebar move); never polled.
export function useTrash(gen: number) {
  const qgen = useRef(0)
  const [entries, setEntries] = useState<TrashEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const my = ++qgen.current
    try {
      const res = await fetch('/trash')
      if (!res.ok) throw new Error(`error ${res.status}`)
      const data = (await res.json()) as { entries: TrashEntry[] }
      if (my === qgen.current) {
        setEntries(data.entries)
        setError(null)
      }
    } catch (e) {
      if (my === qgen.current) setError((e as Error).message)
    }
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies(gen): re-run trigger, the sidebar moved sessions into the trash.
  useEffect(() => {
    void refresh()
    return () => {
      qgen.current++
    }
  }, [refresh, gen])

  return { ready: entries !== null, entries: entries ?? [], refresh, error }
}

export const postTrash = async (path: '/trash/restore' | '/trash/purge', body: { refs: TrashRef[] }): Promise<TrashResult[]> => {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`error ${res.status}`)
  return ((await res.json()) as { results: TrashResult[] }).results
}
