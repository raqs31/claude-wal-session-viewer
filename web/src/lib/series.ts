import type { AdditiveKey, SessionSeries, StatRow } from '../../../shared/api.ts'

export type Layer = 'input' | 'output' | 'cacheRead' | 'cacheWrite'
// Bottom to top of every stack.
export const LAYERS: Layer[] = ['input', 'output', 'cacheRead', 'cacheWrite']

const layer = (c: Record<AdditiveKey, number[]>, k: Layer): number[] =>
  k === 'cacheWrite' ? c.cacheWrite5m.map((v, i) => v + (c.cacheWrite1h[i] ?? 0)) : c[k]

// Row i is the running sum of layers 0..i, so band i fills between row i and row i-1; a layer's own
// value is row i minus row i-1.
export const stack = (cols: number[][]): number[][] => {
  const out: number[][] = []
  for (const c of cols) {
    const prev = out.at(-1)
    out.push(prev ? c.map((v, i) => v + (prev[i] ?? 0)) : [...c])
  }
  return out
}

type Columns = [number[], ...number[][]]

// Thinking is already inside output, so it is never a layer.
export const overTime = (s: SessionSeries): Columns => [s.t, ...stack(LAYERS.map((k) => layer(s.cumulative, k)))]

const step = (c: number[]): number[] => c.map((v, i) => v - (c[i - 1] ?? 0))

// x is the call number from 1; each layer is that call's own usage.
export const perCall = (s: SessionSeries): Columns => [s.t.map((_, i) => i + 1), ...stack(LAYERS.map((k) => step(layer(s.cumulative, k))))]

const workedTurns = (s: SessionSeries): Set<number> => {
  const cols = LAYERS.map((k) => layer(s.perTurn, k))
  return new Set(s.perTurn.input.map((_, i) => i).filter((i) => cols.some((c) => c[i]! > 0)))
}

// x is the turn number; turn 0 is whatever ran before the first prompt. `onlyWorked` (an agent scope,
// which spends tokens in only the main turn(s) it ran in) drops the turns where the scope spent nothing.
export const perTurn = (s: SessionSeries, onlyWorked = false): Columns => {
  const w = onlyWorked ? workedTurns(s) : null
  const keep = s.perTurn.input.map((_, i) => i).filter((i) => !w || w.has(i))
  return [keep, ...stack(LAYERS.map((k) => { const c = layer(s.perTurn, k); return keep.map((i) => c[i]!) }))]
}

// Turn i + 1 starts at turnStarts[i].
export const turnMarkers = (s: SessionSeries, onlyWorked = false): number[] => {
  if (!onlyWorked) return s.turnStarts
  const w = workedTurns(s)
  return s.turnStarts.filter((_, i) => w.has(i + 1))
}

interface Share { key: string; tokens: number; pct: number }

const tokensOf = (r: StatRow): number => r.input + r.output + r.cacheRead + r.cacheWrite5m + r.cacheWrite1h

export const shares = (rows: Record<string, StatRow>): Share[] => {
  const all = Object.entries(rows).map(([key, r]) => ({ key, tokens: tokensOf(r) })).filter((x) => x.tokens > 0)
  const total = all.reduce((a, x) => a + x.tokens, 0)
  return all.sort((a, b) => b.tokens - a.tokens).map((x) => ({ ...x, pct: (x.tokens / total) * 100 }))
}
