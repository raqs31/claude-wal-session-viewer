import { memo, useRef, useState } from 'react'
import type { RecordResponse, Row } from '../../../shared/api.ts'
import { CATEGORY } from '../lib/categories.ts'
import { fmtDate, fmtTime, short } from '../lib/format.ts'
import { toolColor } from '../lib/mcp.ts'
import { fmtTokens } from '../lib/tokens.ts'
import type { Format } from '../lib/tree.ts'
import { RecordViewer } from './RecordViewer.tsx'

type Detail = { rec: RecordResponse } | { text: string } | null

interface Props {
  r: Row
  gens: Record<string, number> | null
  format: Format
  requery: () => Promise<void>
}

const Tokens = ({ n }: { n: number | undefined }) => (
  <td className="num" title={n == null ? undefined : String(n)}>
    {n == null ? '—' : fmtTokens(n)}
  </td>
)

export const EventRow = memo(function EventRow({ r, gens, format, requery }: Props) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<Detail>(null)
  // A closed row keeps the format it was last shown in and re-renders only when reopened.
  const [shownFmt, setShownFmt] = useState(format)
  if (open && shownFmt !== format) setShownFmt(format)
  const loaded = useRef(false)

  const meta = CATEGORY[r.cat] ?? CATEGORY.session
  const label = r.virtual ? (r.tool?.split('__')[1] ?? r.tool) : r.mcp && (r.mcp === 'request' ? 'MCP req' : 'MCP res')

  const toggle = async () => {
    setOpen(!open)
    if (open || loaded.current) return
    loaded.current = true
    setDetail({ text: 'loading…' })
    try {
      const res = await fetch(`/record?id=${r.sess}&seq=${r.seq}&gen=${gens?.[r.sess]}`)
      // A stale gen means the file was truncated: this row's seq now points at other bytes.
      if (res.status === 409) return void requery()
      if (!res.ok) throw new Error(`error ${res.status}`)
      setDetail({ rec: (await res.json()) as RecordResponse })
    } catch (e) {
      setDetail({ text: (e as Error).message })
      loaded.current = false
    }
  }

  // Text children only: these strings come from tool output and file contents, so they must
  // never be parsed as markup. The same holds for the record detail.
  return (
    <>
      <tr className="row" onClick={() => void toggle()}>
        <td className="num">{fmtDate(r.t)}</td>
        <td className="num">{fmtTime(r.t)}</td>
        <td>
          <span className="ev">
            <span className="dot" style={{ background: meta.color }} />
            {meta.glyph && (
              <span className="warnglyph" style={{ color: meta.color }}>
                {meta.glyph}
              </span>
            )}
            {r.event ?? 'Unknown'}
            {label && (
              <span className="badge" style={{ color: r.err ? 'var(--status-critical)' : 'var(--cat-mcp)' }}>
                {label}
              </span>
            )}
          </span>
        </td>
        <td>
          {r.tool == null ? (
            '—'
          ) : (
            <span className="tl">
              <span className="dot" style={{ background: toolColor(r.tool) }} />
              {r.tool}
            </span>
          )}
        </td>
        <td className="num">{r.dur == null ? '—' : `${r.dur} ms`}</td>
        <Tokens n={r.out} />
        <Tokens n={r.res} />
        <Tokens n={r.out == null ? undefined : r.out + (r.res ?? 0)} />
        <td className="num">{short(r.sess)}</td>
      </tr>
      <tr hidden={!open}>
        <td colSpan={9}>{detail && ('rec' in detail ? <RecordViewer rec={detail.rec} format={shownFmt} /> : <pre>{detail.text}</pre>)}</td>
      </tr>
    </>
  )
})
