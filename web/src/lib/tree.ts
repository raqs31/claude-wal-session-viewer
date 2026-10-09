import { normalize } from './normalize.ts'

export type Seg = readonly ['p' | 'k' | 's' | 'n' | 'b', string]
export type Line = Seg[]
export interface Group { h: Seg[]; o?: Seg; k: TreeNode[]; c?: Seg[]; s: string }
export type TreeNode = Line | Group
export type Format = 'json' | 'yaml' | 'raw'
export const FORMATS: readonly Format[] = ['json', 'yaml', 'raw']

// MCP responses arrive as content-block arrays, objects or bare strings depending on the server.
export const pretty = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v ?? null, null, 2))

// One walker feeds both the DOM tree and the copied text, so the two cannot disagree.
// A node is a line (array of [class, text] segments) or a group {h, o, k, c, s}: head, opener, kids, closer, summary.
const YQ = /^$|^\s|\s$|^[-?:,[\]{}#&*!|>'"%@`]|: |\s#|:$|[\x00-\x1f\x7f]|^(true|false|yes|no|on|off|y|n|null|~)$|^[-+]?\.?\d|^[-+]?\.(inf|nan)$|^(<<|=)$|[\x85\u2028\u2029]/i
// YAML 1.1 parsers fold a raw NEL/LS/PS even inside double quotes, so those must be escaped.
const yq = (t: string): string => (YQ.test(t) ? JSON.stringify(t).replace(/[\x85\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`) : t)
const P = (t: string): Seg => ['p', t]
const scalar = (v: unknown, yaml: boolean): Seg => (v === null || typeof v === 'boolean' ? ['b', String(v)]
  : typeof v === 'number' ? ['n', String(v)]
  : ['s', yaml ? yq(v as string) : JSON.stringify(v)])
function tree(v: unknown, yaml: boolean, head: Seg[] = [], item = false): TreeNode {
  const sp = yaml && head.length ? [P(' ')] : []
  // A literal block keeps newlines readable; leading whitespace or extra trailing newlines would need indicators and control or NEL/LS/PS chars are not allowed in a block, so those stay quoted.
  if (yaml && typeof v === 'string' && v.includes('\n') && !/^\s|\n\n$|[\x00-\x08\x0b-\x1f\x7f\x85\u2028\u2029]/.test(v)) {
    const nl = v.endsWith('\n'), ls = (nl ? v.slice(0, -1) : v).split('\n')
    return { h: [...head, ...sp], o: P(nl ? '|' : '|-'), k: ls.map((l): Line => [['s', l]]), s: `${ls.length} lines` }
  }
  if (v === null || typeof v !== 'object') return [...head, ...sp, scalar(v, yaml)]
  const arr = Array.isArray(v), n = arr ? v.length : Object.keys(v).length
  if (!n) return [...head, ...sp, P(arr ? '[]' : '{}')]
  const k = arr
    ? v.map((x) => tree(x, yaml, yaml ? [P('-')] : [], true))
    : Object.entries(v).map(([key, x]) => tree(x, yaml, [['k', yaml ? yq(key) : JSON.stringify(key)], P(yaml ? ':' : ': ')]))
  const s = arr ? `[…] ${n} item${n === 1 ? '' : 's'}` : `{…} ${n} key${n === 1 ? '' : 's'}`
  if (!yaml) {
    // JSON groups always carry a closer.
    for (const c of k.slice(0, -1)) (Array.isArray(c) ? c : c.c!).push(P(','))
    return { h: head, o: P(arr ? '[' : '{'), k, c: [P(arr ? ']' : '}')], s }
  }
  const first = k[0]
  if (item && !arr && Array.isArray(first)) return k.length === 1 ? [...head, P(' '), ...first] : { h: [...head, P(' '), ...first], k: k.slice(1), s }
  return { h: head, k, s }
}
const line = (d: number, ss: readonly Seg[]): string => { const t = ss.map((x) => x[1]).join(''); return t && '  '.repeat(d) + t }
const text = (nodes: readonly TreeNode[], d = 0): string => nodes.map((n) => (Array.isArray(n) ? line(d, n)
  : [line(d, n.o ? [...n.h, n.o] : n.h), text(n.k, d + 1), ...(n.c ? [line(d, n.c)] : [])].join('\n'))).join('\n')

export const viewNodes = (v: unknown, yaml: boolean): TreeNode[] => {
  const t = tree(normalize(v ?? null), yaml)
  // A YAML root mapping or sequence has no opening line of its own.
  return yaml && !Array.isArray(t) && !t.o ? t.k : [t]
}

export const copyText = (v: unknown, format: Format): string => {
  if (format === 'raw') return pretty(v)
  // Without a final newline a trailing `|` block would lose its own newline when parsed back.
  return text(viewNodes(v, format === 'yaml')) + (format === 'yaml' ? '\n' : '')
}
