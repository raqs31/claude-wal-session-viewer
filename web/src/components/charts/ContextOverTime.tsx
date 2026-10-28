import { useMemo, useRef } from 'react'
import type uPlot from 'uplot'
import type { SessionSeries } from '../../../../shared/api.ts'
import { compactMarks, contextPerCall } from '../../lib/series.ts'
import { fmtTokens } from '../../lib/tokens.ts'
import { type Css, drawCompacts, UPlot, xAxis, yAxis } from './UPlot.tsx'

export function ContextOverTime({ series }: { series: SessionSeries }) {
  const data = useMemo(() => contextPerCall(series), [series])
  // Read at draw time, so live frames move the markers without rebuilding the chart.
  const compacts = useRef<{ x: number; label: string }[]>([])
  compacts.current = compactMarks(series, 'time')

  const opts = (css: Css): Omit<uPlot.Options, 'width' | 'height'> => ({
    ms: 1,
    series: [
      { label: 'Time' },
      { label: 'Context', stroke: css('--tok-input'), width: 1.5, points: { show: false }, value: (_u, v) => (v == null ? '—' : fmtTokens(v)) },
    ],
    axes: [xAxis(css, { space: 60 }), yAxis(css)],
    cursor: { points: { show: false } },
    hooks: { draw: [(u) => drawCompacts(u, css, compacts.current)] },
  })
  return <UPlot title="Context per call" opts={opts} data={data} />
}
