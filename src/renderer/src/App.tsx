import { useEffect } from 'react'
import './i18n'
import { applyTheme, watchSystemTheme } from './theme/theme'

export default function App() {
  useEffect(() => {
    applyTheme('system')
    return watchSystemTheme(() => applyTheme('system'))
  }, [])
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ color: 'var(--text-strong)', fontSize: 16 }}>AgentDesk</h1>
      <p style={{ color: 'var(--text-dim)' }}>tokens + i18n ready</p>
    </div>
  )
}
