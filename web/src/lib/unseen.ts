import type { SessionMeta } from '../../../shared/api.ts'

export interface Baseline {
  walLines: number
  transcriptSize: number
}
export type Baselines = Record<string, Baseline>

export const isBaselines = (v: unknown): v is Baselines =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.values(v as Record<string, Partial<Baseline> | null>).every((b) => typeof b?.walLines === 'number' && typeof b.transcriptSize === 'number')

// A WAL that shrank (truncated, rewritten) shows nothing until it is viewed again.
export const unseen = (row: SessionMeta, baseline: Baseline | undefined): number => (baseline ? Math.max(0, row.walLines - baseline.walLines) : 0)

// `viewed`: picked ids, and only while the page is visible. A session seen for the first time gets
// its current counts, so a fresh browser does not flag every session at once. Sessions no longer
// listed are dropped to keep storage bounded. Returns `baselines` itself when nothing moved.
export const advance = (baselines: Baselines, viewed: readonly string[], rows: readonly SessionMeta[]): Baselines => {
  const look = new Set(viewed)
  const out: Baselines = {}
  let changed = Object.keys(baselines).length !== rows.length
  for (const r of rows) {
    const b = baselines[r.id]
    if (b && !(look.has(r.id) && (b.walLines !== r.walLines || b.transcriptSize !== r.transcriptSize))) out[r.id] = b
    else {
      out[r.id] = { walLines: r.walLines, transcriptSize: r.transcriptSize }
      changed = true
    }
  }
  return changed ? out : baselines
}
