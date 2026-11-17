import { normalize } from './normalize.ts'

export type Sections = { structured?: unknown[]; text?: string[]; meta?: Record<string, unknown> }

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const isBlock = (b: unknown): b is { type: string; text?: unknown } => isObj(b) && typeof b.type === 'string'

export function mcpSections(v: unknown): Sections {
  const structured: unknown[] = []
  const text: string[] = []
  const meta: Record<string, unknown> = {}
  const blocks: unknown[] = []
  const addBlock = (b: unknown) => {
    if (isBlock(b) && b.type === 'text' && typeof b.text === 'string') {
      const n = normalize(b.text)
      if (typeof n === 'string') text.push(n)
      else structured.push(n)
    } else if (isBlock(b)) blocks.push(b)
    else structured.push(b)
  }
  if (typeof v === 'string') addBlock({ type: 'text', text: v })
  else if (Array.isArray(v)) v.forEach(addBlock)
  else if (isObj(v) && (Array.isArray(v.content) || 'structuredContent' in v)) {
    for (const [k, x] of Object.entries(v)) {
      if (k === 'content' && Array.isArray(x)) x.forEach(addBlock)
      else if (k === 'structuredContent') structured.push(x)
      else meta[k] = x
    }
  } else if (v !== undefined) structured.push(v)
  if (blocks.length) meta.blocks = blocks
  return {
    ...(structured.length && { structured }),
    ...(text.length && { text }),
    ...(Object.keys(meta).length && { meta }),
  }
}

const MARKER = /…\[\+\d+ (chars|items)\]$|^…\[depth limit\]$/

function marked(v: unknown): boolean {
  if (typeof v === 'string') return MARKER.test(v)
  if (Array.isArray(v)) return v.some(marked)
  if (isObj(v)) return Object.values(v).some(marked)
  return false
}

export function clampBadge(v: unknown, restored: boolean): boolean {
  if (restored) return false
  return (isObj(v) && 'dropped' in v) || marked(v)
}

// The badge shows while a side stays clamped: its value carries a marker, or its WAL line was dropped whole
// (the value is then empty and shows no marker).
export const paneBadge = (v: unknown, restored: boolean | undefined, wal?: object): boolean =>
  clampBadge(v, !!restored) || (!restored && wal !== undefined && 'dropped' in wal)
