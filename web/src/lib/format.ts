const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
export const fmtDate = (t: number): string => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
export const fmtTime = (t: number): string => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` }
export const short = (s: string | null): string => (s ? String(s).slice(0, 8) : '—')
// Coarse on purpose: the sidebar re-renders on each 5 s poll, so finer than a minute would flicker.
export const fmtAgo = (t: number, now: number): string => {
  const m = Math.floor(Math.max(0, now - t) / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`
}
