import { memo } from 'react'
import type { Seg, TreeNode } from '../lib/tree.ts'

const Segs = ({ ss }: { ss: readonly Seg[] }) =>
  ss.map(([c, t], i) => (
    <span key={i} className={c}>
      {t}
    </span>
  ))

function Node({ n }: { n: TreeNode }) {
  if (Array.isArray(n))
    return (
      <div>
        <Segs ss={n} />
      </div>
    )
  return (
    <details open>
      <summary>
        <Segs ss={n.h} />
        {n.o && <span className={`${n.o[0]} o`}>{n.o[1]}</span>}
        <span className="sum">{n.s}</span>
      </summary>
      <div className="kids">
        {n.k.map((k, i) => (
          <Node key={i} n={k} />
        ))}
      </div>
      {n.c && <Node n={n.c} />}
    </details>
  )
}

// Memoised so a Copy-label change in the pane doesn't re-walk the tree.
export const Tree = memo(({ nodes }: { nodes: readonly TreeNode[] }) => nodes.map((n, i) => <Node key={i} n={n} />))
