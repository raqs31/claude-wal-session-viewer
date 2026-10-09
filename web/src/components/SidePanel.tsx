import { useId, useRef, useState } from 'react'
import type { ReactNode, Ref } from 'react'
import { flushSync } from 'react-dom'

interface Props {
  side: 'left' | 'right'
  label: string
  pinned: boolean
  onPin: () => void
  open: boolean
  setOpen: (open: boolean) => void
  handle?: ReactNode
  handleLabel?: string
  asideRef?: Ref<HTMLElement>
  className?: string
  children: ReactNode
}

export function SidePanel({ side, label, pinned, onPin, open, setOpen, handle, handleLabel, asideRef, className, children }: Props) {
  const pinRef = useRef<HTMLButtonElement>(null)
  const hover = useRef(false)
  const [focused, setFocused] = useState(false)
  const shown = open || focused
  const id = useId()
  const glyph = (side === 'left') === pinned ? '«' : '»'
  const tip = pinned
    ? handle !== undefined ? `Unpin: hide behind the ${label} handle` : 'Unpin: hide until the pointer reaches the left edge'
    : 'Pin: keep shown'
  const leaveTrigger = (e: React.PointerEvent) => {
    if (!(e.relatedTarget instanceof Element && e.relatedTarget.closest(`.panel[data-side=${side}]`))) setOpen(false)
  }
  return (
    <>
      {/* Stays mounted while the panel is open: its z-index sits below the panel, so the panel covers it
          whenever visible, including on :focus-within, which `open` does not track. */}
      {!pinned && (handle === undefined
        ? <div className="panel-edge" data-side={side} onPointerEnter={() => setOpen(true)} onPointerLeave={leaveTrigger} />
        : (
          <button type="button" className="panel-handle" data-side={side} aria-expanded={shown} tabIndex={shown ? -1 : undefined} aria-controls={id} aria-label={handleLabel}
            onPointerEnter={() => setOpen(true)} onPointerLeave={leaveTrigger}
            onClick={() => {
              // The aside stays visibility: hidden until data-open renders, and a hidden button cannot take focus.
              flushSync(() => setOpen(true))
              pinRef.current?.focus()
            }}>{handle}</button>
        ))}
      <aside ref={asideRef} id={id} className={className ? `panel ${className}` : 'panel'} data-side={side}
        data-open={pinned || open || undefined} data-pinned={pinned || undefined} aria-label={label}
        onFocus={() => setFocused(true)}
        onPointerEnter={() => { hover.current = true; setOpen(true) }}
        onPointerLeave={() => { hover.current = false; setOpen(false) }}
        // Opened from the keyboard, no pointer leave ever fires, so focus leaving the panel must close it too.
        onBlur={(e) => {
          const out = !(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))
          if (out) setFocused(false)
          if (out && !hover.current) setOpen(false)
        }}>
        <button ref={pinRef} type="button" className="panel-pin" aria-pressed={pinned} aria-label={tip} title={tip} onClick={onPin}>{glyph}</button>
        {children}
      </aside>
    </>
  )
}
