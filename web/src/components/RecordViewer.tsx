import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CallOnlyRecord, McpCallRecord, RecordResponse, WalRecord } from '../../../shared/api.ts'
import { fmtDate, fmtTime } from '../lib/format.ts'
import { mcpSections, paneBadge } from '../lib/sections.ts'
import { fmtDuration } from '../lib/tokens.ts'
import { copyText, FORMAT_LABEL, FORMATS, type Format, pretty, viewNodes } from '../lib/tree.ts'
import { Tree } from './Tree.tsx'

function CopyButton({ text }: { text: () => string }) {
  const [label, setLabel] = useState('Copy')
  // Built on click only: a 1 MB value would otherwise be serialised on every render.
  const copy = () =>
    navigator.clipboard
      .writeText(text())
      .then(
        () => 'Copied',
        () => 'Copy failed',
      )
      .then((m) => {
        setLabel(m)
        setTimeout(() => setLabel('Copy'), 1200)
      })
  return (
    <button className="ghost" type="button" onClick={() => void copy()}>
      {label}
    </button>
  )
}

function Body({ v, format, bad }: { v: unknown; format: Format; bad?: boolean }) {
  const nodes = useMemo(() => (format === 'raw' ? null : viewNodes(v, format === 'yaml')), [v, format])
  const cls = bad ? ' bad' : ''
  return nodes ? (
    <div className={`tree${cls}`}>
      <Tree nodes={nodes} />
    </div>
  ) : (
    <pre className={cls.trim() || undefined}>{pretty(v)}</pre>
  )
}

const Badge = () => (
  <span className="badge" style={{ color: 'var(--status-warning)' }}>
    truncated by hook
  </span>
)

interface PaneProps {
  title: string
  v: unknown
  format: Format
  bad?: boolean
  clamped?: boolean
  mcp?: boolean
}

// An MCP response splits into Structured, Text and Metadata; each section has its own Copy and an empty one is hidden.
function Sections({ v, format, bad }: { v: unknown; format: Format; bad?: boolean }) {
  const { structured, text, meta } = useMemo(() => mcpSections(v), [v])
  const joined = text?.join('\n\n') ?? ''
  const one = structured && (structured.length === 1 ? structured[0] : structured)
  return (
    <>
      {structured && (
        <section className="rec-sec">
          <div className="pane-h">
            Structured
            <CopyButton text={() => copyText(one, format)} />
          </div>
          <Body v={one} format={format} bad={bad} />
        </section>
      )}
      {text && (
        <section className="rec-sec">
          <div className="pane-h">
            Text
            <CopyButton text={() => joined} />
          </div>
          <pre className={bad ? 'bad' : undefined}>{joined}</pre>
        </section>
      )}
      {meta && (
        <section className="rec-sec">
          <div className="pane-h">
            Metadata
            <CopyButton text={() => copyText(meta, format)} />
          </div>
          <Body v={meta} format={format} bad={bad} />
        </section>
      )}
    </>
  )
}

function Expanded({ title, v, format, bad, clamped, mcp, root, onClose }: PaneProps & { root: Element; onClose: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null)
  const [fmt, setFmt] = useState(format)
  useEffect(() => {
    const d = dlg.current
    d?.showModal()
    return () => d?.close()
  }, [])
  // Portalled into .viz-root, which holds the theme variables, and out of the table's styles.
  return createPortal(
    <dialog
      className="rec-x"
      ref={dlg}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="pane-h">
        <span>
          {title}
          {clamped && <Badge />}
        </span>
        <span className="pane-b">
          <fieldset className="seg" aria-label="Record format">
            {FORMATS.map((f) => (
              <button key={f} className="chip" type="button" aria-pressed={f === fmt} onClick={() => setFmt(f)}>
                {FORMAT_LABEL[f]}
              </button>
            ))}
          </fieldset>
          <CopyButton text={() => copyText(v, fmt)} />
          <button className="ghost" type="button" onClick={onClose}>
            Close
          </button>
        </span>
      </div>
      <div className="rec-x-in">{mcp ? <Sections v={v} format={fmt} bad={bad} /> : <Body v={v} format={fmt} bad={bad} />}</div>
    </dialog>,
    root,
  )
}

function Pane({ title, v, format, bad, clamped, mcp }: PaneProps) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  return (
    <div ref={box}>
      <div className="pane-h">
        <span>
          {title}
          {clamped && <Badge />}
        </span>
        <span className="pane-b">
          <button className="ghost" type="button" onClick={() => setOpen(true)}>
            Expand
          </button>
          <CopyButton text={() => copyText(v, format)} />
        </span>
      </div>
      <Body v={v} format={format} bad={bad} />
      {open && (
        <Expanded
          title={title}
          v={v}
          format={format}
          bad={bad}
          clamped={clamped}
          mcp={mcp}
          root={box.current?.closest('.viz-root') ?? document.body}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

function Split({ rec, format }: { rec: McpCallRecord | CallOnlyRecord; format: Format }) {
  const { call, restored } = rec
  const pre = 'pre' in rec ? rec.pre : undefined
  const post = 'post' in rec ? rec.post : undefined
  const failed = post ? post.event === 'PostToolUseFailure' : call.err
  const interrupted = post?.payload?.is_interrupt
  const request = pre ? (pre.payload?.tool_input ?? post?.payload?.tool_input) : call.input
  const response = post ? (failed ? post.payload?.error : post.payload?.tool_response) : call.response
  return (
    <>
      <div className="span">
        {`${fmtDate(call.t)} ${fmtTime(call.t)} → ${fmtTime(call.end)}`}
        {call.dur != null && ` (${fmtDuration(call.dur)})`}
      </div>
      <div className="split">
        <Pane title="Request" v={request} format={format} clamped={paneBadge(request, restored?.input, pre)} />
        <Pane
          title={failed ? (interrupted ? 'Error (interrupted)' : 'Error') : 'Response'}
          v={response}
          format={format}
          bad={failed}
          clamped={paneBadge(response, restored?.response, post)}
          mcp={call.mcp === true}
        />
      </div>
    </>
  )
}

const isCall = (r: RecordResponse): r is McpCallRecord | CallOnlyRecord => 'call' in r && typeof r.call === 'object' && r.call !== null

// Keyed by format so a switch rebuilds the tree fully open, as a fresh render would. Memoised because
// EventRow re-renders on every format switch and toggle, and a big record's tree is ~10^5 nodes.
// A plain event restores the side of its event: PreToolUse its input, any Post* its response.
const recordRestored = (rec: WalRecord) => (rec.event === 'PreToolUse' ? rec.restored?.input : rec.restored?.response)

export const RecordViewer = memo(({ rec, format }: { rec: RecordResponse; format: Format }) =>
  isCall(rec) ? (
    <Split key={format} rec={rec} format={format} />
  ) : (
    <Pane key={format} title="Record" v={rec} format={format} clamped={paneBadge(rec, recordRestored(rec))} />
  ),
)
