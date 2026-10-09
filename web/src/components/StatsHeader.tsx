import { CATEGORIES } from '../../../shared/api.ts'
import { CATEGORY } from '../lib/categories.ts'
import { fmtDuration } from '../lib/tokens.ts'
import type { Stats } from '../useEvents.ts'

interface Props extends Stats { shown: number; ready: boolean; error: string | null }

export function StatsHeader({ total, head, counts, spans, shown, ready, error }: Props) {
  const span = Object.values(spans).reduce((n, [a, b]) => n + b - a, 0)
  const label = error !== null
    ? `could not load events (${error}) · change a filter or click the status to retry`
    : ready ? `matching events · showing ${shown.toLocaleString()} · ${head.toLocaleString()} recorded` : 'matching events'
  return (
    <>
      <span className="evl-total">{total.toLocaleString()}</span>
      <span className="evl-label">{label}</span>
      <span className="evl-span" title="length: the sum of first→last matching event per session">{fmtDuration(span)}</span>
      <span className="evl-cats">
        {CATEGORIES.map((c) => (
          <span key={c} className="evl-cat"><span className="dot" style={{ background: CATEGORY[c].color }} />{CATEGORY[c].label}<b>{(counts[c] || 0).toLocaleString()}</b></span>
        ))}
      </span>
    </>
  )
}
