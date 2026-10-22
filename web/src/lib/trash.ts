import type { SessionMeta, TrashResult } from '../../../shared/api.ts'

export interface Skipped {
  session: SessionMeta
  // `live` when a process is writing now; `not ended` for a busy session idle at its prompt.
  why: 'live' | 'not ended'
}

export const splitBusy = (sessions: readonly SessionMeta[]): { movable: SessionMeta[]; skipped: Skipped[] } => {
  const movable: SessionMeta[] = []
  const skipped: Skipped[] = []
  for (const session of sessions) {
    if (!session.busy) movable.push(session)
    else skipped.push({ session, why: session.live ? 'live' : 'not ended' })
  }
  return { movable, skipped }
}

// Fixed segment order, one per non-zero status, after `ok` with the caller's label.
const SEGMENTS: readonly [TrashResult['status'], string][] = [
  ['live', 'live skipped'],
  ['conflict', 'conflict'],
  ['unknown', 'not found'],
  ['failed', 'failed'],
]

export const summarizeResults = (results: readonly TrashResult[], ok = 'moved'): string => {
  const parts = [['ok', ok] as const, ...SEGMENTS].flatMap(([status, label]) => {
    const n = results.filter((r) => r.status === status).length
    return n > 0 ? [`${n} ${label}`] : []
  })
  return parts.length > 0 ? parts.join(' · ') : `0 ${ok}`
}
