// The wal-hook's clamp markers: a cut string or array ends with one, a value nested too deep becomes one.
const MARKER = /…\[\+\d+ (chars|items)\]$|^…\[depth limit\]$/

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

export function marked(v: unknown): boolean {
  if (typeof v === 'string') return MARKER.test(v)
  if (Array.isArray(v)) return v.some(marked)
  if (isObj(v)) return Object.values(v).some(marked)
  return false
}
