#!/usr/bin/env node
// make-fixture.ts — cuts a text-blanked transcript fixture from this repo's real Claude Code sessions.
//
// Entries marked `_synthetic: true` (an API-error reply, a compact boundary and its summary) are
// built here, not cut: this repo's transcripts contain neither class.
//
//   node scripts/make-fixture.ts <sid…> --worktree=<sid> --sibling=<sid> <outdir> [--projects=<dir>]
//
// Every string is blanked unless isAllowedString() says it is structure; transcripts.test.ts is
// meant to import that predicate so the committed fixture is scanned against the rule that wrote it.
// After writing, a leak check compares the output against the text that was blanked and exits
// non-zero on any hit — it needs the real transcripts, so it lives here and not in a test.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { basename, join } from 'node:path'

// biome-ignore lint/suspicious/noExplicitAny: deliberate, transcripts are schemaless JSON walked generically.
type E = Record<string, any>

export const STRUCTURAL_KEYS = new Set([
  'type',
  'subtype',
  'uuid',
  'parentUuid',
  'logicalParentUuid',
  'sessionId',
  'session_id',
  'timestamp',
  'requestId',
  'model',
  'tool_use_id',
  'agentId',
  'toolUseId',
  'agentType',
  'subagent_type',
  'requestShape',
  'turnOrigin',
  'trigger',
  'stop_reason',
  'service_tier',
  'role',
  'cwd',
  'gitBranch',
  // Id links the plan's list omits; blanking them would break the chains the parser may follow.
  'promptId',
  'leafUuid',
  'messageId',
  'snapshotMessageId',
  'sourceToolAssistantUUID',
  'sourceToolUseID',
  'toolUseID',
  'parentAgentId',
  'headUuid',
  'anchorUuid',
  'tailUuid',
  'uuids',
  'allUuids',
])
// Keys that are structural only at one position: `name`/`id` elsewhere are MCP inputs or results,
// and a nested `error` is free text.
const STRUCTURAL_PATHS = new Set(['message.id', 'message.content.id', 'message.content.name', 'origin.kind', 'error'])
const ID_RE =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?:toolu|srvtoolu|msg|req)_[A-Za-z0-9]+|a[0-9a-f]{16}|\d{4}-\d\d-\d\dT[\d:.]+Z)$/
export const WRAPPERS = ['<command-name>', '<command-message>', '<local-command-caveat>', '<local-command-stdout>', '<task-notification>']
const TAG_NAMES = ['command-name', 'command-message', 'command-args', 'local-command-caveat', 'local-command-stdout', 'task-notification']
const TAG_RE = new RegExp(`</?(?:${TAG_NAMES.join('|')})>`, 'g')
const COMMAND_RE = /^\/[A-Za-z0-9:_-]+$/
const DENY_RE = new RegExp(`mraczynski|raczynski|mariusz|raqs31|neula|/home/|${hostname().replace(/\W/g, '\\$&')}`, 'gi')

export const CWD_MAIN = '/tmp/proj'
const CWD_WORKTREE = `${CWD_MAIN}/.ai/worktrees/demo`
const CWD_SIBLING = '/tmp/proj2'
const REWRITTEN = [CWD_MAIN, CWD_WORKTREE, CWD_SIBLING, 'main']
const REWRITTEN_KEYS = new Set(['cwd', 'gitBranch'])
const X = (s: string): string => 'x'.repeat(Math.min(s.length, 40))
const scrub = (s: string): string => s.replace(DENY_RE, X)
const keepPath = (path: string[]): boolean => STRUCTURAL_KEYS.has(path.at(-1) ?? '') || STRUCTURAL_PATHS.has(path.join('.'))

// A wrapper string keeps its recognised tags and a `<command-name>` command; the text between is blanked.
const blankWrapped = (s: string): string | null => {
  if (!WRAPPERS.some((w) => s.startsWith(w))) return null
  let out = ''
  let at = 0
  let inName = false
  for (const m of s.matchAll(TAG_RE)) {
    const between = s.slice(at, m.index)
    out += inName && COMMAND_RE.test(between) ? between : X(between)
    out += m[0]
    inName = m[0] === '<command-name>'
    at = m.index + m[0].length
  }
  return out + X(s.slice(at))
}

/** True when a fixture string may stand as-is. `path` is the key path from the entry root, array indices dropped. */
export const isAllowedString = (path: string[], v: string): boolean => /^x*$/.test(v) || keepPath(path) || ID_RE.test(v) || blankWrapped(v) === v

const KEY_OK = /^[A-Za-z0-9_$\-[\]]{1,64}$/
const keyKept = (k: string): boolean => KEY_OK.test(k) && scrub(k) === k
const blank = (v: unknown, path: string[], cwd: string, gone: string[]): unknown => {
  if (typeof v === 'string') {
    const k = path.at(-1)
    if (k === 'cwd') return cwd
    if (k === 'gitBranch') return 'main'
    if (keepPath(path) || ID_RE.test(v)) return scrub(v)
    gone.push(v)
    return blankWrapped(v) ?? X(v)
  }
  if (Array.isArray(v)) return v.map((x) => blank(x, path, cwd, gone))
  if (v && typeof v === 'object') {
    // Keys can be data too (file-history keys are absolute paths).
    return Object.fromEntries(
      Object.entries(v).map(([k, x], i) => {
        const key = keyKept(k) ? k : `k${i}`
        if (key !== k) gone.push(k)
        return [key, blank(x, [...path, key], cwd, gone)]
      }),
    )
  }
  return v
}

// ---- edge classes, detected on the written (blanked) entries ----

const content = (e: E): unknown => e.message?.content
const blocks = (e: E): E[] => {
  const c = content(e)
  return Array.isArray(c) ? c : []
}
const isHuman = (e: E): boolean =>
  e.type === 'user' &&
  !e.isSidechain &&
  typeof content(e) === 'string' &&
  !e.isMeta &&
  !e.isCompactSummary &&
  (e.origin?.kind === 'human' || (!e.origin && blankWrapped(content(e) as string) === null))
const isCommand = (e: E): boolean => e.type === 'user' && typeof content(e) === 'string' && /^<(?:command-|local-command-)/.test(content(e) as string)
const isClear = (e: E): boolean => isCommand(e) && (content(e) as string).includes('<command-name>/clear</command-name>')
const agentSpawns = (e: E): E[] => (e.type === 'assistant' ? blocks(e).filter((b) => b.type === 'tool_use' && b.name === 'Agent') : [])

type Sub = { id: string; meta: E; lines: E[] }
type Classes = Record<string, (main: E[], subs: Sub[]) => number>
const CLASSES: Classes = {
  'split reply (>=3 entries, one message.id)': (m) => {
    const n = new Map<string, number>()
    for (const e of m) if (e.type === 'assistant') n.set(e.message.id, (n.get(e.message.id) ?? 0) + 1)
    return [...n.values()].filter((c) => c >= 3).length
  },
  '<synthetic> reply with isApiErrorMessage': (m) => m.filter((e) => e.type === 'assistant' && e.message.model === '<synthetic>' && e.isApiErrorMessage).length,
  'thinking block': (m) => m.filter((e) => blocks(e).some((b) => b.type === 'thinking')).length,
  'tool_result is_error: true (+ its tool_use)': (m) => {
    const uses = new Set(
      m.flatMap((e) =>
        blocks(e)
          .filter((b) => b.type === 'tool_use')
          .map((b) => b.id),
      ),
    )
    return m.flatMap(blocks).filter((b) => b.type === 'tool_result' && b.is_error === true && uses.has(b.tool_use_id)).length
  },
  'array-content tool_result': (m) => m.flatMap(blocks).filter((b) => b.type === 'tool_result' && Array.isArray(b.content)).length,
  'human prompt': (m) => m.filter(isHuman).length,
  'task-notification prompt': (m) => m.filter((e) => e.type === 'user' && e.origin?.kind === 'task-notification').length,
  'isMeta skill body': (m) => m.filter((e) => e.type === 'user' && e.isMeta === true && e.sourceToolUseID).length,
  '/clear command wrapper': (m) => m.filter(isClear).length,
  'other command wrapper': (m) => m.filter((e) => isCommand(e) && !isClear(e)).length,
  'compact_boundary + isCompactSummary': (m) =>
    m.filter((e, i) => e.subtype === 'compact_boundary' && m.slice(i + 1).find((x) => x.uuid)?.isCompactSummary === true).length,
  'Agent spawn + subagent .jsonl + .meta.json + agentId result': (m, subs) =>
    subs.filter(
      (s) => s.lines.length > 0 && m.some((e) => agentSpawns(e).some((b) => b.id === s.meta.toolUseId)) && m.some((e) => e.toolUseResult?.agentId === s.id),
    ).length,
  'system/turn_duration': (m) => m.filter((e) => e.subtype === 'turn_duration').length,
  'cost-state': (m) => m.filter((e) => e.type === 'cost-state').length,
  'repeated ai-title': (m) => {
    const n = m.filter((e) => e.type === 'ai-title').length
    return n >= 2 ? n : 0
  },
  'non-monotonic timestamp pair (not re-parented)': (m) => {
    const u = m.filter((e) => e.uuid)
    return u.filter((e, i) => {
      const p = u[i - 1]
      return p !== undefined && e.timestamp < p.timestamp && !e._reparented && !p._reparented
    }).length
  },
}

// ---- selection ----

const readJsonl = (f: string): E[] =>
  readFileSync(f, 'utf8')
    .split('\n')
    .flatMap((l) => {
      try {
        return l ? [JSON.parse(l) as E] : []
      } catch {
        return []
      }
    })

/** Anchor indices for every class; windows of ±2 around them, closed over reply groups and tool pairs. */
const select = (all: E[], spawnId: string | null): Set<number> => {
  const anchors: number[] = []
  const first = (p: (e: E, i: number) => boolean): void => {
    const i = all.findIndex(p)
    if (i >= 0) anchors.push(i)
  }
  const groups = new Map<string, number[]>()
  all.forEach((e, i) => {
    if (e.type === 'assistant') groups.set(e.message.id, [...(groups.get(e.message.id) ?? []), i])
  })
  const split = [...groups.values()].find((g) => g.length >= 3)?.[0]
  if (split !== undefined) anchors.push(split)
  const synth = (e: E): boolean => e.type === 'assistant' && e.message.model === '<synthetic>'
  if (all.some((e) => synth(e) && e.isApiErrorMessage)) first((e) => synth(e) && e.isApiErrorMessage)
  else first(synth)
  first((e) => blocks(e).some((b) => b.type === 'thinking'))
  first((e) => blocks(e).some((b) => b.type === 'tool_result' && b.is_error === true))
  first((e) => blocks(e).some((b) => b.type === 'tool_result' && Array.isArray(b.content)))
  // Two prompts, so the fixture has more than one turn to attribute usage to.
  first(isHuman)
  const lastHuman = all.findLastIndex(isHuman)
  if (lastHuman >= 0) anchors.push(lastHuman)
  // Prefer the notification of the kept subagent, so the fixture links spawn → wakeup.
  const notif = all.findIndex((e) => e.origin?.kind === 'task-notification' && spawnId !== null && String(content(e)).includes(spawnId))
  if (notif >= 0) anchors.push(notif)
  else first((e) => e.origin?.kind === 'task-notification')
  first((e) => e.type === 'user' && e.isMeta === true && e.sourceToolUseID)
  first(isClear)
  first((e) => isCommand(e) && !isClear(e))
  first((e) => e.subtype === 'turn_duration')
  const cb = all.findIndex((e) => e.subtype === 'compact_boundary')
  if (cb >= 0) {
    anchors.push(cb, cb + 2)
    const lp = all.findIndex((e) => e.uuid === all[cb]?.logicalParentUuid)
    if (lp >= 0) anchors.push(lp)
  }
  if (spawnId) first((e) => agentSpawns(e).some((b) => b.id === spawnId))
  let prev: E | null = null
  first((e) => {
    if (!e.uuid) return false
    const hit = prev !== null && e.timestamp < prev.timestamp && e.parentUuid === prev.uuid
    prev = e
    return hit
  })

  const keep = new Set<number>()
  for (const a of anchors) for (let i = Math.max(0, a - 2); i <= Math.min(all.length - 1, a + 2); i++) keep.add(i)
  const titles = all.flatMap((e, i) => (e.type === 'ai-title' ? [i] : []))
  const last = titles.at(-1)
  // Blanking keeps only the length (capped), so "last wins" is testable only across distinct blanked lengths.
  // Unused when there is no title: findLast then never calls back.
  const lastLen = last === undefined ? 0 : X(all[last]?.aiTitle).length
  const other = titles.findLast((i) => X(all[i]?.aiTitle).length !== lastLen) ?? titles.at(-2)
  if (last !== undefined && other !== undefined) keep.add(other).add(last)
  const cost = all.findLastIndex((e) => e.type === 'cost-state')
  if (cost >= 0) keep.add(cost)

  const useAt = new Map<string, number>()
  const resultAt = new Map<string, number>()
  all.forEach((e, i) => {
    for (const b of blocks(e)) {
      if (b.type === 'tool_use' || b.type === 'server_tool_use') useAt.set(b.id, i)
      if (b.type === 'tool_result') resultAt.set(b.tool_use_id, i)
    }
  })
  for (let grew = true; grew; ) {
    grew = false
    const add = (i: number | undefined): void => {
      if (i !== undefined && !keep.has(i)) {
        keep.add(i)
        grew = true
      }
    }
    for (const i of [...keep]) {
      const e = all[i]
      if (e === undefined) continue
      if (e.type === 'assistant') for (const j of groups.get(e.message.id) ?? []) add(j)
      for (const b of blocks(e)) {
        if (b.type === 'tool_use' || b.type === 'server_tool_use') add(resultAt.get(b.id))
        if (b.type === 'tool_result') add(useAt.get(b.tool_use_id))
      }
    }
  }
  return keep
}

/** Points every dangling parent at the last kept uuid-bearing entry, so the chain stays valid. */
const reparent = (kept: E[]): void => {
  const uuids = new Set(kept.map((e) => e.uuid).filter(Boolean))
  let last: string | null = null
  for (const e of kept) {
    if (!e.uuid) continue
    if (e.parentUuid != null && !uuids.has(e.parentUuid)) {
      e.parentUuid = last
      e._reparented = true
    }
    if (e.logicalParentUuid != null && !uuids.has(e.logicalParentUuid)) {
      e.logicalParentUuid = last
      e._reparented = true
    }
    last = e.uuid
  }
}

// ---- synthesized entries ----
//
// This repo's transcripts hold no compaction and no API-error reply, and sessions from other
// projects are off limits, so these two classes are built here in the observed shape, placeholder
// text only. Each carries `_synthetic: true` so tests and readers can tell them from real entries.

const synthUuid = (seed: string): string => {
  const h = createHash('sha256').update(seed).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}
const after = (ts: string, ms: number): string => new Date(Date.parse(ts) + ms).toISOString()
const common = (at: E): E => ({
  isSidechain: false,
  userType: at.userType,
  entrypoint: at.entrypoint,
  cwd: at.cwd,
  sessionId: at.sessionId,
  version: at.version,
  gitBranch: at.gitBranch,
})

/** A rate-limited reply: zero usage, `<synthetic>` model, answering `prompt`. */
const apiErrorReply = (prompt: E): E => ({
  parentUuid: prompt.uuid,
  ...common(prompt),
  type: 'assistant',
  uuid: synthUuid(`${prompt.uuid}:api-error`),
  timestamp: after(prompt.timestamp, 1500),
  message: {
    id: synthUuid(`${prompt.uuid}:api-error:message`),
    container: null,
    model: '<synthetic>',
    role: 'assistant',
    stop_reason: 'stop_sequence',
    stop_sequence: '',
    type: 'message',
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
      service_tier: null,
      cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
    },
    content: [{ type: 'text', text: 'x'.repeat(40) }],
  },
  error: 'rate_limit',
  isApiErrorMessage: true,
  _synthetic: true,
})

/** A manual compaction after `prev`: the boundary restarts the chain, the summary hangs off it. */
const compaction = (prev: E, preTokens: number): E[] => {
  const boundary: E = {
    parentUuid: null,
    logicalParentUuid: prev.uuid,
    ...common(prev),
    type: 'system',
    subtype: 'compact_boundary',
    content: 'x'.repeat(17),
    level: 'info',
    compactMetadata: { trigger: 'manual', preTokens, postTokens: Math.round(preTokens / 10), cumulativeDroppedTokens: 0, durationMs: 30000 },
    uuid: synthUuid(`${prev.uuid}:compact`),
    timestamp: after(prev.timestamp, 1000),
    _synthetic: true,
  }
  const summary: E = {
    parentUuid: boundary.uuid,
    ...common(prev),
    type: 'user',
    message: { role: 'user', content: 'x'.repeat(40) },
    isVisibleInTranscriptOnly: true,
    isCompactSummary: true,
    uuid: synthUuid(`${prev.uuid}:compact-summary`),
    timestamp: after(prev.timestamp, 31000),
    _synthetic: true,
  }
  return [boundary, summary]
}

/** Inserts the missing classes into the first session: an API error answering its first prompt, a compaction before its last. */
const synthesize = (kept: E[]): E[] => {
  const out = [...kept]
  const insertBefore = (target: E, entries: E[]): void => {
    out.splice(out.indexOf(target), 0, ...entries)
    target.parentUuid = entries.at(-1)?.uuid
  }
  const prompts = out.filter(isHuman)
  const lastPrompt = prompts.at(-1)
  if (!out.some((e) => e.subtype === 'compact_boundary') && lastPrompt) {
    const prev = out.slice(0, out.indexOf(lastPrompt)).findLast((e) => e.uuid)
    if (prev === undefined) throw new Error('no entry with a uuid before the last prompt')
    const u = out.slice(0, out.indexOf(lastPrompt)).findLast((e) => e.type === 'assistant' && e.message.usage)?.message.usage
    const pre = u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens : 100000
    insertBefore(lastPrompt, compaction(prev, pre))
  }
  const firstPrompt = prompts[0]
  if (!out.some((e) => e.message?.model === '<synthetic>' && e.isApiErrorMessage) && firstPrompt) {
    const reply = apiErrorReply(firstPrompt)
    const child = out.find((e) => e.parentUuid === firstPrompt.uuid)
    out.splice(out.indexOf(firstPrompt) + 1, 0, reply)
    if (child) child.parentUuid = reply.uuid
  }
  return out
}

// ---- file order vs parentUuid chain, over every main transcript of a folder ----

const orderReport = (dir: string): { lines: string[]; ok: boolean } => {
  let files = 0,
    backRefs = 0,
    dangling = 0,
    drops = 0
  const breakers = new Map<string, number>()
  const kind = (e: E): string =>
    e.type === 'user'
      ? `user/${Array.isArray(content(e)) ? blocks(e)[0]?.type : e.isCompactSummary ? 'compactSummary' : e.isMeta ? 'meta' : 'string'}`
      : e.type === 'assistant'
        ? `assistant/${blocks(e)[0]?.type}`
        : `${e.type}/${e.subtype ?? ''}`
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
    files++
    const seen = new Set<string>()
    const all = new Set(readJsonl(join(dir, f)).map((e) => e.uuid))
    let prev: E | null = null
    for (const e of readJsonl(join(dir, f))) {
      if (!e.uuid) continue
      const p = e.parentUuid ?? e.logicalParentUuid
      if (p != null && !seen.has(p)) all.has(p) ? backRefs++ : dangling++
      if (prev && e.timestamp < prev.timestamp) {
        drops++
        const k = `${kind(prev)} -> ${kind(e)}`
        breakers.set(k, (breakers.get(k) ?? 0) + 1)
      }
      seen.add(e.uuid)
      prev = e
    }
  }
  const lines = [
    `${files} main transcripts in ${basename(dir)}: ${backRefs} entries whose parent appears later in the file, ${dangling} dangling parents`,
    `${drops} timestamp decreases between consecutive uuid-bearing entries (earlier kind -> later kind):`,
    ...[...breakers].sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${n}\t${k}`),
  ]
  // The parser keeps file order; a parent after its child would break that premise.
  return { lines, ok: backRefs === 0 && dangling === 0 }
}

// ---- leak check ----

const TOKEN_RE = /[^\s"'`<>(){}[\],;:=|]{12,}/g
const leakCheck = (gone: string[], kept: string[], out: string): { ok: boolean; lines: string[] } => {
  const structural = new Set([...kept, ...TAG_NAMES.flatMap((n) => [n, `/${n}`])].flatMap((s) => s.match(TOKEN_RE) ?? []))
  const tokens = [...new Set(gone.flatMap((s) => s.match(TOKEN_RE) ?? []))].filter((t) => !structural.has(t) && !ID_RE.test(t) && !/^x+$/.test(t))
  const outTokens = [...new Set(out.match(TOKEN_RE) ?? [])]
  const exact = tokens.filter((t) => outTokens.includes(t))
  // `free` proves every non-placeholder token is structure, so a hit inside one (e.g. `.ai/worktrees/`
  // inside the rewritten cwd) is not a leak.
  const shared = outTokens.filter((t) => !/^x+$/.test(t))
  const sub = tokens.filter((t) => out.includes(t) && !shared.some((s) => s.includes(t)))
  const free = outTokens.filter((t) => !structural.has(t) && !/^(?:x+|[\d.e+-]+)$/.test(t) && !ID_RE.test(t) && !REWRITTEN.includes(t))
  const deny = out.match(DENY_RE) ?? []
  const email = out.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []
  const lines = [
    `leak check: ${tokens.length} distinct 12+ char tokens from blanked text (tokens equal to a kept key or structural value excluded: ${structural.size})`,
    `  exact token hits in fixture: ${exact.length}`,
    `  substring hits outside kept structure: ${sub.length}`,
    `  fixture 12+ char tokens that are neither placeholder, id nor kept structure: ${free.length}`,
    `  denylist hits (user/handle names, employer, hostname, /home/): ${deny.length}`,
    `  email-like strings: ${email.length}`,
  ]
  // Only lengths are printed, so a hit never copies private text into a log.
  for (const t of [...exact, ...sub, ...free]) lines.push(`  LEAK token of length ${t.length}`)
  return { ok: exact.length + sub.length + free.length + deny.length + email.length === 0, lines }
}

// ---- main ----

const main = (): void => {
  const args = process.argv.slice(2)
  const flag = (n: string): string | undefined => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
  const pos = args.filter((a) => !a.startsWith('--'))
  const outDir = pos.pop()
  const worktree = flag('worktree')
  const sibling = flag('sibling')
  const projects = flag('projects') ?? join(homedir(), '.claude/projects')
  if (!outDir || pos.length === 0 || !worktree || !sibling) {
    console.error('usage: make-fixture.ts <sid…> --worktree=<sid> --sibling=<sid> <outdir> [--projects=<dir>]')
    process.exit(2)
  }
  // Sources are confined to this repo's own project folder and its worktree folders.
  const slug = join(import.meta.dirname, '../../../..').replace(/[^A-Za-z0-9]/g, '-')
  const find = (sid: string): string => {
    for (const d of readdirSync(projects)) {
      if ((d === slug || d.startsWith(`${slug}--`)) && existsSync(join(projects, d, `${sid}.jsonl`))) return join(projects, d)
    }
    throw new Error(`session ${sid} not found in ${slug} or its worktree folders under ${projects}`)
  }

  rmSync(outDir, { recursive: true, force: true })
  const gone: string[] = []
  const keptSrc: string[] = []
  let written = ''
  const collectKept = (v: unknown, path: string[]): void => {
    // Real cwd/gitBranch values are rewritten, so they must not count as structure.
    if (typeof v === 'string') {
      if ((keepPath(path) || ID_RE.test(v)) && !REWRITTEN_KEYS.has(path.at(-1) ?? '')) keptSrc.push(v)
    } else if (Array.isArray(v)) for (const x of v) collectKept(x, path)
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) {
        if (keyKept(k)) keptSrc.push(k)
        collectKept(x, [...path, k])
      }
  }
  const write = (file: string, entries: E[], cwd: string): E[] => {
    for (const e of entries) collectKept(e, [])
    const out = entries.map((e) => {
      const { _reparented, ...rest } = e
      const b = blank(rest, [], cwd, gone) as E
      if (_reparented) Object.defineProperty(b, '_reparented', { value: true })
      return b
    })
    const text = out.map((e) => `${JSON.stringify(e)}\n`).join('')
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, text)
    written += text
    return out
  }

  const mainOut: E[] = []
  const subsOut: Sub[] = []
  for (const [n, sid] of pos.entries()) {
    const dir = find(sid)
    const all = readJsonl(join(dir, `${sid}.jsonl`))
    const subDir = join(dir, sid, 'subagents')
    const metas = existsSync(subDir)
      ? readdirSync(subDir)
          .filter((f) => f.endsWith('.meta.json'))
          .map((f) => {
            const id = f.slice('agent-'.length, -'.meta.json'.length)
            return { id, meta: JSON.parse(readFileSync(join(subDir, f), 'utf8')) as E, size: statSync(join(subDir, `agent-${id}.jsonl`)).size }
          })
      : []
    const spawned = new Set(all.flatMap(agentSpawns).map((b) => b.id))
    // A spawn after the first prompt, so the subagent's usage lands on a turn other than 0; then the smallest.
    const firstPrompt = all.findIndex(isHuman)
    const early = (m: { meta: E }): boolean => all.findIndex((e) => agentSpawns(e).some((b) => b.id === m.meta.toolUseId)) < firstPrompt
    const sub = metas
      .filter((m) => spawned.has(m.meta.toolUseId) && all.some((e) => e.toolUseResult?.agentId === m.id))
      .sort((a, b) => Number(early(a)) - Number(early(b)) || a.size - b.size)[0]
    const keep = select(all, sub?.meta.toolUseId ?? null)
    const kept = all.filter((_, i) => keep.has(i))
    reparent(kept)
    const withSynth = n === 0 ? synthesize(kept) : kept
    mainOut.push(...write(join(outDir, '-tmp-proj', `${sid}.jsonl`), withSynth, CWD_MAIN))
    if (sub) {
      const base = join(outDir, '-tmp-proj', sid, 'subagents', `agent-${sub.id}`)
      const lines = write(`${base}.jsonl`, readJsonl(join(subDir, `agent-${sub.id}.jsonl`)), CWD_MAIN)
      collectKept(sub.meta, [])
      const meta = `${JSON.stringify(blank(sub.meta, [], CWD_MAIN, gone))}\n`
      writeFileSync(`${base}.meta.json`, meta)
      written += meta
      subsOut.push({ id: sub.id, meta: JSON.parse(meta) as E, lines })
    }
  }
  for (const [sid, slug, cwd] of [
    [worktree, '-tmp-proj--ai-worktrees-demo', CWD_WORKTREE],
    [sibling, '-tmp-proj2', CWD_SIBLING],
  ] as const) {
    write(join(outDir, slug, `${sid}.jsonl`), readJsonl(join(find(sid), `${sid}.jsonl`)), cwd)
  }

  console.log('edge classes:')
  const missing: string[] = []
  for (const [name, count] of Object.entries(CLASSES)) {
    const n = count(mainOut, subsOut)
    console.log(`  ${n > 0 ? 'present' : 'MISSING'}  ${name} (${n})`)
    if (n === 0) missing.push(name)
  }
  console.log(
    `fixture: ${mainOut.length} main entries, ${subsOut.map((s) => s.lines.length).join('+') || 0} subagent entries, ${(written.length / 1024).toFixed(0)} KiB total`,
  )
  console.log('order report:')
  const order = orderReport(join(projects, slug))
  for (const l of order.lines) console.log(`  ${l}`)
  const leaks = leakCheck(gone, keptSrc, written)
  for (const l of leaks.lines) console.log(l)
  const leaked = !leaks.ok
  if (missing.length) console.error(`missing edge classes: ${missing.join('; ')}`)
  if (leaked) console.error('leak check failed')
  if (!order.ok) console.error('order check failed: a parent appears later in the file or is dangling')
  if (missing.length || leaked || !order.ok) process.exit(1)
}

if (import.meta.main) main()
