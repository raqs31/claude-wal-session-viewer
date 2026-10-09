// discovery.ts — finds every Claude Code session across config dirs (`~/.claude`, each
// `~/.claude/workspaces/*`, each `--source`) and describes it from its transcript and its
// `<id>.wal.jsonl`. Ids come from the page, so a path is only ever built from a directory listing.

import { closeSync, existsSync, openSync, readdirSync, readSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import type { SessionList, SessionMeta, Source } from '../shared/api.ts'
import { createParser } from './transcripts.ts'

export const SESSION_RE = /^[0-9a-f-]{36}$/
const WORKTREE = '--ai-worktrees-'
const CHUNK = 8 * 1024 * 1024
const HEAD_MAX = 1024 * 1024
const HEAD_CHUNK = 64 * 1024
const TAIL = 256 * 1024
const LIVE_MS = 2 * 60 * 1000
export const PROMPT_MAX = 8192
// The hook writes `ts`, `workspace`, `event` first, so most lines never need a full parse.
const PREFIX = /^\{"ts":"[^"]*","workspace":"((?:[^"\\]|\\.)*)","event":"((?:[^"\\]|\\.)*)"/

let scratch = Buffer.alloc(0)

/**
 * The returned bytes live in one buffer shared by every call: consume them before the next
 * readAt. A fresh 8 MB buffer per chunk left the server's RSS hovering near its budget.
 */
export const readAt = (path: string, off: number, len: number): Buffer => {
  if (scratch.length < len) scratch = Buffer.allocUnsafe(len)
  const fd = openSync(path, 'r')
  try {
    return scratch.subarray(0, readSync(fd, scratch, 0, len, off))
  } finally {
    closeSync(fd)
  }
}

/** Default workspaces symlink their `projects/` back to `~/.claude/projects`, so realpath dedupes them. */
export const sources = (extra: string[], home = homedir()): Source[] => {
  const base = join(home, '.claude')
  const ws = join(base, 'workspaces')
  const candidates = [
    { label: 'default', dir: base },
    ...(existsSync(ws) ? readdirSync(ws).sort().map((n) => ({ label: n, dir: join(ws, n) })) : []),
    ...extra.map((d) => ({ label: basename(resolve(d)), dir: resolve(d) })),
  ]
  const out: Source[] = []
  for (const c of candidates) {
    let projectsDir: string
    try {
      projectsDir = realpathSync(join(c.dir, 'projects'))
      if (!statSync(projectsDir).isDirectory()) continue
    } catch {
      continue
    }
    if (!out.some((s) => s.projectsDir === projectsDir)) out.push({ label: c.label, projectsDir })
  }
  return out
}

interface Found {
  id: string
  source: string
  slug: string
  dir: string
}
interface Head {
  size: number
  mtime: number
  title: string
  prompt: string | null
  started: number | null
  cwd: string | null
}
// `offset` stops after the last newline consumed, so a half-written line is re-read once complete,
// except inside a line longer than CHUNK: that one is counted on its first chunk and `skipping`
// until its newline. `ino` changing means the file was replaced, however its size moved.
interface WalScan {
  ino: number
  offset: number
  skipping: boolean
  lines: number
  workspaces: Set<string>
  lastEvent: string | null
}

const AI_TITLE = Buffer.from('"ai-title"')
const CUSTOM_TITLE = Buffer.from('"custom-title"')

/**
 * The parser's title rule (the last entry of `type` with a string `key`) over complete lines, parsing
 * only lines that mention the needle: running the full parser over every tail cost most of a cold list.
 * An empty value is kept as the latest (a cleared `/rename`), so callers fall through it with `||`.
 */
const lastOf = (buf: Buffer, needle: Buffer, type: string, key: string): string | null => {
  let value: string | null = null
  for (let at = buf.indexOf(needle); at !== -1; ) {
    const start = buf.lastIndexOf(10, at) + 1
    const nl = buf.indexOf(10, at)
    if (nl === -1) break
    try {
      const e = JSON.parse(buf.toString('utf8', start, nl))
      if (e?.type === type && typeof e[key] === 'string') value = e[key]
    } catch { /* an unparseable line is skipped, as the parser does */ }
    at = buf.indexOf(needle, nl + 1)
  }
  return value
}

const cap = (s: string): string => {
  if (s.length <= PROMPT_MAX) return s
  const cut = s.slice(0, PROMPT_MAX)
  return (/[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut) + '…'
}

const DROP = /<(command-message|system-reminder|local-command-[\w-]*)(?:\s[^>]*)?>(?:(?!<\1[\s>])[\s\S])*?<\/\1>/g
const TAG = /<\/?[A-Za-z][\w:.-]*(?:\s[^>]*)?>/g
const tidy = (s: string): string => s.replace(/\n{3,}/g, '\n\n').trim()

/**
 * A transcript's first user message as the page should read it: command-message, system-reminder and
 * local-command-* blocks dropped (innermost pair first, so nesting works; an unclosed opener loses only
 * its tag), then a closed command-name block becomes `⚡ /name args` and the rest is ignored, else every
 * other tag is stripped and its text kept. Newlines survive, 3+ collapse to 2. Null when nothing is left.
 */
export const cleanPrompt = (raw: string): string | null => {
  let s = raw
  for (let prev = ''; prev !== s;) { prev = s; s = s.replace(DROP, '') }
  const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(s)?.[1]?.trim()
  if (name) {
    const args = tidy((/<command-args>([\s\S]*?)<\/command-args>/.exec(s)?.[1] ?? '').replace(TAG, ''))
    return `⚡ ${name}${args ? ' ' + args : ''}`
  }
  return tidy(s.replace(TAG, '')) || null
}

const unescape = (s: string): string => (s.includes('\\') ? JSON.parse(`"${s}"`) : s)

/** Snapshots a `wal legacy` migrate left beside a legacy log; a rerun finishes them. */
export const SNAP = '.snap-'
export const snapshotsOf = (path: string): string[] => {
  try {
    return readdirSync(dirname(path)).filter((f) => f.startsWith(basename(path) + SNAP)).map((f) => join(dirname(path), f))
  } catch {
    return []
  }
}

export const createDiscovery = (extra: string[]) => {
  const where = new Map<string, Found>()
  // Ids no walk found, kept until the next list() so a stream tick on one does not rescan every source.
  const misses = new Set<string>()
  const heads = new Map<string, Head>()
  const wals = new Map<string, WalScan>()

  const walk = (): { sources: Source[]; found: Found[] } => {
    const srcs = sources(extra)
    const found: Found[] = []
    where.clear()
    for (const src of srcs) {
      let slugs: string[]
      try { slugs = readdirSync(src.projectsDir) } catch { continue }
      for (const slug of slugs) {
        const dir = join(src.projectsDir, slug)
        let names: string[]
        try { names = readdirSync(dir) } catch { continue }
        for (const name of names) {
          const id = name.slice(0, -'.jsonl'.length)
          // `<id>.wal.jsonl` fails the pattern, so only transcripts are listed.
          if (!name.endsWith('.jsonl') || !SESSION_RE.test(id) || where.has(id)) continue
          const f = { id, source: src.label, slug, dir }
          where.set(id, f)
          found.push(f)
        }
      }
    }
    return { sources: srcs, found }
  }

  /** The folder holding `<id>.jsonl`, rescanning once for a session newer than the last walk. */
  const locate = (id: string): string | null => {
    const hit = where.get(id)
    if (hit && existsSync(join(hit.dir, `${id}.jsonl`))) return hit.dir
    if (misses.has(id)) return null
    walk()
    const dir = where.get(id)?.dir ?? null
    if (!dir) misses.add(id)
    return dir
  }

  const head = (path: string, size: number, mtime: number): Head => {
    const hit = heads.get(path)
    if (hit && hit.size === size && hit.mtime === mtime) return hit
    const first = createParser('main')
    const m = first.meta
    let pending = Buffer.alloc(0)
    let custom: string | null = null
    for (let off = 0; off < Math.min(size, HEAD_MAX) && (m.first === null || m.firstPrompt === null || m.cwd === null); off += HEAD_CHUNK) {
      const chunk = readAt(path, off, HEAD_CHUNK)
      const buf = pending.length ? Buffer.concat([pending, chunk]) : chunk
      let start = 0
      for (let nl: number; (nl = buf.indexOf(10, start)) !== -1; start = nl + 1) {
        if (m.firstPrompt === null) {
          first.push(buf.subarray(start, nl + 1))
          continue
        }
        // Past the first prompt only the parser's own meta rules can still change anything, and
        // its timeline work was most of a cold list.
        let e
        try { e = JSON.parse(buf.toString('utf8', start, nl)) } catch { continue }
        if (!e || typeof e !== 'object') continue
        const t = Date.parse(e.timestamp)
        if (!Number.isNaN(t) && (m.first === null || t < m.first)) m.first = t
        if (typeof e.cwd === 'string') m.cwd ??= e.cwd
        if (e.type === 'ai-title') m.title = e.aiTitle ?? m.title
      }
      custom = lastOf(buf.subarray(0, start), CUSTOM_TITLE, 'custom-title', 'customTitle') ?? custom
      pending = Buffer.from(buf.subarray(start))
    }
    // Read before the tail: readAt's buffer is shared and the span is only valid until the next call.
    let prompt: string | null = null
    const opener = first.items.find((i) => i.turn === 1)
    if (opener) {
      try {
        const content = JSON.parse(readAt(path, opener.src[0], opener.src[1]).toString('utf8'))?.message?.content
        const cleaned = typeof content === 'string' ? cleanPrompt(content) : null
        if (cleaned !== null) prompt = cap(cleaned)
      } catch { /* an unreadable opener leaves no prompt */ }
    }
    const from = Math.max(0, size - TAIL)
    let tail = readAt(path, from, size - from)
    // A window starting mid-line would hand JSON.parse half an object.
    if (from > 0) tail = tail.subarray(tail.indexOf(10) + 1)
    const ai = lastOf(tail, AI_TITLE, 'ai-title', 'aiTitle') ?? first.meta.title
    const name = lastOf(tail, CUSTOM_TITLE, 'custom-title', 'customTitle') ?? custom
    const h: Head = { size, mtime, title: name || ai || prompt?.replace(/\s+/g, ' ').trim() || '', prompt, started: first.meta.first, cwd: first.meta.cwd }
    heads.set(path, h)
    return h
  }

  const scanLine = (w: WalScan, buf: Buffer, start: number, end: number): void => {
    w.lines++
    const m = PREFIX.exec(buf.toString('utf8', start, Math.min(end, start + 512)))
    if (m) {
      w.workspaces.add(unescape(m[1]!))
      w.lastEvent = unescape(m[2]!)
      return
    }
    try {
      const rec = JSON.parse(buf.toString('utf8', start, end))
      if (typeof rec?.workspace === 'string') w.workspaces.add(rec.workspace)
      if (typeof rec?.event === 'string') w.lastEvent = rec.event
    } catch { /* an unparseable line still counts */ }
  }

  const wal = (path: string, size: number, ino: number): WalScan => {
    let w = wals.get(path)
    if (!w || size < w.offset || ino !== w.ino) {
      w = { ino, offset: 0, skipping: false, lines: 0, workspaces: new Set(), lastEvent: null }
      wals.set(path, w)
    }
    while (w.offset < size) {
      const buf = readAt(path, w.offset, Math.min(CHUNK, size - w.offset))
      if (!buf.length) break
      if (w.skipping) {
        const nl = buf.indexOf(10)
        w.skipping = nl === -1
        w.offset += nl === -1 ? buf.length : nl + 1
        continue
      }
      const end = buf.lastIndexOf(10)
      if (end === -1) {
        if (buf.length < CHUNK) break
        scanLine(w, buf, 0, buf.length)
        w.skipping = true
        w.offset += buf.length
        continue
      }
      let start = 0
      for (let nl: number; (nl = buf.indexOf(10, start)) !== -1; start = nl + 1) scanLine(w, buf, start, nl)
      w.offset += end + 1
    }
    return w
  }

  const describe = (f: Found, now: number): SessionMeta | null => {
    const tPath = join(f.dir, `${f.id}.jsonl`)
    const t = statSync(tPath, { throwIfNoEntry: false })
    if (!t) return null
    const wPath = join(f.dir, `${f.id}.wal.jsonl`)
    const ws = statSync(wPath, { throwIfNoEntry: false })
    const w = ws ? wal(wPath, ws.size, ws.ino) : null
    if (!ws) wals.delete(wPath)
    const h = head(tPath, t.size, t.mtimeMs)
    const cut = f.slug.indexOf(WORKTREE)
    const last = Math.max(t.mtimeMs, ws?.mtimeMs ?? 0)
    return {
      id: f.id,
      project: { slug: cut === -1 ? f.slug : f.slug.slice(0, cut), cwd: h.cwd },
      worktree: cut === -1 ? null : f.slug.slice(cut + WORKTREE.length),
      source: f.source,
      workspaces: w?.workspaces.size ? [...w.workspaces] : ['unknown'],
      title: h.title,
      prompt: h.prompt,
      started: h.started,
      last,
      live: now - last < LIVE_MS && w?.lastEvent !== 'SessionEnd',
      walSize: ws?.size ?? 0,
      walLines: w?.lines ?? 0,
      transcriptSize: t.size,
    }
  }

  const legacyOf = (rows: SessionMeta[]): string[] => {
    const byReal = new Map<string, string>()
    for (const cwd of new Set(rows.map((r) => r.project.cwd).filter((c) => c !== null))) {
      const p = join(cwd, '.ai', 'logs', 'wal.jsonl')
      if (!existsSync(p) && snapshotsOf(p).length === 0) continue
      let real = p
      try { real = join(realpathSync(dirname(p)), 'wal.jsonl') } catch { /* dir vanished: fall back to the raw path */ }
      if (!byReal.has(real)) byReal.set(real, p)
    }
    return [...byReal.values()]
  }

  const list = (): SessionList => {
    const { sources, found } = walk()
    const now = Date.now()
    misses.clear()
    const sessions = found
      .map((f) => {
        // A transcript or WAL can vanish, or turn unreadable, between the walk and its read.
        try { return describe(f, now) } catch { return null }
      })
      .filter((r) => r !== null)
      .sort((a, b) => b.last - a.last)
    return { sources, sessions, legacy: legacyOf(sessions).length }
  }

  /** Pre-per-session WAL files, found through the cwd of every discovered transcript. */
  const legacyFiles = (): string[] => legacyOf(list().sessions)

  return { sources: () => sources(extra), list, locate, legacyFiles }
}

export type Discovery = ReturnType<typeof createDiscovery>
