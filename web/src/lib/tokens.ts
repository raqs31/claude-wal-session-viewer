// Picks the unit after rounding, so 999_950 reads 1M rather than 1000k.
const compact = (n: number, base: number, units: readonly string[], sep: string): string => {
  const round = (v: number) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10)
  let i = 0
  let v = n
  while (round(v) >= base && i < units.length - 1) {
    v /= base
    i++
  }
  return String(i === 0 ? Math.round(v) : round(v)) + sep + units[i]
}

export const fmtTokens = (n: number): string => compact(n, 1000, ['', 'k', 'M', 'B'], '')
export const fmtBytes = (n: number): string => compact(n, 1024, ['B', 'KB', 'MB', 'GB'], ' ')

export const fmtUsd = (n: number | null): string =>
  n === null ? '—' : n > 0 && n < 0.01 ? '<$0.01' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const fmtDuration = (ms: number): string => {
  if (Math.round(ms) < 1000) return `${Math.round(ms)} ms`
  // Rounded before the unit is picked, so 59_960 reads 1m 00s rather than 60 s.
  const tenths = Math.round(ms / 100)
  if (tenths < 600) return `${tenths / 10} s`
  const s = Math.round(ms / 1000)
  const p = (x: number) => String(x).padStart(2, '0')
  if (s < 3600) return `${Math.floor(s / 60)}m ${p(s % 60)}s`
  return `${Math.floor(s / 3600)}h ${p(Math.floor(s / 60) % 60)}m`
}
