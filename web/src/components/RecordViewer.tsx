import { memo, useMemo, useState } from 'react'
import type { McpCallRecord, RecordResponse } from '../../../shared/api.ts'
import { copyText, pretty, viewNodes, type Format } from '../lib/tree.ts'
import { Tree } from './Tree.tsx'

function Pane({ title, v, format, bad }: { title: string; v: unknown; format: Format; bad?: boolean }) {
  const [label, setLabel] = useState('Copy')
  const nodes = useMemo(() => (format === 'raw' ? null : viewNodes(v, format === 'yaml')), [v, format])
  // Built on click only: a 1 MB value would otherwise be serialised on every render.
  const copy = () => navigator.clipboard.writeText(copyText(v, format)).then(() => 'Copied', () => 'Copy failed')
    .then((m) => { setLabel(m); setTimeout(() => setLabel('Copy'), 1200) })
  const cls = bad ? ' bad' : ''
  return (
    <div>
      <div className="pane-h">{title}<button className="ghost" type="button" onClick={() => void copy()}>{label}</button></div>
      {nodes ? <div className={'tree' + cls}><Tree nodes={nodes} /></div> : <pre className={cls.trim() || undefined}>{pretty(v)}</pre>}
    </div>
  )
}

function Split({ rec: { pre, post }, format }: { rec: McpCallRecord; format: Format }) {
  const failed = post.event === 'PostToolUseFailure'
  return (
    <div className="split">
      <Pane title="Request" v={pre.payload?.tool_input ?? post.payload?.tool_input} format={format} />
      {failed
        ? <Pane title={post.payload?.is_interrupt ? 'Error (interrupted)' : 'Error'} v={post.payload?.error} format={format} bad />
        : <Pane title="Response" v={post.payload?.tool_response} format={format} />}
    </div>
  )
}

const isCall = (r: RecordResponse): r is McpCallRecord => !!r.virtual

// Keyed by format so a switch rebuilds the tree fully open, as a fresh render would. Memoised because
// EventRow re-renders on every format switch and toggle, and a big record's tree is ~10^5 nodes.
export const RecordViewer = memo(({ rec, format }: { rec: RecordResponse; format: Format }) =>
  isCall(rec) ? <Split key={format} rec={rec} format={format} /> : <Pane key={format} title="Record" v={rec} format={format} />)
