import type { SessionMeta } from '../../../shared/api.ts'

// The session preselected at page open; ties on `last` go to the session listed first.
export const newest = (sessions: readonly SessionMeta[], skip: ReadonlySet<string> = new Set()): string | null => {
  let best: SessionMeta | null = null
  for (const s of sessions) if (!skip.has(s.id) && (best === null || s.last > best.last)) best = s
  return best?.id ?? null
}

// `drop`: ids a stream reported unknown, gone even if the last /sessions still listed them.
export const prune = (pick: readonly string[], sessions: readonly SessionMeta[], drop: readonly string[] = []): string[] => {
  const gone = new Set(drop)
  const known = new Set(sessions.map((s) => s.id))
  return [...new Set(pick)].filter((id) => known.has(id) && !gone.has(id))
}

// null means the page just opened, the only time the newest session is picked for the user.
export const settlePick = (pick: readonly string[] | null, sessions: readonly SessionMeta[]): string[] => {
  if (pick !== null) return prune(pick, sessions)
  const id = newest(sessions)
  return id === null ? [] : [id]
}

export const samePick = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

export const toggle = (pick: readonly string[], id: string): string[] =>
  pick.includes(id) ? pick.filter((x) => x !== id) : [...pick, id]
