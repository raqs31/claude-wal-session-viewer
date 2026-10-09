import type { SessionMeta } from '../../../shared/api.ts'

// `chips` holds source labels and workspace names in one set: they share a namespace (`default`,
// a `workspaces/<name>` basename), and a session from one source is often written by another
// workspace. Empty chips or project means no filter.
export interface SidebarFilter {
  chips: ReadonlySet<string>
  project: string
  text: string
}

export interface ProjectGroup {
  slug: string
  // A non-worktree session's cwd when one exists, else a worktree's; null when none recorded one.
  cwd: string | null
  last: number
  rows: SessionMeta[]
}

export const chipValues = (rows: readonly SessionMeta[]): string[] => [...new Set(rows.flatMap((r) => [r.source, ...r.workspaces]))].sort()

export const filterRows = (rows: readonly SessionMeta[], f: SidebarFilter): SessionMeta[] => {
  const words = f.text.toLowerCase().split(/\s+/).filter(Boolean)
  return rows.filter((r) => {
    if (f.chips.size && !f.chips.has(r.source) && !r.workspaces.some((w) => f.chips.has(w))) return false
    if (f.project && r.project.slug !== f.project) return false
    if (!words.length) return true
    const hay = [r.title, r.id, r.project.slug, r.project.cwd ?? '', r.worktree ?? ''].join('\n').toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

// A worktree session already carries its parent project's slug, so it lands in the parent's group.
// Groups and the rows in each are newest first; ties keep list order. Callers pass a frozen `lastOf`
// to hold the order steady (e.g. while the pointer is over the list).
export const groupByProject = (rows: readonly SessionMeta[], lastOf: (r: SessionMeta) => number = (r) => r.last): ProjectGroup[] => {
  const groups = new Map<string, ProjectGroup>()
  for (const r of rows) {
    let g = groups.get(r.project.slug)
    if (!g) {
      g = { slug: r.project.slug, cwd: null, last: lastOf(r), rows: [] }
      groups.set(r.project.slug, g)
    }
    g.rows.push(r)
    g.last = Math.max(g.last, lastOf(r))
  }
  for (const g of groups.values()) {
    g.rows.sort((a, b) => lastOf(b) - lastOf(a))
    g.cwd = (g.rows.find((r) => r.worktree === null && r.project.cwd !== null) ?? g.rows.find((r) => r.project.cwd !== null))?.project.cwd ?? null
  }
  return [...groups.values()].sort((a, b) => b.last - a.last)
}

// Picked rows come first in pick order (ids not in `rows` are skipped); the rest keep input order.
export const pinPicked = (rows: readonly SessionMeta[], pick: readonly string[]): { picked: SessionMeta[]; rest: SessionMeta[] } => {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const picked = pick.flatMap((id) => byId.get(id) ?? [])
  const pickedIds = new Set(pick)
  return { picked, rest: rows.filter((r) => !pickedIds.has(r.id)) }
}

// The collapsed sidebar filters' one-line digest; `projectLabel` names the chosen project.
export const sidebarSummary = (f: SidebarFilter, projectLabel: string): string[] => {
  const out: string[] = []
  if (f.chips.size) out.push(f.chips.size <= 2 ? [...f.chips].join(', ') : `chips: ${f.chips.size}`)
  if (f.project) out.push(`project: ${projectLabel}`)
  if (f.text.trim()) out.push(`q: ${f.text.trim()}`)
  return out
}
