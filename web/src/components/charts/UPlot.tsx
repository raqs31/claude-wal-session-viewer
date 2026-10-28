import { type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { LAYERS, type Layer } from '../../lib/series.ts'
import { fmtTokens } from '../../lib/tokens.ts'

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
      di === null ? '—' : fmtTokens((u.data[si]?.[di] ?? 0) - (si > 1 ? (u.data[si - 1]?.[di] ?? 0) : 0)),
  }))

export const bands: uPlot.Band[] = LAYERS.slice(1).map((_, i) => ({ series: [i + 2, i + 1] }))

export const yAxis = (css: Css): uPlot.Axis => ({
  stroke: css('--text-secondary'),
  grid: { stroke: css('--grid'), width: 1 },
  ticks: { show: false },
  values: (_u, splits) => splits.map(fmtTokens),
  size: 44,
})
export const xAxis = (css: Css, a: uPlot.Axis = {}): uPlot.Axis => ({
  stroke: css('--text-secondary'),
  grid: { show: false },
  ticks: { stroke: css('--grid') },
  ...a,
})

// Canvas ignores CSS variables, so a theme change means reading the colours again.
function useTheme(): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const bump = () => setN((x) => x + 1)
    const mo = new MutationObserver(bump)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', bump)
    return () => {
      mo.disconnect()
      mq.removeEventListener('change', bump)
    }
  }, [])
  return n
}

interface ChartProps {
  opts: (css: Css) => Opts
  data: uPlot.AlignedData
}

// Solid and labelled, so they read apart from the dashed turn starts.
export const drawCompacts = (u: uPlot, css: Css, marks: readonly { x: number; label: string }[]): void => {
  const { ctx, bbox } = u
  const [min, max] = [u.scales.x?.min ?? -Infinity, u.scales.x?.max ?? Infinity]
  ctx.save()
  ctx.strokeStyle = ctx.fillStyle = css('--status-critical')
  ctx.lineWidth = 1.5 * devicePixelRatio
  ctx.font = `${11 * devicePixelRatio}px system-ui, sans-serif`
  ctx.textBaseline = 'top'
  for (const m of marks) {
    if (m.x < min || m.x > max) continue
    const x = Math.round(u.valToPos(m.x, 'x', true)) + 0.5
    ctx.beginPath()
    ctx.moveTo(x, bbox.top)
    ctx.lineTo(x, bbox.top + bbox.height)
    ctx.stroke()
    const w = ctx.measureText(m.label).width
    ctx.fillText(
      m.label,
      x + 4 * devicePixelRatio + w > bbox.left + bbox.width ? x - 4 * devicePixelRatio - w : x + 4 * devicePixelRatio,
      bbox.top + 2 * devicePixelRatio,
    )
  }
  ctx.restore()
}

type Zoom = readonly [number, number] | null

function Head({ title, zoom, reset, children }: { title: string; zoom: Zoom; reset: () => void; children?: ReactNode }) {
  return (
    <div className="chart-h">
      <h2>{title}</h2>
      {zoom && (
        <button type="button" className="ghost" onClick={reset}>
          Reset zoom
        </button>
      )}
      {children}
    </div>
  )
}

export function UPlot({ title, ...props }: ChartProps & { title: string }) {
  // Keyed by theme: a theme change remounts the chart, which rebuilds it with the colours read again.
  const theme = useTheme()
  const [zoom, setZoom] = useState<Zoom>(null)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  return (
    <div className="chart-s" ref={box}>
      <Head title={title} zoom={zoom} reset={() => setZoom(null)} />
      <Chart key={theme} {...props} zoom={zoom} onZoom={setZoom} onClick={() => setOpen(true)} />
      {open && <Expanded key={theme} title={title} {...props} root={box.current?.closest('.viz-root') ?? document.body} onClose={() => setOpen(false)} />}
    </div>
  )
}

function Expanded({ title, root, onClose, ...props }: ChartProps & { title: string; root: Element; onClose: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null)
  const [zoom, setZoom] = useState<Zoom>(null)
  const [height] = useState(() => Math.max(HEIGHT, Math.round(innerHeight * 0.65)))
  useEffect(() => {
    const d = dlg.current
    d?.showModal()
    return () => d?.close()
  }, [])
  // Portalled into .viz-root, which holds the theme variables, and out of the page's section styles.
  // React still bubbles its clicks to the chart's ancestors (an agent row toggles on click), so they stop here.
  return createPortal(
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes it through the native cancel event.
    <dialog
      className="chart-x"
      ref={dlg}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        e.stopPropagation()
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="chart-x-in">
        <Head title={title} zoom={zoom} reset={() => setZoom(null)}>
          <button type="button" className="ghost chart-x-close" onClick={onClose}>
            Close
          </button>
        </Head>
        <Chart {...props} height={height} zoom={zoom} onZoom={setZoom} />
      </div>
    </dialog>,
    root,
  )
}

function Chart({
  opts,
  data,
  height = HEIGHT,
  zoom,
  onZoom,
  onClick,
}: ChartProps & { height?: number; zoom: Zoom; onZoom: (z: Zoom) => void; onClick?: () => void }) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<uPlot | null>(null)
  const latest = useRef({ opts, data, zoom, onZoom, onClick })
  latest.current = { opts, data, zoom, onZoom, onClick }

  useEffect(() => {
    const box = el.current
    if (!box) return
    let u: uPlot | null = null
    // The drag only reports its range: the zoom lives in React state, so a reset or a rebuild can reapply it.
    const select = (u: uPlot) => {
      const { left, width } = u.select
      if (width < 2) return
      u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false)
      latest.current.onZoom([u.posToVal(left, 'x'), u.posToVal(left + width, 'x')])
    }
    // Inside a closed <details> the box is 0 wide, and uPlot built at 0 computes a negative plot size;
    // so build on the first positive width (now or when the panel opens) and only resize after that.
    const sync = () => {
      const width = box.clientWidth
      if (width <= 0) return
      if (!u) {
        const style = getComputedStyle(box)
        const o = latest.current.opts((n) => style.getPropertyValue(n).trim())
        u = new uPlot(
          {
            ...o,
            cursor: { ...o.cursor, drag: { x: true, y: false, setScale: false } },
            hooks: { ...o.hooks, setSelect: [...(o.hooks?.setSelect ?? []), select] },
            width,
            height,
          },
          latest.current.data,
          box,
        )
        chart.current = u
        const z = latest.current.zoom
        if (z) u.setScale('x', { min: z[0], max: z[1] })
        // A drag ends in a click too; only a press that stayed put opens the chart.
        let down = 0
        u.over.addEventListener('mousedown', (e) => {
          down = e.clientX
        })
        u.over.addEventListener('click', (e) => {
          if (Math.abs(e.clientX - down) < 3) latest.current.onClick?.()
        })
        if (latest.current.onClick) u.over.style.cursor = 'zoom-in'
      } else if (width !== u.width) u.setSize({ width, height })
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(box)
    return () => {
      ro.disconnect()
      u?.destroy()
      chart.current = null
    }
  }, [height])
  useEffect(() => {
    const u = chart.current
    if (!u) return
    if (zoom) u.setScale('x', { min: zoom[0], max: zoom[1] })
    else u.setData(u.data)
  }, [zoom])
  // A live frame must not reset the x scale while zoomed, or the zoom would silently jump back.
  useEffect(() => {
    chart.current?.setData(data, latest.current.zoom === null)
  }, [data])

  return <div ref={el} className="chart" />
}
