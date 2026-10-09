import type { Category } from '../../../shared/api.ts'

// Category assignment. Five categorical slots carry identity; the two status colours are
// reserved for events that genuinely mean a bad state, and always ship beside a glyph and
// the event name in text — colour never carries meaning alone here.
export const CATEGORY: Record<Category, { label: string; color: string; glyph?: '!' }> = {
  tool:    { label: 'Tool',       color: 'var(--cat-tool)' },
  mcp:     { label: 'MCP call',   color: 'var(--cat-mcp)' },
  subagent: { label: 'Subagent',  color: 'var(--cat-subagent)' },
  turn:    { label: 'Turn',       color: 'var(--cat-turn)' },
  session: { label: 'Session',    color: 'var(--cat-session)' },
  attn:    { label: 'Permission', color: 'var(--status-warning)', glyph: '!' },
  fail:    { label: 'Failure',    color: 'var(--status-critical)', glyph: '!' },
}
