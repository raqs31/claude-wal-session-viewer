import { useEffect, useRef, useState } from 'react'

export type ConfirmItem = { name: string; skipped?: string }

// Mount it to open the modal and unmount it to close, so Escape and Cancel both hand control back to the parent.
export function ConfirmDialog({
  title,
  confirmLabel,
  items,
  requireYes = false,
  countLabel = 'to delete',
  onConfirm,
  onCancel,
}: {
  title: string
  confirmLabel: string
  items: readonly ConfirmItem[]
  requireYes?: boolean
  countLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const dlg = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const yes = useRef<HTMLInputElement>(null)
  const [typed, setTyped] = useState('')

  useEffect(() => {
    const d = dlg.current
    if (!d) return
    d.showModal()
    ;(yes.current ?? cancel.current)?.focus()
    return () => d.close()
  }, [])

  const skipped = items.filter((i) => i.skipped).length
  const ready = !requireYes || typed.trim().toLowerCase() === 'yes'

  return (
    <dialog
      className="confirm"
      ref={dlg}
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        // The native close would leave this mounted but hidden; the parent decides when to unmount.
        e.preventDefault()
        onCancel()
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) onConfirm()
        }}
      >
        <h2 id="confirm-title">{title}</h2>
        <p className="confirm-n">
          {items.length - skipped} {countLabel}
          {skipped ? `, ${skipped} skipped` : ''}
        </p>
        <ul className="confirm-list">
          {items.map((i, idx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the list is static while the dialog is mounted, and names can repeat (the same session trashed twice).
            <li key={idx} data-skipped={i.skipped ? '' : undefined}>
              <span>{i.name}</span>
              {i.skipped && <span className="confirm-skip">{i.skipped}</span>}
            </li>
          ))}
        </ul>
        {requireYes && (
          <input
            type="text"
            ref={yes}
            className="confirm-yes"
            placeholder="Type yes to confirm"
            aria-label="Type yes to confirm"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        )}
        <div className="confirm-acts">
          <button className="ghost" type="button" ref={cancel} onClick={onCancel}>
            Cancel
          </button>
          <button className="ghost danger" type="submit" disabled={!ready}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  )
}
