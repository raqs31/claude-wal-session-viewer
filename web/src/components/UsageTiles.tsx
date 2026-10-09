import type { UsageTotals } from '../../../shared/api.ts'
import { usageTiles } from '../lib/usage.ts'

interface Props {
  usage: UsageTotals | null
  live: boolean | null
  error: string | null
  picked: number
}

export function UsageTiles({ usage, live, error, picked }: Props) {
  const status =
    error !== null ? `could not load usage (${error})` : picked === 0 ? 'no session picked' : live === null ? 'connecting' : live ? 'live' : 'disconnected'
  return (
    <div className="usage" aria-label="Usage over the pick">
      {usageTiles(usage).map((t) => (
        <div key={t.key} className="tile" title={t.title}>
          <div className="k">
            {t.color && <span className="dot" style={{ background: t.color }} />}
            {t.label}
          </div>
          <div className="v">{t.value}</div>
        </div>
      ))}
      <span className="live">
        <span className="dot" style={live === null ? undefined : { background: live ? 'var(--cat-session)' : 'var(--muted)' }} />
        {status}
        {picked > 0 && ` · ${picked} session${picked === 1 ? '' : 's'}`}
      </span>
    </div>
  )
}
