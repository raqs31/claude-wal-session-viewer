import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { groupMcp, mcpParts, toolColor } from '../lib/mcp.ts'

type SetTools = (ts: readonly string[], on: boolean) => void

function Box({ ts, selected, onSet }: { ts: readonly string[]; selected: ReadonlySet<string>; onSet: SetTools }) {
  const ref = useRef<HTMLInputElement>(null)
  const on = ts.filter((t) => selected.has(t)).length
  useLayoutEffect(() => { ref.current!.indeterminate = on > 0 && on < ts.length })
  return <input type="checkbox" ref={ref} checked={on === ts.length} onChange={(e) => onSet(ts, e.target.checked)} />
}

export function McpPanel({ tools, selected, onSet }: { tools: readonly string[]; selected: ReadonlySet<string>; onSet: SetTools }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const root = useRef<HTMLSpanElement>(null)
  const pill = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const openRef = useRef(open)
  openRef.current = open

  const n = tools.filter((t) => mcpParts(t) && selected.has(t)).length
  // The search only narrows this list; the event filter is whatever is checked.
  const groups = groupMcp(tools, q)
  const visible = groups.flatMap((g) => g.tools)

  useEffect(() => { if (open) search.current!.focus() }, [open])
  useEffect(() => {
    const click = (e: MouseEvent) => { if (openRef.current && !root.current!.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && openRef.current) { setOpen(false); pill.current!.focus() } }
    document.addEventListener('click', click)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('click', click); document.removeEventListener('keydown', key) }
  }, [])

  return (
    <span className="mcp" id="mcp" ref={root} hidden={!tools.some((t) => mcpParts(t))}>
      <button className="chip" id="mcppill" type="button" ref={pill} aria-expanded={open} data-on={n > 0 ? '' : undefined}
        style={{ '--c': 'var(--cat-mcp)' } as CSSProperties} onClick={() => setOpen(!open)}>
        <span className="dot" /><span id="mcplabel">{n ? `MCP calls · ${n}` : 'MCP calls'}</span>
      </button>
      <div className="pop" id="mcppop" hidden={!open}>
        <input type="search" id="mcpq" ref={search} placeholder="Search MCP servers or tools…" aria-label="Search MCP tools"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="acts">
          <button className="ghost" id="mcpall" type="button" onClick={() => onSet(visible, true)}>Select all</button>
          <button className="ghost" id="mcpnone" type="button" onClick={() => onSet(visible, false)}>Deselect all</button>
        </div>
        <div id="mcplist">
          {groups.map((g) => (
            <Fragment key={g.server}>
              <label><Box ts={g.tools} selected={selected} onSet={onSet} /><span className="dot" style={{ background: toolColor(g.tools[0]!) }} />{g.server}</label>
              {g.tools.map((t) => (
                <label key={t} className="t"><Box ts={[t]} selected={selected} onSet={onSet} />{mcpParts(t)![1]}</label>
              ))}
            </Fragment>
          ))}
        </div>
      </div>
    </span>
  )
}
