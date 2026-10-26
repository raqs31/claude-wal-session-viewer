// sessions.ts — keeps the picked Claude Code sessions' stats, built from their targets through session-view.ts and
// following the targets as they grow. Ids come from the page, so no path is ever built from one unless it matched
// its pattern and the targets know it.

import type { Scope, SessionView, UsageTotals } from '../shared/api.ts'
import { SESSION_RE } from './discovery.ts'
import { pipeOf, type Targets } from './observer.ts'
import { absorb, createSessionData, type SessionData, usage as usageOf, view as viewOf } from './session-view.ts'
import { createTargetReader, type TargetReader } from './target.ts'

const AGENT_RE = /^[A-Za-z0-9_-]+$/
// A full pick of 8, as the WAL indexes.
const OPEN_MAX = 8
// The records that make up the stats; `ev`, `call` and `ck` lines do not change a view.
const STAT_KINDS = new Set(['use', 'turn', 'compact', 'agent', 'tools', 'cost', 'stale'])

export const validId = (id: string | null): id is string => id !== null && SESSION_RE.test(id)

export const parseScope = (s: string | null): Scope | null =>
  s === 'all' || s === 'main' ? s : s?.startsWith('agent:') && AGENT_RE.test(s.slice(6)) ? (s as Scope) : null

export interface Session {
  id: string
  gen: number
  // The target offset of the last stats record read: 0 until one is, and unique across re-opens through `gen`.
  version: number
  file: string
  reader: TargetReader
  data: SessionData
}

export const createStore = (targets: Targets, busy: (id: string) => boolean) => {
  const open = new Map<string, Session>()
  // Seeded per process, as the WAL's, so a page reconnecting to a restarted server sees a new gen.
  let gen = Date.now()

  const load = (id: string): Session | null => {
    let s = open.get(id)
    if (!s) {
      const file = targets.target(id)
      if (!file) {
        open.delete(id)
        return null
      }
      s = { id, gen: ++gen, version: 0, file, reader: createTargetReader(file), data: createSessionData() }
    }
    const { items, reset } = s.reader.read()
    if (reset) {
      s.data = createSessionData()
      s.gen = ++gen
      s.version = 0
    }
    absorb(
      s.data,
      items.map((i) => i.rec),
    )
    for (const i of items) if (STAT_KINDS.has(i.rec.k)) s.version = i.off
    open.delete(id)
    open.set(id, s)
    return s
  }

  /** Reads (or opens) each session; null if any id is malformed. Ids with no target are skipped into `unknown`. */
  const acquire = (ids: string[]): { sessions: Session[]; unknown: string[] } | null => {
    if (!ids.every(validId)) return null
    const sessions: Session[] = []
    const unknown: string[] = []
    for (const id of ids) {
      const s = load(id)
      if (s) sessions.push(s)
      else unknown.push(id)
    }
    for (const k of open.keys()) if (open.size > OPEN_MAX && !ids.includes(k) && !busy(k)) open.delete(k)
    return { sessions, unknown }
  }

  const get = (id: string): Session | null => acquire([id])?.sessions[0] ?? null

  const view = (s: Session, scope: Scope): SessionView | null => {
    const v = viewOf(s.data, { id: s.id, gen: s.gen, version: s.version }, scope)
    return v && { ...v, pipe: pipeOf(targets.observer, s.id) }
  }

  const usage = (ss: Session[], unknown: string[]): UsageTotals => ({
    ...usageOf(
      ss.map((s) => s.data),
      unknown,
    ),
    pipe: Object.fromEntries(ss.map((s) => [s.id, pipeOf(targets.observer, s.id)])),
  })

  /** Unlike the LRU, also drops a session a stream holds: its next acquire resolves through the targets. */
  const drop = (id: string): void => {
    open.delete(id)
  }

  return { acquire, get, view, usage, drop }
}
