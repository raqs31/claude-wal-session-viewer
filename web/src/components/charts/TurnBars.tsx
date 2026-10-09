import { useMemo, useRef } from 'react'
import uPlot from 'uplot'
import type { SessionSeries } from '../../../../shared/api.ts'
import { perCall, perTurn } from '../../lib/series.ts'
import { bands, type Css, stackedSeries, UPlot, xAxis, yAxis } from './UPlot.tsx'

export function TurnBars({ series, agent, by = 'turn' }: { series: SessionSeries; agent: boolean; by?: 'turn' | 'call' }) {
  const cols = useMemo(() => (by === 'call' ? perCall(series) : perTurn(series, agent)), [series, agent, by])
  // Plotted by position, so an agent scope's few turns sit side by side; labels read the real turn number.
  const turns = useRef(cols[0])
  turns.current = cols[0]
  const data = useMemo((): uPlot.AlignedData => [cols[0].map((_, i) => i), ...cols.slice(1)], [cols])
  const label = (v: number) => String(turns.current[v] ?? '')
  const opts = (css: Css): Omit<uPlot.Options, 'width' | 'height'> => ({
    series: [
      { label: by === 'call' ? 'Call' : 'Turn', value: (_u, v) => (v === null ? '—' : label(v)) },
      ...stackedSeries(css, uPlot.paths.bars?.({ size: [0.8, 40], align: 0 })),
    ],
    bands,
    scales: { x: { time: false, range: (_u, min, max) => [min - 0.5, max + 0.5] } },
    axes: [xAxis(css, { space: 30, values: (_u, splits) => splits.map((v) => (Number.isInteger(v) ? label(v) : '')) }), yAxis(css)],
    // A live setData resets the x scale, which would silently undo a drag zoom.
    cursor: { points: { show: false }, drag: { x: false } },
  })
  return <UPlot title={by === 'call' ? 'Tokens per API call' : 'Tokens per turn'} opts={opts} data={data} />
}
