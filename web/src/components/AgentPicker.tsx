import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react'
import { agentSelection, checks, countNodes, type PickNode, searchTree } from '../lib/agents.ts'

// Past this many nodes the tree gets a search box.
const SEARCH_FROM = 8

interface Props {
  tree: readonly PickNode[]
  selected: ReadonlySet<string>
  onToggle: (key: string) => void
  not: boolean
  onAll: () => void
  onClear: () => void
  onNot: () => void
}

// The All / None / Not row shared by every filter section; Not needs something ticked to negate.
export function FilterActs({ ticked, not, onAll, onNone, onNot }: { ticked: boolean; not: boolean; onAll: () => void; onNone: () => void; onNot: () => void }) {
  return (
    <div className="acts">
      <button className="ghost" type="button" onClick={onAll}>
        All
      </button>
      <button className="ghost" type="button" disabled={!ticked && !not} onClick={onNone}>
        None
      </button>
      <button className="ghost" type="button" aria-pressed={not} disabled={!ticked} onClick={onNot}>
        Not
      </button>
    </div>
  )
}

// Open by default: the top level, and each session's main under it; deeper branches start closed.
const openByDefault = (n: PickNode, depth: number): boolean => depth === 0 || (n.kind === 'agent' && n.key.endsWith(':main'))

// `indeterminate` exists only as a DOM property; a fresh ref callback sets it on every commit.
const mixed = (on: boolean) => (el: HTMLInputElement | null) => {
  if (el) el.indeterminate = on
}

export function AgentPicker({ tree, selected, onToggle, not, onAll, onClear, onNot }: Props) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  // Keys whose branch differs from its default; never stored, so every page load starts the same.
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set())
  const root = useRef<HTMLSpanElement>(null)
  const pill = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  // The checkbox holding the tree's one tab stop (roving tabindex).
  const [active, setActive] = useState<string | null>(null)
  // Keys listed for the current query, so a node unticked mid-search does not vanish under the pointer.
  const listed = useRef({ q: '', keys: new Set<string>() })
  const openRef = useRef(open)
  openRef.current = open

  useEffect(() => {
    if (!open) return
    pop.current?.querySelector<HTMLInputElement>('input[type=search], input[type=checkbox][tabindex="0"]')?.focus()
  }, [open])
  useEffect(() => {
    // The path, not `contains`: a click can re-render its own target out of the DOM before this runs.
    const click = (e: MouseEvent) => {
      const r = root.current
      if (openRef.current && r && !e.composedPath().includes(r)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openRef.current) {
        setOpen(false)
        pill.current?.focus()
      }
    }
    document.addEventListener('click', click)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('click', click)
      document.removeEventListener('keydown', key)
    }
  }, [])

  const searching = q.trim() !== ''
  if (listed.current.q !== q) listed.current = { q, keys: new Set() }
  const shown = searchTree(tree, q, selected, listed.current.keys)
  const state = checks(tree, selected)
  const isOpen = (n: PickNode, depth: number) => searching || openByDefault(n, depth) !== flipped.has(n.key)
  const flip = (key: string) =>
    setFlipped((f) => {
      const s = new Set(f)
      if (!s.delete(key)) s.add(key)
      return s
    })
  const visible: string[] = []
  const collect = (ns: readonly PickNode[], depth: number): void =>
    ns.forEach((n) => {
      visible.push(n.key)
      listed.current.keys.add(n.key)
      if (n.children.length && isOpen(n, depth)) collect(n.children, depth + 1)
    })
  collect(shown, 0)
  const stop = active !== null && visible.includes(active) ? active : visible[0]
  // Up/Down/Home/End move between visible rows; Space toggles natively on the focused checkbox.
  const move = (e: ReactKeyboardEvent<HTMLUListElement>) => {
    const boxes = [...e.currentTarget.querySelectorAll<HTMLInputElement>('input[type=checkbox]')]
    const i = boxes.indexOf(e.target as HTMLInputElement)
    const to = i < 0 ? undefined : { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: boxes.length - 1 }[e.key]
    if (to === undefined) return
    e.preventDefault()
    boxes[Math.max(0, Math.min(boxes.length - 1, to))]?.focus()
  }

  const row = (n: PickNode, depth: number) => {
    const branch = n.children.length > 0
    const expanded = branch && isOpen(n, depth)
    const st = state.get(n.key) ?? 'off'
    // Right opens a closed branch, else steps into it; Left closes an open one, else steps to the parent.
    const keys = (e: ReactKeyboardEvent) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      e.preventDefault()
      if (branch && !searching && (e.key === 'ArrowRight') !== expanded) return flip(n.key)
      const li = (e.target as HTMLElement).closest('li')
      const to = e.key === 'ArrowRight' ? li?.querySelector('ul input') : li?.parentElement?.closest('li')?.querySelector('input')
      ;(to as HTMLInputElement | null | undefined)?.focus()
    }
    return (
      // biome-ignore lint/a11y/useFocusableInteractive: focus is roving over the checkbox inside each item, which Space toggles natively.
      <li key={n.key} role="treeitem" aria-expanded={branch ? expanded : undefined}>
        <div className="node" style={{ '--d': depth } as CSSProperties}>
          {branch ? (
            <button
              className="twisty"
              type="button"
              tabIndex={-1}
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${n.label}`}
              disabled={searching}
              onClick={() => flip(n.key)}
            >
              {expanded ? '▾' : '▸'}
            </button>
          ) : (
            <span className="twisty" />
          )}
          <label className={n.kind === 'summaries' ? 't' : undefined} title={n.label}>
            <input
              type="checkbox"
              ref={mixed(st === 'mixed')}
              tabIndex={n.key === stop ? 0 : -1}
              checked={st === 'on'}
              onChange={() => onToggle(n.key)}
              onKeyDown={keys}
              onFocus={() => setActive(n.key)}
            />
            {n.name !== undefined ? (
              <>
                <span className="lt">{n.name}</span>
                <span className="ls">{n.tag}</span>
              </>
            ) : (
              n.label
            )}
          </label>
        </div>
        {expanded && (
          // biome-ignore lint/a11y/useSemanticElements: the ARIA tree pattern nests child items in a role=group list; a fieldset cannot hold <li>.
          <ul role="group">{n.children.map((c) => row(c, depth + 1))}</ul>
        )}
      </li>
    )
  }

  return (
    <span className="dd" id="agents" ref={root}>
      <button
        className="chip"
        id="agentpill"
        type="button"
        ref={pill}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="agentpop"
        data-on={selected.size ? '' : undefined}
        data-not={selected.size > 0 && not ? '' : undefined}
        style={{ '--c': 'var(--text-secondary)' } as CSSProperties}
        onClick={() => setOpen(!open)}
      >
        <span className="dot" />
        {`agents: ${agentSelection(selected, tree)}`}
      </button>
      <div className="pop" id="agentpop" ref={pop} role="dialog" aria-label="Filter by agent" hidden={!open}>
        {countNodes(tree) > SEARCH_FROM && (
          <input type="search" placeholder="Search agents…" aria-label="Search agents" value={q} onChange={(e) => setQ(e.target.value)} />
        )}
        <FilterActs ticked={selected.size > 0} not={not} onAll={onAll} onNone={onClear} onNot={onNot} />
        {/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the ARIA tree pattern on a list keeps the nested <ul>/<li> structure valid HTML. */}
        <ul className="atree" role="tree" aria-label="Agents" data-not={selected.size > 0 && not ? '' : undefined} onKeyDown={move}>
          {shown.map((n) => row(n, 0))}
        </ul>
      </div>
    </span>
  )
}
