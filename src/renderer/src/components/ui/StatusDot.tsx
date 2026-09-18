export function StatusDot({ alive, running }: { alive: boolean; running?: boolean }) {
  const color = running ? 'var(--warn)' : alive ? 'var(--success)' : 'var(--text-dim)'
  return <span className="status-dot" style={{ background: color }} aria-hidden />
}
