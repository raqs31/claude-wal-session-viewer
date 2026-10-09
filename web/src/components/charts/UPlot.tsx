import { useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { fmtTokens } from '../../lib/tokens.ts'
import { LAYERS, type Layer } from '../../lib/series.ts'

export type Css = (name: string) => string
type Opts = Omit<uPlot.Options, 'width' | 'height'>

const HEIGHT = 170

const LAYER: Record<Layer, { label: string; v: string }> = {
  input: { label: 'Input', v: '--tok-input' },
  output: { label: 'Output', v: '--tok-output' },
  cacheRead: { label: 'Cache read', v: '--tok-cache-read' },
  cacheWrite: { label: 'Cache write', v: '--tok-cache-write' },
}

// Series are stacked sums; the legend shows each layer's own value.
export const stackedSeries = (css: Css, paths?: uPlot.Series.PathBuilder): uPlot.Series[] =>
  LAYERS.map((k) => ({
    label: LAYER[k].label,
    stroke: css(LAYER[k].v),
    // Every --tok-* is a #rrggbb literal, so a two-digit hex suffix is its alpha (0x99 = 60%): the
    // area stays translucent over the dashed turn markers, the bars opaque.
    fill: css(LAYER[k].v) + (paths ? '' : '99'),
    width: paths ? 0 : 1,
    paths,
    points: { show: false },
    value: (u: uPlot, _v: number | null, si: number, di: number | null) =>
      di === null ? '—' : fmtTokens((u.data[si]?.[di] ?? 0) - (si > 1 ? u.data[si - 1]?.[di] ?? 0 : 0)),
  }))

export const bands: uPlot.Band[] = LAYERS.slice(1).map((_, i) => ({ series: [i + 2, i + 1] }))

export const yAxis = (css: Css): uPlot.Axis => ({
  stroke: css('--text-secondary'), grid: { stroke: css('--grid'), width: 1 }, ticks: { show: false },
  values: (_u, splits) => splits.map(fmtTokens), size: 44,
})
export const xAxis = (css: Css, a: uPlot.Axis = {}): uPlot.Axis =>
  ({ stroke: css('--text-secondary'), grid: { show: false }, ticks: { stroke: css('--grid') }, ...a })

// Canvas ignores CSS variables, so a theme change means reading the colours again.
function useTheme(): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const bump = () => setN((x) => x + 1)
    const mo = new MutationObserver(bump)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', bump)
    return () => { mo.disconnect(); mq.removeEventListener('change', bump) }
  }, [])
  return n
}

export function UPlot({ title, opts, data }: { title: string; opts: (css: Css) => Opts; data: uPlot.AlignedData }) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<uPlot | null>(null)
  const latest = useRef({ opts, data })
  latest.current = { opts, data }
  const theme = useTheme()

  useEffect(() => {
    const box = el.current!
    let u: uPlot | null = null
    // Inside a closed <details> the box is 0 wide, and uPlot built at 0 computes a negative plot size;
    // so build on the first positive width (now or when the panel opens) and only resize after that.
    const sync = () => {
      const width = box.clientWidth
      if (width <= 0) return
      if (!u) {
        const style = getComputedStyle(box)
        u = new uPlot({ ...latest.current.opts((n) => style.getPropertyValue(n).trim()), width, height: HEIGHT }, latest.current.data, box)
        chart.current = u
      } else if (width !== u.width) u.setSize({ width, height: HEIGHT })
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(box)
    return () => { ro.disconnect(); u?.destroy(); chart.current = null }
  }, [theme])
  useEffect(() => { chart.current?.setData(data) }, [data])

  return <div className="chart-s"><h2>{title}</h2><div ref={el} className="chart" /></div>
}
