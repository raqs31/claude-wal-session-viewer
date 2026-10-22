#!/usr/bin/env node
// @ts-check
// wal-hook.mjs — hook handler that appends every lifecycle event to a per-session JSONL write-ahead log
// (`<transcript>.wal.jsonl` beside the session transcript; `$CLAUDE_PROJECT_DIR/.ai/logs/wal.jsonl` only
// when the payload carries no transcript_path).
//
// Registered for every hook event in settings.json; the event name is read from the payload
// (`hook_event_name`) rather than passed as an argument, so a newly supported event starts
// logging the moment it is added to the settings block — no change here.
//
// OBSERVABILITY MUST NEVER BREAK A TURN. Three constraints follow from that, and every one of
// them is load-bearing:
//   1. Always exit 0. Exit 2 from a PreToolUse hook BLOCKS the tool call; a logger that vetoes
//      the thing it is logging is worse than no logger. The whole body is wrapped accordingly.
//   2. Never write to stdout. On PostToolUse stdout is surfaced in the transcript, and on
//      UserPromptSubmit it is injected into Claude's context as additional context.
//   3. One writeSync per event to an O_APPEND fd. Hooks for parallel tool calls and subagents
//      run concurrently against this same file; a partial write would corrupt neighbouring
//      lines, not just its own. Verified: 40 concurrent writers x 20 lines @ 9KB -> 0 corrupt.
//
// PostToolUse, PostToolUseFailure, Stop and SubagentStop records also carry `context`: the size
// of the firing agent's last API call, read from the tail of that agent's own transcript. Any
// failure there only omits the field; the record is still appended.

import { appendFileSync, closeSync, fstatSync, mkdirSync, openSync, readSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

const MAX_STRING = Number(process.env.CLAUDE_WAL_MAX_STRING || 2000)
const MAX_ARRAY = Number(process.env.CLAUDE_WAL_MAX_ARRAY || 50)
const MAX_LINE = Number(process.env.CLAUDE_WAL_MAX_LINE || 96_000)

// Promoted to the top level of the record so the viewer can filter without walking `payload`.
// `tool_use_id` and `prompt_id` are what let a WAL line be joined back to the transcript;
// without them an event is an orphan observation.
const PROMOTED = ['hook_event_name', 'session_id', 'prompt_id', 'cwd', 'tool_name', 'tool_use_id', 'duration_ms', 'permission_mode', 'agent_id', 'agent_type']

/** @returns {Promise<string>} */
const readStdin = async () => {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

// A Read of a large file or a chatty Bash command arrives as a single multi-megabyte string.
// Caps are applied per value on the way in, so the cost is bounded before serialisation.
/**
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {unknown}
 */
const clamp = (value, depth = 0) => {
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[+${value.length - MAX_STRING} chars]` : value
  }
  if (value === null || typeof value !== 'object') return value
  if (depth >= 6) return '…[depth limit]'
  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ARRAY).map((item) => clamp(item, depth + 1))
    if (value.length > MAX_ARRAY) head.push(`…[+${value.length - MAX_ARRAY} items]`)
    return head
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clamp(item, depth + 1)]))
}

/** @param {Record<string, unknown> | null} parsed */
const walPath = (parsed) => {
  const transcript = parsed?.transcript_path
  if (typeof transcript === 'string' && transcript.endsWith('.jsonl')) {
    return `${transcript.slice(0, -'.jsonl'.length)}.wal.jsonl`
  }
  // CLAUDE_PROJECT_DIR is absent for some events; cwd from the payload is the next best anchor.
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  return join(root, '.ai', 'logs', 'wal.jsonl')
}

// Which Claude config dir produced the event; the default ~/.claude (also via symlink) is 'default'.
const workspaceName = () => {
  const dir = process.env.CLAUDE_CONFIG_DIR
  if (!dir) return 'default'
  try {
    return realpathSync(dir) === realpathSync(join(homedir(), '.claude')) ? 'default' : basename(dir)
  } catch {
    return basename(dir)
  }
}

const CONTEXT_EVENTS = ['PostToolUse', 'PostToolUseFailure', 'Stop', 'SubagentStop']
const TAIL_START = 64 * 1024
const TAIL_MAX = 4 * 1024 * 1024

// PostToolUse inside a subagent sends the MAIN transcript_path plus agent_id; reading that file
// would report the main agent's context for the subagent's event.
/** @param {Record<string, unknown>} parsed */
const agentTranscript = (parsed) => {
  const own = parsed.agent_transcript_path
  if (typeof own === 'string' && own.endsWith('.jsonl')) return own
  const transcript = parsed.transcript_path
  if (parsed.agent_id !== undefined) {
    const id = parsed.agent_id
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) return null
    if (typeof transcript !== 'string' || !transcript.endsWith('.jsonl')) return null
    return join(transcript.slice(0, -'.jsonl'.length), 'subagents', `agent-${id}.jsonl`)
  }
  return typeof transcript === 'string' ? transcript : null
}

/** @param {string} text */
const lastUsage = (text) => {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const message = entry?.message
    // `<synthetic>` lines (API errors) carry all-zero usage and would report an empty context.
    if (entry?.type !== 'assistant' || !message?.usage || message.model === '<synthetic>') continue
    /** @param {unknown} n */
    const num = (n) => (typeof n === 'number' ? n : 0)
    const u = message.usage
    return {
      tokens: num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens),
      output: num(u.output_tokens),
      model: message.model,
    }
  }
  return null
}

// Scanning from the end, the first qualifying line is the last of its message.id group: the final
// streaming snapshot, so duplicates of one reply are never summed.
/** @param {string} path */
const readContext = (path) => {
  const fd = openSync(path, 'r')
  try {
    const { size } = fstatSync(fd)
    for (let window = TAIL_START; ; window *= 4) {
      const start = Math.max(0, size - window)
      const buffer = Buffer.allocUnsafe(size - start)
      // A short read (file truncated since fstat) leaves the tail of the allocUnsafe buffer uninitialised,
      // so only the bytes actually read are searched and decoded.
      const bytesRead = readSync(fd, buffer, 0, buffer.length, start)
      const bytes = buffer.subarray(0, bytesRead)
      // A window that starts mid-file starts mid-line; with no newline at all the whole window is partial.
      // Cutting the partial line on the bytes avoids decoding a multi-MB window that holds one line.
      const first = start > 0 ? bytes.indexOf(10) : -1
      const found = lastUsage(first < 0 && start > 0 ? '' : bytes.toString('utf8', first + 1))
      if (found || start === 0 || window >= TAIL_MAX) return found
    }
  } finally {
    closeSync(fd)
  }
}

const main = async () => {
  const raw = await readStdin()

  /** @type {Record<string, unknown> | null} */
  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }

  /** @type {Record<string, unknown> & { ts: string; event?: string }} */
  const record = { ts: new Date().toISOString(), workspace: workspaceName() }

  if (parsed && typeof parsed === 'object') {
    record.event = /** @type {string} */ (parsed.hook_event_name || 'Unknown')
    for (const key of PROMOTED.slice(1)) {
      if (parsed[key] !== undefined) record[key] = clamp(parsed[key])
    }
    // Everything not promoted is kept verbatim under `payload`. Capturing the remainder wholesale
    // rather than naming fields is deliberate: the documented name for the PostToolUse result
    // differs between sources (`tool_result` vs `tool_response`), and an allowlist would silently
    // drop whichever one this build actually sends.
    const rest = Object.fromEntries(Object.entries(parsed).filter(([key]) => !PROMOTED.includes(key)))
    if (Object.keys(rest).length > 0) record.payload = clamp(rest)
  } else {
    record.event = 'Unparseable'
    record.raw = clamp(raw)
  }

  if (parsed && typeof parsed === 'object' && CONTEXT_EVENTS.includes(record.event ?? '')) {
    // Own try/catch: a throw reaching main's caller would skip the append below and lose the record.
    try {
      const path = agentTranscript(parsed)
      const context = path ? readContext(path) : null
      if (context) record.context = context
    } catch {}
  }

  let line = JSON.stringify(record)
  if (line.length > MAX_LINE) {
    // Rather than write a line the reader cannot parse back, drop the payload and keep the shape.
    const { payload, raw: rawField, ...rest } = record
    line = JSON.stringify({ ...rest, dropped: `line exceeded ${MAX_LINE} chars` })
  }

  const path = walPath(parsed)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${line}\n`)
}

try {
  await main()
} catch {
  // A logger that reports its own failure to Claude would pollute the transcript it observes.
}
process.exit(0)
