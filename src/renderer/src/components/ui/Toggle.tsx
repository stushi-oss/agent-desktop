interface Props {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
}

export function Toggle({ checked, onChange, label }: Props) {
  return (
    <span className="toggle" onClick={() => onChange(!checked)} role="switch" aria-checked={checked} tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onChange(!checked) }}>
      <span className={`toggle-track${checked ? ' on' : ''}`}>
        <span className="toggle-thumb" />
      </span>
      {label && <span className="toggle-label">{label}</span>}
    </span>
  )
}
