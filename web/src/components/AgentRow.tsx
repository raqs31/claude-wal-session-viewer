import type { ReactNode } from 'react'
import type { Detail } from '../lib/agentStats.ts'

// The name cell's button is the keyboard and screen-reader control; a click anywhere on the row
// toggles too, so the button's own click must not reach the row and toggle twice.
export function AgentRow({
  cells,
  span,
  open,
  onToggle,
  task,
  detail,
  charts,
}: {
  cells: (toggle: (name: string) => ReactNode) => ReactNode
  span: number
  open: boolean
  onToggle: () => void
  task?: () => ReactNode
  detail: () => Detail[]
  charts?: () => ReactNode
}) {
  const toggle = (name: string) => (
    <button
      className="ag-b"
      type="button"
      aria-expanded={open}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      {name}
    </button>
  )
  return (
    <>
      <tr className="ag" onClick={onToggle}>
        {cells(toggle)}
      </tr>
      {open && (
        <tr className="ag-x">
          <td colSpan={span}>
            {task?.()}
            <dl>
              {detail().map((d) => (
                <div key={d.k} title={d.title}>
                  <dt>{d.k}</dt>
                  <dd className="num">{d.v}</dd>
                </div>
              ))}
            </dl>
            {charts?.()}
          </td>
        </tr>
      )}
    </>
  )
}
