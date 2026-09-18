import type { ReactNode } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  width?: number
}

export function Modal({ title, onClose, children, width = 460 }: Props) {
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="close">✕</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
