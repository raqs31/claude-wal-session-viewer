import type { UsageTotals } from '../../../shared/api.ts'
import { fmtTokens, fmtUsd } from './tokens.ts'

export interface UsageTile { key: string; label: string; value: string; title?: string; color?: string }

const n = (v: number) => v.toLocaleString()

// `null` (no pick yet, or the first /usage still in flight) renders every tile as `—`.
export const usageTiles = (u: UsageTotals | null): UsageTile[] => {
  const t = u?.totals
  const tok = (v: number | undefined) => (v === undefined ? '—' : fmtTokens(v))
  const s = (k: number) => (k === 1 ? '' : 's')
  return [
    { key: 'input', label: 'Input', value: tok(t?.input), title: t && n(t.input), color: 'var(--tok-input)' },
    { key: 'output', label: 'Output', value: tok(t?.output), title: t && `${n(t.output)} (thinking ${n(t.thinking)})`, color: 'var(--tok-output)' },
    { key: 'cacheRead', label: 'Cache read', value: tok(t?.cacheRead), title: t && n(t.cacheRead), color: 'var(--tok-cache-read)' },
    { key: 'cacheWrite', label: 'Cache write', value: tok(t && t.cacheWrite5m + t.cacheWrite1h),
      title: t && `5m ${n(t.cacheWrite5m)} + 1h ${n(t.cacheWrite1h)}`, color: 'var(--tok-cache-write)' },
    { key: 'estimated', label: 'Estimated cost', value: t ? fmtUsd(t.cost) : '—' },
    { key: 'recorded', label: 'Recorded cost', value: u ? fmtUsd(u.recorded) : '—',
      title: u && u.missing > 0 ? `${u.missing} session${s(u.missing)} without recorded cost` : undefined },
  ]
}
