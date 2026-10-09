import { useMemo, useRef } from 'react'
import type uPlot from 'uplot'
import type { SessionSeries } from '../../../../shared/api.ts'
import { overTime, turnMarkers } from '../../lib/series.ts'
import { bands, type Css, stackedSeries, UPlot, xAxis, yAxis } from './UPlot.tsx'

export function TokensOverTime({ series, agent, markers = true }: { series: SessionSeries; agent: boolean; markers?: boolean }) {
  const data = useMemo(() => overTime(series), [series])
  // Read at draw time, so live frames move the markers without rebuilding the chart.
  const turns = useRef<number[]>([])
  turns.current = markers ? turnMarkers(series, agent) : []

  const opts = (css: Css): Omit<uPlot.Options, 'width' | 'height'> => ({
    ms: 1,
    series: [{ label: 'Time' }, ...stackedSeries(css)],
    bands,
    axes: [xAxis(css, { space: 60 }), yAxis(css)],
    // A live setData resets the x scale, which would silently undo a drag zoom.
    cursor: { points: { show: false }, drag: { x: false } },
    hooks: {
      draw: [
        (u) => {
          const { ctx, bbox } = u
          const [min, max] = [u.scales.x?.min ?? -Infinity, u.scales.x?.max ?? Infinity]
          ctx.save()
          ctx.strokeStyle = css('--muted')
          ctx.lineWidth = devicePixelRatio
          ctx.setLineDash([3 * devicePixelRatio, 3 * devicePixelRatio])
          for (const t of turns.current) {
            if (t < min || t > max) continue
            const x = Math.round(u.valToPos(t, 'x', true)) + 0.5
            ctx.beginPath()
            ctx.moveTo(x, bbox.top)
            ctx.lineTo(x, bbox.top + bbox.height)
            ctx.stroke()
          }
          ctx.restore()
        },
      ],
    },
  })
  return <UPlot title={markers ? 'Cumulative tokens (dashed: turn starts)' : 'Cumulative tokens'} opts={opts} data={data} />
}
