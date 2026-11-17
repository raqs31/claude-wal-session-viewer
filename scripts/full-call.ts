// full-call.ts — reads one tool call's full input and response back from the session's transcript,
// where the WAL holds only what the wal-hook clamped (or nothing, for a line it dropped).

import { closeSync, fstatSync, openSync, readdirSync, readSync } from 'node:fs'
import { join } from 'node:path'

// Allocated per scan, not shared: a buffer kept for the process life would hold its bytes between requests.
const CHUNK = 1024 * 1024

export interface FullCall {
  input?: unknown
  response?: unknown
  error?: boolean
}

// biome-ignore lint/suspicious/noExplicitAny: deliberate, transcripts are schemaless JSON.
type E = Record<string, any>

const blocks = (e: E): E[] => (Array.isArray(e?.message?.content) ? e.message.content : [])

/** One transcript's view of `tuid`; a missing or unreadable file gives `{}`. */
const scan = (path: string, tuid: string): FullCall => {
  const out: FullCall = {}
  const needle = Buffer.from(tuid)
  // Takes one complete line; true once the result is in, which always follows its tool_use.
  const take = (buf: Buffer): boolean => {
    if (!buf.includes(needle)) return false
    let e: E
    try {
      e = JSON.parse(buf.toString('utf8'))
    } catch {
      return false
    }
    for (const b of blocks(e)) {
      if (e.type === 'assistant' && (b?.type === 'tool_use' || b?.type === 'server_tool_use') && b.id === tuid) out.input = b.input
      else if (e.type === 'user' && b?.type === 'tool_result' && b.tool_use_id === tuid) {
        out.error = b.is_error === true
        out.response = out.error || e.toolUseResult === undefined ? b.content : e.toolUseResult
        return true
      }
    }
    return false
  }
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const size = fstatSync(fd).size
    const chunk = Buffer.allocUnsafe(Math.min(CHUNK, size))
    // Pieces of a line longer than what one chunk still held.
    let carry: Buffer[] = []
    for (let off = 0; off < size; ) {
      const buf = chunk.subarray(0, readSync(fd, chunk, 0, Math.min(CHUNK, size - off), off))
      if (!buf.length) break
      off += buf.length
      let start = 0
      for (let nl = buf.indexOf(10); nl !== -1; start = nl + 1, nl = buf.indexOf(10, start)) {
        const line = carry.length ? Buffer.concat([...carry, buf.subarray(start, nl)]) : buf.subarray(start, nl)
        carry = []
        if (take(line)) return out
      }
      // A copy: the next read overwrites the chunk.
      if (start < buf.length) carry.push(Buffer.from(buf.subarray(start)))
    }
    if (carry.length) take(Buffer.concat(carry))
  } catch {
    return {}
  } finally {
    if (fd !== null) closeSync(fd)
  }
  return out
}

/**
 * The full input and response of call `tuid` from session `id`'s transcripts in `dir`: the agent's own file, then
 * the main one. Only a call with no own file (`agent` null or not listed) goes on to every subagent file, so a miss
 * reads two files when the agent has its own. Subagent paths come from the directory listing, never from `agent`
 * alone, so a WAL value cannot point outside `dir`. `{}` when no transcript holds the call; it never throws.
 */
export const fullCall = (dir: string, id: string, agent: string | null, tuid: string): FullCall => {
  const main = join(dir, `${id}.jsonl`)
  const subs = join(dir, id, 'subagents')
  let names: string[] = []
  try {
    names = readdirSync(subs).filter((n) => n.startsWith('agent-') && n.endsWith('.jsonl'))
  } catch {
    /* no subagents */
  }
  const own = `agent-${agent}.jsonl`
  const paths = agent !== null && names.includes(own) ? [join(subs, own), main] : [main, ...names.map((n) => join(subs, n))]
  for (const path of paths) {
    const got = scan(path, tuid)
    if ('input' in got || 'response' in got) return got
  }
  return {}
}
