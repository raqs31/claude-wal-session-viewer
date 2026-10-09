import type { AgentNode, SessionAgents } from '../../../shared/api.ts'

// The picker's tree. `self` is the token for the node's own rows (null for a session, which has
// none); `sub` the token for the node and everything below it. Server tokens are scoped to a
// session: `<sess>:*`, `<sess>:<id>`, `<sess>:<id>*`, `<sess>:summaries:<id>`.
export interface PickNode {
  key: string
  label: string
  // Session nodes only: the picker renders them apart so the id survives truncating a long name.
  name?: string
  tag?: string
  kind: 'session' | 'agent' | 'summaries'
  self: string | null
  sub: string
  children: PickNode[]
}

export type Check = 'on' | 'off' | 'mixed'

const agentNode = (sess: string, a: AgentNode): PickNode => {
  const main = a.id === 'main'
  const children = a.children.map((c) => agentNode(sess, c))
  if (a.summaries) {
    const t = `${sess}:summaries:${a.id}`
    children.push({ key: t, label: `summaries (${a.summaries})`, kind: 'summaries', self: t, sub: t, children: [] })
  }
  return {
    key: `${sess}:${a.id}`,
    label: main ? 'main' : [a.type, a.id.slice(0, 6)].filter(Boolean).join(' '),
    kind: 'agent',
    self: `${sess}:${a.id}`,
    // Main's subtree is the whole session: every agent and summary hangs below it.
    sub: main ? `${sess}:*` : `${sess}:${a.id}*`,
    children,
  }
}

/** One session: its main at the top. Two or more: a level per session above each main. */
export const buildTree = (facet: readonly SessionAgents[], title: (sess: string) => string | undefined = () => undefined): PickNode[] =>
  facet.length === 1
    ? [agentNode(facet[0]!.sess, facet[0]!.main)]
    : facet.map(({ sess, main }) => {
      const name = title(sess) || 'untitled'
      const tag = '· ' + sess.slice(0, 8)
      return { key: `${sess}:*`, label: `${name} ${tag}`, name, tag, kind: 'session' as const, self: null, sub: `${sess}:*`, children: [agentNode(sess, main)] }
    })

const walk = function* (nodes: readonly PickNode[]): Generator<PickNode> {
  for (const n of nodes) { yield n; yield* walk(n.children) }
}

/** Every node's tick state; a node covered by its own or an ancestor's subtree token is on. */
export const checks = (tree: readonly PickNode[], sel: ReadonlySet<string>): Map<string, Check> => {
  const out = new Map<string, Check>()
  const visit = (n: PickNode, covered: boolean): Check => {
    const all = covered || sel.has(n.sub)
    const parts = n.children.map((c) => visit(c, all))
    if (n.self !== null) parts.push(all || sel.has(n.self) ? 'on' : 'off')
    const c: Check = parts.every((p) => p === 'on') ? 'on' : parts.every((p) => p === 'off') ? 'off' : 'mixed'
    out.set(n.key, c)
    return c
  }
  for (const n of tree) visit(n, false)
  return out
}

// The fewest tokens for a set of ticked own-row tokens: a fully ticked node becomes its subtree
// token, which also takes in agents spawned below it later.
const compress = (tree: readonly PickNode[], on: ReadonlySet<string>): Set<string> => {
  const out = new Set<string>()
  const full = (n: PickNode): boolean => (n.self === null || on.has(n.self)) && n.children.every(full)
  const emit = (n: PickNode): void => {
    if (full(n)) return void out.add(n.sub)
    if (n.self !== null && on.has(n.self)) out.add(n.self)
    n.children.forEach(emit)
  }
  tree.forEach(emit)
  return out
}

// The own-row tokens a selection covers, directly or through a subtree token.
const ticked = (tree: readonly PickNode[], sel: ReadonlySet<string>): Set<string> => {
  const on = new Set<string>()
  const visit = (n: PickNode, covered: boolean): void => {
    const all = covered || sel.has(n.sub)
    if (n.self !== null && (all || sel.has(n.self))) on.add(n.self)
    for (const c of n.children) visit(c, all)
  }
  for (const n of tree) visit(n, false)
  return on
}

/** Ticking a node ticks its whole subtree; ticking a fully ticked one clears it. */
export const toggle = (tree: readonly PickNode[], sel: ReadonlySet<string>, key: string): Set<string> => {
  const node = [...walk(tree)].find((n) => n.key === key)
  if (!node) return new Set(sel)
  const on = ticked(tree, sel)
  const turnOn = checks(tree, sel).get(key) !== 'on'
  for (const n of walk([node])) if (n.self !== null) { if (turnOn) on.add(n.self); else on.delete(n.self) }
  return compress(tree, on)
}

/** Drops tokens the tree no longer offers (pick changed); the same set when nothing changes. */
export const pruneAgents = (sel: ReadonlySet<string>, tree: readonly PickNode[]): ReadonlySet<string> => {
  if (!sel.size) return sel
  const next = compress(tree, ticked(tree, sel))
  return next.size === sel.size && [...next].every((t) => sel.has(t)) ? sel : next
}

/** The chip text: 'all' with nothing ticked (no filter), the one ticked node's name, else how many. */
export const agentSelection = (sel: ReadonlySet<string>, tree: readonly PickNode[]): string => {
  if (!sel.size) return 'all'
  const on = ticked(tree, sel)
  const names = [...walk(tree)].filter((n) => n.self !== null && on.has(n.self)).map((n) => n.label)
  return names.length === 1 ? names[0]! : String(names.length)
}

/**
 * Nodes whose label matches, with their ancestors; ticked or partly ticked nodes stay listed, and
 * so do the `listed` keys, so unticking a node the query does not match keeps it in place.
 */
export const searchTree = (tree: readonly PickNode[], q: string, sel: ReadonlySet<string>, listed: ReadonlySet<string> = new Set()): PickNode[] => {
  const s = q.trim().toLowerCase()
  if (!s) return [...tree]
  const st = checks(tree, sel)
  const keep = (n: PickNode): PickNode | null => {
    const children = n.children.map(keep).filter((c): c is PickNode => c !== null)
    return children.length || st.get(n.key) !== 'off' || listed.has(n.key) || n.label.toLowerCase().includes(s) ? { ...n, children } : null
  }
  return tree.map(keep).filter((n): n is PickNode => n !== null)
}

export const countNodes = (tree: readonly PickNode[]): number => [...walk(tree)].length
