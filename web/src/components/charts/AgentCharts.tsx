import { useAgentSeries } from '../../useSession.ts'
import { TokensOverTime } from './TokensOverTime.tsx'
import { TurnBars } from './TurnBars.tsx'

export function AgentCharts({ sess, agent, stamp }: { sess: string; agent: string; stamp: string }) {
  const { series, error } = useAgentSeries(sess, agent, stamp)
  const note = error && <div className="ag-note">Could not load this agent's charts ({error}).</div>
  if (!series) return note || <div className="ag-note">Loading…</div>
  return (
    <div className="ag-charts">
      <TokensOverTime series={series} agent markers={false} />
      <TurnBars series={series} agent by="call" />
      {note}
    </div>
  )
}
