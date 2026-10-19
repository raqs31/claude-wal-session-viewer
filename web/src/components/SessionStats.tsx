import { type ReactNode, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentInfo, SessionView, StatRow, Usage } from '../../../shared/api.ts'
import { agentDetail } from '../lib/agentStats.ts'
import { agentRows } from '../lib/agentTree.ts'
import { short } from '../lib/format.ts'
import { compactLabel } from '../lib/series.ts'
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
    <div className="k">
      {color && <span className="dot" style={{ background: color }} />}
      {k}
    </div>
    <div className="v">{v}</div>
  </div>
)

const n = (v: number) => v.toLocaleString()

// Short headers so the tables stay narrow; the full names are tooltips.
const COLS: { h: string; title: string; v: (r: StatRow) => number; tip: (r: StatRow) => string }[] = [
  { h: 'In', title: 'Input', v: (r) => r.input, tip: (r) => n(r.input) },
  { h: 'Out', title: 'Output (thinking included)', v: (r) => r.output, tip: (r) => `${n(r.output)} (thinking ${n(r.thinking)})` },
  { h: 'CR', title: 'Cache read', v: (r) => r.cacheRead, tip: (r) => n(r.cacheRead) },
  { h: 'CW', title: 'Cache write (5m + 1h)', v: (r) => r.cacheWrite5m + r.cacheWrite1h, tip: (r) => `5m ${n(r.cacheWrite5m)} + 1h ${n(r.cacheWrite1h)}` },
]

const CTX = "the last request's input + cache read + cache write"

const Head = ({ recorded, context }: { recorded: boolean; context?: boolean }) => (
  <thead>
    <tr>
      <th />
      <th className="r" title="Requests">
        Req
      </th>
      {COLS.map((c) => (
        <th key={c.h} className="r" title={c.title}>
          {c.h}
        </th>
      ))}
      <th className="r" title="Estimated cost">
        Est.
      </th>
      {recorded && (
        <th className="r" title="Cost recorded by Claude Code">
          Rec.
        </th>
      )}
      {context && (
        <th className="r" title={`Context at end: ${CTX}`}>
          Ctx
        </th>
      )}
    </tr>
  </thead>
)

const Cells = ({ name, label, r, rec, ctx }: { name: string; label?: ReactNode; r: StatRow | undefined; rec?: number | null; ctx?: number }) => (
  <>
    <td className="name" title={name}>
      <span>{label ?? name}</span>
    </td>
    <td className="num r">{r ? n(r.requests) : '—'}</td>
    {COLS.map((c) => (
      <td key={c.h} className="num r" title={r && c.tip(r)}>
        {r ? fmtTokens(c.v(r)) : '—'}
      </td>
    ))}
    <td className="num r">{fmtUsd(r ? r.cost : null)}</td>
    {rec !== undefined && <td className="num r">{fmtUsd(rec)}</td>}
    {ctx !== undefined && (
      <td className="num r" title={r && n(ctx)}>
        {r ? fmtTokens(ctx) : '—'}
      </td>
    )}
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
  const ctx = stats.agents.main && view.agentStats.main?.context
  return (
    <div className="tiles">
      {TOKENS.map((k) => (
        <Tile key={k.key} k={k.label} v={fmtTokens(t[k.key])} title={t[k.key].toLocaleString()} color={k.color} />
      ))}
      <Tile k="Requests" v={t.requests.toLocaleString()} />
      <Tile k="Turns" v={stats.turns.toLocaleString()} />
      <Tile k="Duration" v={fmtDuration(stats.duration)} />
      <Tile k="Cost (estimated)" v={fmtUsd(t.cost)} title={t.cost === null ? 'a model in this session has no price' : undefined} />
      {rec && <Tile k="Cost (recorded by Claude Code)" v={fmtUsd(rec.total)} />}
      <Tile k="Context at end (main)" v={ctx === undefined ? '—' : fmtTokens(ctx)} title={ctx === undefined ? undefined : `${n(ctx)}: ${CTX}`} />
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
      <div className="hscroll">
        <table className="stat">
          <Head recorded={rec !== null} />
          <tbody>
            {models.map((m) => (
              <tr key={m}>
                <Cells name={m} r={stats.models[m]} rec={rec ? (rec.models[m] ?? null) : undefined} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Clamped by CSS until opened; the full prompt is often pages long.
function AgentTask({ title, prompt, onShowEvents }: { title: string; prompt: string | null; onShowEvents: () => void }) {
  const [more, setMore] = useState(false)
  const [raw, setRaw] = useState(false)
  return (
    <div className="ag-task">
      <div className="ag-task-h">
        <span className="ag-task-k">{title}</span>
        {prompt && (
          <>
            <button type="button" onClick={() => setRaw(!raw)}>
              {raw ? 'Rendered' : 'Raw'}
            </button>
            <button type="button" onClick={() => setMore(!more)}>
              {more ? 'Show less' : 'Show more'}
            </button>
          </>
        )}
        <button type="button" onClick={onShowEvents}>
          Show in Events
        </button>
      </div>
      {prompt ? (
        <div className={more ? 'ag-task-b' : 'ag-task-b clamp'}>
          {raw ? (
            <pre>{prompt}</pre>
          ) : (
            <div className="md">
              <Markdown remarkPlugins={[remarkGfm]}>{prompt}</Markdown>
            </div>
          )}
        </div>
      ) : (
        <div className="ag-note">No prompt recorded yet.</div>
      )}
    </div>
  )
}

// Main has no spawn prompt; the session's first prompt stands in for it.
export function ByAgent({ view, firstPrompt, onShowEvents }: { view: SessionView; firstPrompt: string | null; onShowEvents: (agent: string) => void }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  const flip = (set: typeof setOpen, id: string) =>
    set((s) => {
      const x = new Set(s)
      if (!x.delete(id)) x.add(id)
      return x
    })
  // agentStats also lists agents that made no request yet.
  const ids = [...new Set([...Object.keys(view.stats.agents), ...Object.keys(view.agentStats)])]
  const parentOf = (id: string) => view.agents.find((a) => a.id === id)?.parent ?? null
  const parents = agentRows(ids, parentOf, new Set())
    .filter((r) => r.kids)
    .map((r) => r.id)
  const rows = agentRows(ids, parentOf, folded)
  return (
    <div className="stats">
      <h2 className="ag-h">
        By agent
        {parents.length > 0 && (
          <button type="button" onClick={() => setFolded(folded.size ? new Set() : new Set(parents))}>
            {folded.size ? 'Expand all' : 'Collapse all'}
          </button>
        )}
      </h2>
      <div className="hscroll">
        <table className="stat">
          <Head recorded={false} context />
          <tbody>
            {rows.map(({ id, depth, kids }) => {
              const r = view.stats.agents[id]
              return (
                <AgentRow
                  key={id}
                  span={COLS.length + 4}
                  open={open.has(id)}
                  onToggle={() => flip(setOpen, id)}
                  task={() => (
                    <AgentTask
                      title={id === 'main' ? 'First prompt' : 'Prompt'}
                      prompt={id === 'main' ? firstPrompt : (view.agents.find((a) => a.id === id)?.prompt ?? null)}
                      onShowEvents={() => onShowEvents(`${view.id}:${id}`)}
                    />
                  )}
                  detail={() => agentDetail(view, id)}
                  charts={
                    r && r.requests > 0
                      ? () => (
                          <AgentCharts
                            sess={view.id}
                            agent={id}
                            stamp={`${r.requests}:${r.input + r.output + r.cacheRead + r.cacheWrite5m + r.cacheWrite1h}`}
                          />
                        )
                      : undefined
                  }
                  cells={(toggle) => {
                    const name = agentName(view.agents, id)
                    const compacts = view.agentStats[id]?.compacts ?? []
                    const label = (
                      <span className="ag-tree" style={{ paddingLeft: `${depth * 16}px` }}>
                        {kids ? (
                          <button
                            className="ag-fold"
                            type="button"
                            aria-expanded={!folded.has(id)}
                            aria-label={folded.has(id) ? 'Expand subagents' : 'Collapse subagents'}
                            onClick={(e) => {
                              e.stopPropagation()
                              flip(setFolded, id)
                            }}
                          >
                            {folded.has(id) ? '▸' : '▾'}
                          </button>
                        ) : (
                          <span className="ag-fold" />
                        )}
                        {toggle(name)}
                        {compacts.length > 0 && (
                          <span className="badge ag-cmp" title={compacts.map(compactLabel).join('\n')}>
                            ⟲ compacted{compacts.length > 1 ? ` ×${compacts.length}` : ''}
                          </span>
                        )}
                      </span>
                    )
                    return <Cells name={name} label={label} r={r} ctx={view.agentStats[id]?.context ?? 0} />
                  }}
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
