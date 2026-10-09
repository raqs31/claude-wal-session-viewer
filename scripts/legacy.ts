#!/usr/bin/env node
// legacy.ts — `wal legacy`: folds pre-per-session `<cwd>/.ai/logs/wal.jsonl` files into the
// `<session>.wal.jsonl` beside each session's transcript. Source files are only ever shrunk by a
// migrate, or removed once empty or on a typed yes.

import { appendFileSync, closeSync, existsSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { createDiscovery, type Discovery, SESSION_RE, SNAP, snapshotsOf } from './discovery.ts'

export type Ask = (question: string) => Promise<string>

const sessionOf = (line: string): string | null => {
  try {
    const id = JSON.parse(line)?.session_id
    return typeof id === 'string' && SESSION_RE.test(id) ? id : null
  } catch {
    return null
  }
}

const BATCH_BYTES = 64 * 1024

/** Appends whole lines in batches so a write stays small enough not to interleave with the hook's. */
const appendLines = (file: string, lines: string[]): void => {
  const size = statSync(file, { throwIfNoEntry: false })?.size ?? 0
  let prefix = ''
  if (size > 0) {
    const fd = openSync(file, 'r')
    const last = Buffer.alloc(1)
    readSync(fd, last, 0, 1, size - 1)
    closeSync(fd)
    if (last[0] !== 0x0a) prefix = '\n'
  }
  let batch = prefix
  for (const l of lines) {
    if (batch.length > prefix.length && batch.length + l.length + 1 > BATCH_BYTES) {
      appendFileSync(file, batch)
      batch = ''
    }
    batch += `${l}\n`
  }
  if (batch) appendFileSync(file, batch)
}

const sourcesOf = (path: string): string[] => [...(existsSync(path) ? [path] : []), ...snapshotsOf(path)]

/**
 * Moves the log aside first so the hook's next append lands in a fresh file, then folds the
 * snapshot into the targets and appends what stayed behind back. A crash leaves the snapshot or
 * duplicates, never a lost line.
 */
const migrate = (path: string, locate: Discovery['locate'], say: (s: string) => void): void => {
  if (existsSync(path)) {
    const snap = `${path}${SNAP}${process.pid}-${Date.now()}`
    renameSync(path, snap)
    say(`snapshot ${snap}`)
  }
  const snaps = snapshotsOf(path)
  const lines = snaps.flatMap((f) => readFileSync(f, 'utf8').split('\n')).filter((l) => l !== '')
  const byTarget = new Map<string, string[]>()
  const kept: string[] = []
  const dirs = new Map<string, string | null>()
  for (const line of lines) {
    const id = sessionOf(line)
    if (id === null) {
      kept.push(line)
      continue
    }
    if (!dirs.has(id)) dirs.set(id, locate(id))
    const dir = dirs.get(id)
    if (!dir) {
      kept.push(line)
      continue
    }
    const target = join(dir, `${id}.wal.jsonl`)
    const mine = byTarget.get(target) ?? []
    mine.push(line)
    byTarget.set(target, mine)
  }
  let moved = 0
  for (const [target, mine] of byTarget) {
    const have = new Set(existsSync(target) ? readFileSync(target, 'utf8').split('\n') : [])
    const fresh = mine.filter((l) => !have.has(l) && have.add(l))
    if (fresh.length) appendLines(target, fresh)
    moved += fresh.length
  }
  if (kept.length) appendLines(path, kept)
  for (const f of snaps) rmSync(f)
  if (lines.length > 0 && kept.length === lines.length) say(`kept ${kept.length} lines, none matched a transcript`)
  else if (kept.length === 0) say(`migrated ${moved} lines, removed ${path}`)
  else say(`migrated ${moved} lines, ${kept.length} left in ${path}`)
}

export const runLegacy = async (discovery: Discovery, ask: Ask, say: (s: string) => void): Promise<void> => {
  const files = discovery.legacyFiles()
  if (files.length === 0) {
    say('no legacy WAL files')
    return
  }
  for (const path of files) {
    const sources = sourcesOf(path)
    if (sources.length === 0) continue
    const text = sources.map((f) => readFileSync(f, 'utf8')).join('')
    const sessions = new Set(
      text
        .split('\n')
        .map(sessionOf)
        .filter((s) => s !== null),
    )
    say(`${path}  ${Buffer.byteLength(text)} bytes  ${sessions.size} sessions`)
    const a = (await ask('[m]igrate / [d]elete / [s]kip? ')).trim().toLowerCase()
    if (a === 'm' || a === 'migrate') migrate(path, discovery.locate, say)
    else if (a === 'd' || a === 'delete') {
      if ((await ask(`type yes to delete ${path}: `)).trim() === 'yes') {
        for (const f of sources) rmSync(f, { force: true })
        say(`deleted ${path}`)
      } else say('skipped')
    } else say('skipped')
  }
}

if (process.argv[1] === import.meta.filename) {
  const extra = process.argv.filter((a) => a.startsWith('--source=')).map((a) => a.slice('--source='.length))
  // Async iteration keeps answers piped on a non-TTY stdin from being lost between prompts.
  const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]()
  const ask: Ask = async (q) => {
    process.stdout.write(q)
    const next = await lines.next()
    if (next.done) process.stdout.write('\n')
    return next.done ? '' : next.value
  }
  await runLegacy(createDiscovery(extra), ask, (s) => console.log(s))
  process.exit(0)
}
