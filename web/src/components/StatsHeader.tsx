import { useState } from 'react'
import { createPortal } from 'react-dom'
import { CATEGORIES, type Pipe } from '../../../shared/api.ts'
import { CATEGORY } from '../lib/categories.ts'
import { short } from '../lib/format.ts'
import { fmtDuration } from '../lib/tokens.ts'
import type { Stats } from '../useEvents.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'

export type Stale = { id: string; reason: string }

// The note for the picked sessions the observer still builds: "building N%" from their pipe bytes, or "building" alone
// when those show no gap (a torn last line keeps done short of total, so bytes alone cannot say a session is done).
export const buildingNote = (pipe: Readonly<Record<string, Pipe>>, building: ReadonlySet<string>, ids: readonly string[]): string | null => {
  const mine = ids.filter((id) => building.has(id))
  if (mine.length === 0) return null
  let done = 0
  let total = 0
  for (const id of mine) {
    const p = pipe[id]
    if (!p) continue
    done += Math.min(p.done, p.total)
    total += p.total
  }
  return total > 0 && done < total ? `building ${Math.floor((done / total) * 100)}%` : 'building'
}

// The badge shows for any stale session; Rebuild is offered only to the server that owns the cache.
export function StaleBadge({
  stale,
  readOnly,
  rebuild,
}: {
  stale: readonly Stale[]
  readOnly: boolean
  rebuild: (ids: readonly string[]) => Promise<string | null>
}) {
  const [ask, setAsk] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (stale.length === 0) return null
  const run = async () => {
    setAsk(false)
    setErr(await rebuild(stale.map((x) => x.id)))
  }
  return (
    <>
      <span className="badge stale" title={stale.map((x) => `${short(x.id)}: ${x.reason}`).join('\n')}>
        source changed — rebuild
      </span>
      {!readOnly && (
        <button className="ghost" type="button" onClick={() => setAsk(true)}>
          Rebuild
        </button>
      )}
      {err !== null && <span className="evl-err">could not rebuild ({err})</span>}
      {ask &&
        createPortal(
          <ConfirmDialog
            title={`Rebuild ${stale.length} session${stale.length === 1 ? '' : 's'}`}
            confirmLabel="Rebuild"
            countLabel="to rebuild"
            items={stale.map((x) => ({ name: `${short(x.id)} · ${x.reason}` }))}
            onConfirm={() => void run()}
            onCancel={() => setAsk(false)}
          />,
          document.querySelector('.viz-root') ?? document.body,
        )}
    </>
  )
}

interface Props extends Stats {
  shown: number
  ready: boolean
  error: string | null
  building: string | null
  stale: readonly Stale[]
  readOnly: boolean
  rebuild: (ids: readonly string[]) => Promise<string | null>
}

export function StatsHeader({ total, head, counts, spans, shown, ready, error, building, stale, readOnly, rebuild }: Props) {
  const span = Object.values(spans).reduce((n, [a, b]) => n + b - a, 0)
  const label =
    error !== null
      ? `could not load events (${error}) · change a filter or click the status to retry`
      : ready
        ? `matching events · showing ${shown.toLocaleString()} · ${head.toLocaleString()} recorded`
        : 'matching events'
  return (
    <>
      <span className="evl-total">{total.toLocaleString()}</span>
      <span className="evl-label">{label}</span>
      {building !== null && (
        <span className="badge building" title="the session's rows are still being indexed">
          {building}
        </span>
      )}
      <StaleBadge stale={stale} readOnly={readOnly} rebuild={rebuild} />
      <span className="evl-span" title="length: the sum of first→last matching event per session">
        {fmtDuration(span)}
      </span>
      <span className="evl-cats">
        {CATEGORIES.map((c) => (
          <span key={c} className="evl-cat">
            <span className="dot" style={{ background: CATEGORY[c].color }} />
            {CATEGORY[c].label}
            <b>{(counts[c] || 0).toLocaleString()}</b>
          </span>
        ))}
      </span>
    </>
  )
}
