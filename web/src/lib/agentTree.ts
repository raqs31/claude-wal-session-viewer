export interface TreeRow {
  id: string
  depth: number
  kids: boolean
}

// Main stays a row of its own and its spawns are the roots, so the tree starts one level below it.
// A parent missing from `ids` (not in scope, or not read yet) leaves its child a root.
export const agentRows = (ids: readonly string[], parentOf: (id: string) => string | null, collapsed: ReadonlySet<string>): TreeRow[] => {
  const known = new Set(ids)
  const kids = new Map<string | null, string[]>()
  for (const id of ids) {
    if (id === 'main') continue
    const p = parentOf(id)
    const key = p !== null && known.has(p) ? p : null
    kids.set(key, [...(kids.get(key) ?? []), id])
  }
  const out: TreeRow[] = known.has('main') ? [{ id: 'main', depth: 0, kids: false }] : []
  const walk = (parent: string | null, depth: number): void => {
    for (const id of kids.get(parent) ?? []) {
      out.push({ id, depth, kids: kids.has(id) })
      if (!collapsed.has(id)) walk(id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}
