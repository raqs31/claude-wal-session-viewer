import type { CSSProperties } from 'react'

export const Chip = ({ label, color, on, onClick }: { label: string; color: string; on: boolean; onClick: () => void }) => (
  <button className="chip" type="button" aria-pressed={on} style={{ '--c': color } as CSSProperties} onClick={onClick}>
    <span className="dot" />
    {label}
  </button>
)
