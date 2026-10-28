// The single source of View. It lives here, not in useEvents.ts, because the root tsc program checks lib tests without the DOM lib and importing useEvents.ts would pull React and DOM code in.
export type View = 'tail' | 'table'

export type SortKey = 'inp' | 'out' | 'res' | 'tot' | 'all' | 'dur'
export type Sort = { key: SortKey; dir: 'asc' | 'desc' } | null

export function next(sort: Sort, key: SortKey): Sort {
  if (!sort || sort.key !== key) return { key, dir: 'desc' }
  return sort.dir === 'desc' ? { key, dir: 'asc' } : null
}

export function sortParams(sort: Sort): [string, string][] {
  return sort
    ? [
        ['sort', sort.key],
        ['dir', sort.dir],
      ]
    : []
}

export function canSort(follow: boolean, view: View): boolean {
  return !follow && view === 'table'
}
