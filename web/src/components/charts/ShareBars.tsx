import type { StatRow } from '../../../../shared/api.ts'
import { shares } from '../../lib/series.ts'
import { fmtTokens } from '../../lib/tokens.ts'

const PALETTE = ['--cat-tool', '--cat-turn', '--cat-session', '--cat-mcp']

interface Seg {
  key: string
  label: string
  tokens: number
  pct: number
  color: string
}

// Colours follow `order` (not rank), so a row keeps its colour while shares shift; rows past the
// palette merge into one Other segment. Keys missing from `order` go after it, alphabetically.
function segments(rows: Record<string, StatRow>, order: string[], name: (key: string) => string): Seg[] {
  const s = shares(rows)
  const present = new Set(s.map((x) => x.key))
  const stable = [...order.filter((k) => present.has(k)), ...[...present].filter((k) => !order.includes(k)).sort()]
  const slot = new Map(stable.map((k, i) => [k, i]))
  const out: Seg[] = []
  const other: Seg = { key: '\0other', label: 'Other', tokens: 0, pct: 0, color: 'var(--muted)' }
  for (const x of s) {
    const i = slot.get(x.key)!
    if (i < PALETTE.length) out.push({ ...x, label: name(x.key), color: `var(${PALETTE[i]})` })
    else {
      other.tokens += x.tokens
      other.pct += x.pct
    }
  }
  if (other.tokens > 0) {
    const at = out.findIndex((x) => x.tokens < other.tokens)
    out.splice(at < 0 ? out.length : at, 0, other)
  }
  return out
}

function Bar({ title, rows, order, name }: { title: string; rows: Record<string, StatRow>; order: string[]; name: (key: string) => string }) {
  const s = segments(rows, order, name)
  const tip = (x: Seg) => `${x.label}: ${fmtTokens(x.tokens)} tokens (${x.pct.toFixed(1)}%)`
  return (
    <div className="share">
      <div className="share-h">{title}</div>
      <div className="share-bar">
        {s.map((x) => (
          <span key={x.key} title={tip(x)} style={{ width: `${x.pct}%`, background: x.color }} />
        ))}
      </div>
      <ul className="share-l">
        {s.map((x) => (
          <li key={x.key} title={tip(x)}>
            <span className="dot" style={{ background: x.color }} />
            <span className="n">{x.label}</span>
            <span className="num">{x.pct.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ShareBars({
  agents,
  models,
  agentOrder,
  agentName,
}: {
  agents: Record<string, StatRow>
  models: Record<string, StatRow>
  agentOrder: string[]
  agentName: (id: string) => string
}) {
  return (
    <>
      <h2>Token share</h2>
      <Bar title="By agent" rows={agents} order={['main', ...agentOrder]} name={agentName} />
      <Bar title="By model" rows={models} order={[]} name={(m) => m} />
    </>
  )
}
