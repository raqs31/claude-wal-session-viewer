import type { SessionMeta } from '../../../shared/api.ts'

// `chips` holds source labels and workspace names in one set: they share a namespace (`default`,
// a `workspaces/<name>` basename), and a session from one source is often written by another
// workspace. Empty chips or project means no filter; with no chips ticked, `not` changes nothing.
// `not` turns the chips from "only these" into "none of these".
export interface SidebarFilter {
  chips: ReadonlySet<string>
  not: boolean
  project: string
  text: string
  created: Range
  last: Range
}

// Inclusive bounds in ms; null is unbounded.
export interface Range {
  from: number | null
  to: number | null
}

export const ANY: Range = { from: null, to: null }

export const startOfToday = (now = Date.now()): number => new Date(now).setHours(0, 0, 0, 0)

// A fresh load and Clear filters: the sessions last touched today.
export const defaultFilter = (now = Date.now()): SidebarFilter => ({
  chips: new Set(),
  not: false,
  project: '',
  text: '',
  created: ANY,
  last: { from: startOfToday(now), to: null },
})

const inRange = (t: number, r: Range) => (r.from === null || t >= r.from) && (r.to === null || t <= r.to)

// A session whose start is unknown counts as created at its last write.
export const inDates = (r: SessionMeta, f: Pick<SidebarFilter, 'created' | 'last'>): boolean =>
  inRange(r.started ?? r.last, f.created) && inRange(r.last, f.last)

const pad = (n: number) => String(n).padStart(2, '0')
// The local `YYYY-MM-DDTHH:mm` a datetime-local input holds.
export const toLocalInput = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
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
    if (f.chips.size && (f.chips.has(r.source) || r.workspaces.some((w) => f.chips.has(w))) === f.not) return false
    if (f.project && r.project.slug !== f.project) return false
    if (!inDates(r, f)) return false
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

// The collapsed sidebar filters' one-line digest; `projectLabel` names the chosen project.
export const sidebarSummary = (f: SidebarFilter, projectLabel: string): string[] => {
  const out: string[] = []
  if (f.chips.size) out.push(`${f.not ? '≠ ' : ''}${f.chips.size <= 2 ? [...f.chips].join(', ') : `chips: ${f.chips.size}`}`)
  if (f.project) out.push(`project: ${projectLabel}`)
  if (f.text.trim()) out.push(`q: ${f.text.trim()}`)
  for (const [name, r] of [
    ['created', f.created],
    ['last', f.last],
  ] as const) {
    const [a, b] = [r.from, r.to].map((t) => (t === null ? '' : toLocalInput(t).replace('T', ' ')))
    if (a && b) out.push(`${name}: ${a} – ${b}`)
    else if (a) out.push(`${name} ≥ ${a}`)
    else if (b) out.push(`${name} ≤ ${b}`)
  }
  return out
}
