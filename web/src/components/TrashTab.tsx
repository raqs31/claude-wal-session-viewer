import { useState } from 'react'
import type { TrashEntry, TrashRef, TrashResult } from '../../../shared/api.ts'
import { short } from '../lib/format.ts'
import { fmtBytes } from '../lib/tokens.ts'
import { summarizeResults } from '../lib/trash.ts'
import { postTrash, useTrash } from '../useTrash.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'

const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p

// The same id can sit in the trash twice (two dates or two sources), so a row is keyed by its whole ref.
const keyOf = (e: TrashRef) => [e.source, e.date, e.slug, e.id].join('/')
const refOf = ({ source, date, slug, id }: TrashEntry): TrashRef => ({ source, date, slug, id })
const nameOf = (e: TrashEntry) => (e.title ? `${e.title} · ${short(e.id)}` : short(e.id))
const EMPTY = 'Empty trash'

export function TrashTab({ refreshSessions, gen }: { refreshSessions: () => Promise<void>; gen: number }) {
  const trash = useTrash(gen)
  const [sel, setSel] = useState<ReadonlySet<string>>(new Set())
  const [note, setNote] = useState<string | null>(null)
  const [ask, setAsk] = useState<{ title: string; set: readonly TrashEntry[] } | null>(null)

  const { entries } = trash
  const chosen = entries.filter((e) => sel.has(keyOf(e)))
  const flip = (k: string) => {
    const n = new Set(sel)
    if (!n.delete(k)) n.add(k)
    setSel(n)
  }

  const run = async (verb: string, restore: boolean, set: readonly TrashEntry[]) => {
    setAsk(null)
    setNote(null)
    try {
      const results = await postTrash(restore ? '/trash/restore' : '/trash/purge', { refs: set.map(refOf) })
      const named = (r: TrashResult) => {
        const e = set.find((x) => x.id === r.id)
        return `${e ? nameOf(e) : short(r.id)}${r.reason ? ` (${r.reason})` : ''}`
      }
      const conflicts = results.filter((r) => r.status === 'conflict').map(named)
      setNote(`${verb}: ${summarizeResults(results, restore ? 'restored' : 'deleted')}${conflicts.length ? ` — conflict: ${conflicts.join(', ')}` : ''}`)
    } catch (e) {
      setNote(`${verb} failed (${(e as Error).message})`)
    }
    setSel(new Set())
    await Promise.all([trash.refresh(), restore ? refreshSessions() : undefined])
  }

  const confirmPurge = (title: string, set: readonly TrashEntry[]) => {
    setNote(null)
    setAsk({ title, set })
  }

  return (
    <div className="trash">
      <div className="trash-h">
        <span className="num">
          {trash.error !== null ? `could not load the trash (${trash.error})` : `${entries.length} in trash · ${chosen.length} selected`}
        </span>
        <span className="spacer" />
        <button className="ghost" type="button" disabled={!chosen.length} onClick={() => void run('Restore', true, chosen)}>
          Restore selected
        </button>
        <button className="ghost danger" type="button" disabled={!chosen.length} onClick={() => confirmPurge(`Delete ${chosen.length} forever`, chosen)}>
          Delete selected
        </button>
        <button className="ghost danger" type="button" disabled={!entries.length} onClick={() => confirmPurge(EMPTY, entries)}>
          Empty trash
        </button>
      </div>
      {note !== null && (
        <div className="trash-note" role="status">
          {note}
        </div>
      )}
      {entries.length > 0 ? (
        <div className="hscroll">
          <table className="trash-t">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={chosen.length === entries.length}
                    onChange={() => setSel(chosen.length === entries.length ? new Set() : new Set(entries.map(keyOf)))}
                  />
                </th>
                <th>Name</th>
                <th>Project</th>
                <th>Source</th>
                <th>Trashed</th>
                <th className="r">Size</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const k = keyOf(e)
                return (
                  <tr key={k}>
                    <td>
                      <input type="checkbox" aria-label={`Select ${nameOf(e)}`} checked={sel.has(k)} onChange={() => flip(k)} />
                    </td>
                    <td className="name" title={e.title || e.id}>
                      {e.title || short(e.id)}
                    </td>
                    <td title={e.cwd ?? e.slug}>{e.cwd ? base(e.cwd) : e.slug}</td>
                    <td>{e.source}</td>
                    <td className="num">{e.date}</td>
                    <td className="num r">{fmtBytes(e.size)}</td>
                    <td className="acts">
                      <button className="ghost" type="button" onClick={() => void run('Restore', true, [e])}>
                        Restore
                      </button>
                      <button className="ghost danger" type="button" onClick={() => confirmPurge('Delete forever', [e])}>
                        Delete forever
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        trash.error === null && <div className="empty">{trash.ready ? 'The trash is empty.' : 'Loading the trash…'}</div>
      )}
      {ask && (
        <ConfirmDialog
          title={ask.title}
          confirmLabel="Delete forever"
          items={ask.set.map((e) => ({ name: nameOf(e) }))}
          requireYes
          onConfirm={() => void run(ask.title === EMPTY ? EMPTY : 'Delete forever', false, ask.set)}
          onCancel={() => setAsk(null)}
        />
      )}
    </div>
  )
}
