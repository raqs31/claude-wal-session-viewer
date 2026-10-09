// MCP servers wrap results in content blocks and often put JSON inside a text block as a string.
const isBlock = (b: unknown): b is { type: string; text?: unknown } =>
  b !== null && typeof b === 'object' && !Array.isArray(b) && typeof (b as { type?: unknown }).type === 'string'
export function normalize(v: unknown): unknown {
  if (typeof v === 'string') {
    const t = v.trim()
    if (t[0] === '{' || t[0] === '[')
      try {
        return normalize(JSON.parse(t))
      } catch {}
    return v
  }
  if (Array.isArray(v)) {
    if (!v.length || !v.every(isBlock)) return v.map(normalize)
    const out = v.map((b) => (b.type === 'text' && typeof b.text === 'string' ? normalize(b.text) : normalize(b)))
    return out.length === 1 && v[0]?.type === 'text' ? out[0] : out
  }
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x)]))
  return v
}
