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

// Mirrors SESSION_RE in scripts/discovery.ts, which pulls in node:fs and so stays out of the web bundle.
const SESSION_RE = /^[0-9a-f-]{36}$/

// The wanted pick read back from storage; null (anything malformed) restores like nothing stored.
export const storedPick = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((id) => typeof id === 'string' && SESSION_RE.test(id)) ? [...new Set<string>(v)] : null

// What the tab shows for the wanted pick. `fallback`: the newest session frozen when nothing is stored or a
// non-empty wanted pick first pruned to nothing, so the view does not jump as `last` moves; null computes it now.
export const effective = (wanted: readonly string[] | null, sessions: readonly SessionMeta[], gone: readonly string[], fallback: string | null): string[] => {
  if (wanted?.length === 0) return []
  const shown = wanted === null ? [] : prune(wanted, sessions, gone)
  if (shown.length) return shown
  const id = fallback ?? newest(sessions, new Set(gone))
  return id === null ? [] : [id]
}

export const samePick = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

export const toggle = (pick: readonly string[], id: string): string[] => (pick.includes(id) ? pick.filter((x) => x !== id) : [...pick, id])
