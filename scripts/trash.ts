// trash.ts — moves sessions into a per-source trash, back out, and deletes them for good.
//
// Request strings only ever select: a path is built from discovery's `Found` or from a directory
// listing of the trash, never from a request field.

import { lstatSync, mkdirSync, readdirSync, renameSync, rmdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { TrashEntry, TrashRef, TrashResult } from '../shared/api.ts'
import { type Discovery, SESSION_RE } from './discovery.ts'

const TRASH = 'wal-trash'
const TRASH_SFX = '.wal-trash'
const RESTORE_SFX = '.wal-restore'

const today = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const taken = (path: string): boolean => lstatSync(path, { throwIfNoEntry: false }) !== undefined

/** The transcript first: it is what makes a folder list the session. */
const piecesOf = (dir: string, id: string): string[] => [`${id}.jsonl`, `${id}.wal.jsonl`, id].filter((n) => taken(join(dir, n)))

const clash = (dir: string, names: string[]): string | undefined => names.find((n) => taken(join(dir, n)))

/** A rename onto an existing file replaces it, so a piece or an in-flight name already there is a conflict. */
const blocked = (from: string, to: string, names: string[], sfx: string): string | undefined => {
  const inFlight = names.map((n) => n + sfx)
  return clash(to, [...names, ...inFlight]) ?? clash(from, inFlight)
}

/**
 * Suffix in place, move, strip: the transcript is renamed first and stripped last, so neither
 * listing ever shows a half-moved session. A failure undoes the completed renames in reverse.
 */
const relocate = (from: string, to: string, names: string[], sfx: string): void => {
  const done: [string, string][] = []
  const step = (a: string, b: string): void => {
    renameSync(a, b)
    done.push([a, b])
  }
  try {
    for (const n of names) step(join(from, n), join(from, n + sfx))
    for (const n of names) step(join(from, n + sfx), join(to, n + sfx))
    for (const n of [...names.slice(1), ...names.slice(0, 1)]) step(join(to, n + sfx), join(to, n))
  } catch (err) {
    const stuck: string[] = []
    for (const [a, b] of done.reverse()) {
      try {
        renameSync(b, a)
      } catch {
        stuck.push(b)
      }
    }
    const msg = (err as Error).message
    throw new Error(stuck.length ? `${msg}; rollback left ${stuck.join(', ')}` : msg)
  }
}

/** Removes `dir` and its parents up to `last` while they are empty; a non-empty one stops it. */
const prune = (dir: string, last: string): void => {
  for (let d = dir; d.startsWith(last); d = dirname(d)) {
    try {
      rmdirSync(d)
    } catch {
      return
    }
    if (d === last) return
  }
}

// `projectsDir` is the entry's own source: labels are folder names, so two sources can share one.
interface Trashed {
  entry: TrashEntry
  dir: string
  projectsDir: string
}

/** `forget` evicts every cache outside discovery that may hold the id (WAL index, session store). */
export const createTrash = (discovery: Pick<Discovery, 'sources' | 'find' | 'drop' | 'head'>, forget: (id: string) => void) => {
  const scan = (): Trashed[] => {
    const out: Trashed[] = []
    for (const src of discovery.sources()) {
      const root = join(dirname(src.projectsDir), TRASH)
      const ls = (d: string): string[] => {
        try {
          return readdirSync(d)
        } catch {
          return []
        }
      }
      for (const date of ls(root)) {
        for (const slug of ls(join(root, date))) {
          const dir = join(root, date, slug)
          for (const name of ls(dir)) {
            const id = name.slice(0, -'.jsonl'.length)
            // Suffixed names fail `.jsonl`, `<id>.wal.jsonl` fails the id pattern.
            if (!name.endsWith('.jsonl') || !SESSION_RE.test(id)) continue
            try {
              const t = statSync(join(dir, name))
              const w = statSync(join(dir, `${id}.wal.jsonl`), { throwIfNoEntry: false })
              const { title, cwd } = discovery.head(join(dir, name), t.size, t.mtimeMs)
              out.push({
                entry: { source: src.label, date, slug, id, title, cwd, size: t.size + (w?.size ?? 0) },
                dir,
                projectsDir: src.projectsDir,
              })
            } catch {
              /* a piece vanished or turned unreadable between the listing and its read */
            }
          }
        }
      }
    }
    return out.sort((a, b) => b.entry.date.localeCompare(a.entry.date))
  }

  const list = (): TrashEntry[] => scan().map((t) => t.entry)

  const trashOne = (id: string): TrashResult => {
    let f: ReturnType<typeof discovery.find>
    try {
      f = discovery.find(id)
    } catch (err) {
      return { id, status: 'failed', reason: (err as Error).message }
    }
    if (!f) return { id, status: 'unknown' }
    if (f.busy) return f.live ? { id, status: 'live' } : { id, status: 'live', reason: 'not ended' }
    // By folder, not label: `f.dir` is `<projectsDir>/<slug>` of the source that holds it.
    const to = join(dirname(dirname(f.dir)), TRASH, today(), f.slug)
    const names = piecesOf(f.dir, id)
    const hit = blocked(f.dir, to, names, TRASH_SFX)
    if (hit) return { id, status: 'conflict', reason: `${hit} exists` }
    let made: string | undefined
    try {
      made = mkdirSync(to, { recursive: true })
      relocate(f.dir, to, names, TRASH_SFX)
    } catch (err) {
      if (made) prune(to, made)
      return { id, status: 'failed', reason: (err as Error).message }
    }
    discovery.drop(id)
    forget(id)
    return { id, status: 'ok' }
  }

  const trash = (ids: string[]): TrashResult[] => ids.map(trashOne)

  /** A ref that matches entries of two same-label sources cannot say which one it means. */
  const match = (refs: TrashRef[], all: Trashed[]): (Trashed | TrashResult)[] =>
    refs.map((r) => {
      const hits = all.filter(({ entry: e }) => e.source === r.source && e.date === r.date && e.slug === r.slug && e.id === r.id)
      if (hits.length > 1) return { id: r.id, status: 'conflict', reason: `source label ${r.source} is ambiguous` }
      return hits[0] ?? { id: r.id, status: 'unknown' }
    })

  const restoreOne = (t: Trashed | TrashResult): TrashResult => {
    if (!('entry' in t)) return t
    const { entry: e, dir, projectsDir } = t
    try {
      if (discovery.find(e.id)) return { id: e.id, status: 'conflict', reason: 'session exists' }
    } catch (err) {
      return { id: e.id, status: 'failed', reason: (err as Error).message }
    }
    const to = join(projectsDir, e.slug)
    const names = piecesOf(dir, e.id)
    const hit = blocked(dir, to, names, RESTORE_SFX)
    if (hit) return { id: e.id, status: 'conflict', reason: `${hit} exists` }
    let made: string | undefined
    try {
      made = mkdirSync(to, { recursive: true })
      relocate(dir, to, names, RESTORE_SFX)
    } catch (err) {
      if (made) prune(to, made)
      return { id: e.id, status: 'failed', reason: (err as Error).message }
    }
    prune(dir, dirname(dir))
    discovery.drop(e.id)
    forget(e.id)
    return { id: e.id, status: 'ok' }
  }

  const restore = (refs: TrashRef[]): TrashResult[] => match(refs, scan()).map(restoreOne)

  const purgeOne = (t: Trashed | TrashResult): TrashResult => {
    if (!('entry' in t)) return t
    const { entry: e, dir } = t
    try {
      // The transcript last, so a failure leaves the entry listed for another try.
      for (const n of [`${e.id}.wal.jsonl`, e.id, `${e.id}.jsonl`]) rmSync(join(dir, n), { recursive: true, force: true })
    } catch (err) {
      return { id: e.id, status: 'failed', reason: (err as Error).message }
    }
    prune(dir, dirname(dir))
    discovery.drop(e.id)
    return { id: e.id, status: 'ok' }
  }

  const purge = (refs: TrashRef[] | 'all'): TrashResult[] => {
    const all = scan()
    return (refs === 'all' ? all : match(refs, all)).map(purgeOne)
  }

  return { list, trash, restore, purge }
}
