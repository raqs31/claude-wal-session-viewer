import { memo, useMemo, useState } from 'react'
import type { CallOnlyRecord, McpCallRecord, RecordResponse } from '../../../shared/api.ts'
import { fmtDate, fmtTime } from '../lib/format.ts'
import { fmtDuration } from '../lib/tokens.ts'
import { copyText, type Format, pretty, viewNodes } from '../lib/tree.ts'
import { Tree } from './Tree.tsx'

function Pane({ title, v, format, bad }: { title: string; v: unknown; format: Format; bad?: boolean }) {
  const [label, setLabel] = useState('Copy')
  const nodes = useMemo(() => (format === 'raw' ? null : viewNodes(v, format === 'yaml')), [v, format])
  // Built on click only: a 1 MB value would otherwise be serialised on every render.
  const copy = () =>
    navigator.clipboard
      .writeText(copyText(v, format))
      .then(
        () => 'Copied',
        () => 'Copy failed',
      )
      .then((m) => {
        setLabel(m)
        setTimeout(() => setLabel('Copy'), 1200)
      })
  const cls = bad ? ' bad' : ''
  return (
    <div>
      <div className="pane-h">
        {title}
        <button className="ghost" type="button" onClick={() => void copy()}>
          {label}
        </button>
      </div>
      {nodes ? (
        <div className={`tree${cls}`}>
          <Tree nodes={nodes} />
        </div>
      ) : (
        <pre className={cls.trim() || undefined}>{pretty(v)}</pre>
      )}
    </div>
  )
}

function Split({ rec, format }: { rec: McpCallRecord | CallOnlyRecord; format: Format }) {
  const { call } = rec
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
        <Pane title="Request" v={request} format={format} />
        <Pane title={failed ? (interrupted ? 'Error (interrupted)' : 'Error') : 'Response'} v={response} format={format} bad={failed} />
      </div>
    </>
  )
}

const isCall = (r: RecordResponse): r is McpCallRecord | CallOnlyRecord => 'call' in r && typeof r.call === 'object' && r.call !== null

// Keyed by format so a switch rebuilds the tree fully open, as a fresh render would. Memoised because
// EventRow re-renders on every format switch and toggle, and a big record's tree is ~10^5 nodes.
export const RecordViewer = memo(({ rec, format }: { rec: RecordResponse; format: Format }) =>
  isCall(rec) ? <Split key={format} rec={rec} format={format} /> : <Pane key={format} title="Record" v={rec} format={format} />,
)
