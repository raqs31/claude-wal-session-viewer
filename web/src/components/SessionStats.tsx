import { useState, type ReactNode } from 'react'
import type { AgentInfo, SessionView, StatRow, Usage } from '../../../shared/api.ts'
import { agentDetail } from '../lib/agentStats.ts'
import { short } from '../lib/format.ts'
import { fmtDuration, fmtTokens, fmtUsd } from '../lib/tokens.ts'
import { AgentRow } from './AgentRow.tsx'
import { AgentCharts } from './charts/AgentCharts.tsx'

const TOKENS: { key: keyof Usage; label: string; color: string }[] = [
  { key: 'input', label: 'Input', color: 'var(--tok-input)' },
  { key: 'output', label: 'Output', color: 'var(--tok-output)' },
  { key: 'cacheRead', label: 'Cache read', color: 'var(--tok-cache-read)' },
  { key: 'cacheWrite5m', label: 'Cache write 5m', color: 'var(--tok-cache-write)' },
  { key: 'cacheWrite1h', label: 'Cache write 1h', color: 'var(--tok-cache-write)' },
  { key: 'thinking', label: 'Thinking (in output)', color: 'var(--tok-thinking)' },
]

const Tile = ({ k, v, title, color }: { k: string; v: string; title?: string; color?: string }) => (
  <div className="tile" title={title}>
    <div className="k">{color && <span className="dot" style={{ background: color }} />}{k}</div>
    <div className="v">{v}</div>
  </div>
)

const n = (v: number) => v.toLocaleString()

// Short headers so the tables stay narrow; the full names are tooltips.
const COLS: { h: string; title: string; v: (r: StatRow) => number; tip: (r: StatRow) => string }[] = [
  { h: 'In', title: 'Input', v: (r) => r.input, tip: (r) => n(r.input) },
  { h: 'Out', title: 'Output (thinking included)', v: (r) => r.output, tip: (r) => `${n(r.output)} (thinking ${n(r.thinking)})` },
  { h: 'CR', title: 'Cache read', v: (r) => r.cacheRead, tip: (r) => n(r.cacheRead) },
  { h: 'CW', title: 'Cache write (5m + 1h)', v: (r) => r.cacheWrite5m + r.cacheWrite1h,
    tip: (r) => `5m ${n(r.cacheWrite5m)} + 1h ${n(r.cacheWrite1h)}` },
]

const Head = ({ recorded }: { recorded: boolean }) => (
  <thead><tr>
    <th />
    <th className="r" title="Requests">Req</th>
    {COLS.map((c) => <th key={c.h} className="r" title={c.title}>{c.h}</th>)}
    <th className="r" title="Estimated cost">Est.</th>
    {recorded && <th className="r" title="Cost recorded by Claude Code">Rec.</th>}
  </tr></thead>
)

const Cells = ({ name, label, r, rec }: { name: string; label?: ReactNode; r: StatRow | undefined; rec?: number | null }) => (
  <>
    <td className="name" title={name}><span>{label ?? name}</span></td>
    <td className="num r">{r ? n(r.requests) : '—'}</td>
    {COLS.map((c) => <td key={c.h} className="num r" title={r && c.tip(r)}>{r ? fmtTokens(c.v(r)) : '—'}</td>)}
    <td className="num r">{fmtUsd(r ? r.cost : null)}</td>
    {rec !== undefined && <td className="num r">{fmtUsd(rec)}</td>}
  </>
)

export const agentLabel = (a: AgentInfo): string => [a.type, a.description].filter(Boolean).join(' — ') || a.id

export const agentName = (agents: AgentInfo[], id: string): string => {
  if (id === 'main') return 'Main'
  const a = agents.find((x) => x.id === id)
  return a ? agentLabel(a) : short(id)
}

export function Totals({ view }: { view: SessionView }) {
  const { stats, recordedCostUsd: rec } = view
  const t = stats.totals
  return (
    <div className="tiles">
      {TOKENS.map((k) => <Tile key={k.key} k={k.label} v={fmtTokens(t[k.key])} title={t[k.key].toLocaleString()} color={k.color} />)}
      <Tile k="Requests" v={t.requests.toLocaleString()} />
      <Tile k="Turns" v={stats.turns.toLocaleString()} />
      <Tile k="Duration" v={fmtDuration(stats.duration)} />
      <Tile k="Cost (estimated)" v={fmtUsd(t.cost)} title={t.cost === null ? 'a model in this session has no price' : undefined} />
      {rec && <Tile k="Cost (recorded by Claude Code)" v={fmtUsd(rec.total)} />}
    </div>
  )
}

export function ByModel({ view }: { view: SessionView }) {
  const { stats, recordedCostUsd: rec } = view
  // Claude Code records models that never appear as a transcript reply (e.g. its own Haiku calls).
  const models = [...new Set([...Object.keys(stats.models), ...Object.keys(rec?.models ?? {})])]
  return (
    <div className="stats">
      <h2>By model</h2>
      <div className="hscroll"><table className="stat">
        <Head recorded={rec !== null} />
        <tbody>
          {models.map((m) => <tr key={m}><Cells name={m} r={stats.models[m]} rec={rec ? rec.models[m] ?? null : undefined} /></tr>)}
        </tbody>
      </table></div>
    </div>
  )
}

export function ByAgent({ view }: { view: SessionView }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const flip = (id: string) => setOpen((s) => { const x = new Set(s); if (!x.delete(id)) x.add(id); return x })
  // agentStats also lists agents that made no request yet.
  const ids = [...new Set([...Object.keys(view.stats.agents), ...Object.keys(view.agentStats)])]
  return (
    <div className="stats">
      <h2>By agent</h2>
      <div className="hscroll"><table className="stat">
        <Head recorded={false} />
        <tbody>
          {ids.map((id) => (
            <AgentRow key={id} span={COLS.length + 3} open={open.has(id)} onToggle={() => flip(id)} detail={() => agentDetail(view, id)}
              charts={id !== 'main' && (view.stats.agents[id]?.requests ?? 0) > 0 ? () => <AgentCharts sess={view.id} agent={id} stamp={((r) => `${r.requests}:${r.input + r.output + r.cacheRead + r.cacheWrite5m + r.cacheWrite1h}`)(view.stats.agents[id]!)} /> : undefined}
              cells={(toggle) => { const name = agentName(view.agents, id); return <Cells name={name} label={toggle(name)} r={view.stats.agents[id]} /> }} />
          ))}
        </tbody>
      </table></div>
    </div>
  )
}
