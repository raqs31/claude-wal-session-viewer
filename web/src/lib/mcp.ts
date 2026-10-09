// mcp__<server>__<tool>: the server is the segment up to the next `__`, the tool the rest.
export const mcpParts = (t: string): [server: string, tool: string] | null => {
  if (!t.startsWith('mcp__')) return null
  const s = t.slice(5),
    i = s.indexOf('__')
  return i < 0 ? [s, s] : [s.slice(0, i), s.slice(i + 2)]
}
export const hue = (s: string): number => {
  let h = 0
  for (const c of s) h = (h * 31 + c.codePointAt(0)!) >>> 0
  return h % 360
}
export const toolColor = (t: string): string => {
  if (t === '-') return 'var(--status-critical)'
  const m = mcpParts(t)
  return m ? `hsl(${hue(m[0])} 60% 55%)` : 'var(--tool-claude)'
}

// The search only narrows this list; the event filter is whatever is checked.
export const groupMcp = (tools: readonly string[], q: string): { server: string; tools: string[] }[] => {
  q = q.trim().toLowerCase()
  const groups = new Map<string, string[]>()
  for (const t of tools) {
    const m = mcpParts(t)
    if (!m || (q && !m[0].toLowerCase().includes(q) && !m[1].toLowerCase().includes(q))) continue
    groups.has(m[0]) ? groups.get(m[0])!.push(t) : groups.set(m[0], [t])
  }
  return [...groups.keys()].sort().map((server) => ({ server, tools: groups.get(server)!.sort() }))
}
