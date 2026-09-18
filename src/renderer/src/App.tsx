import { useEffect, useState } from 'react'
import './i18n'
import { applyTheme, effectiveTheme, watchSystemTheme } from './theme/theme'
import { TerminalPane } from './components/TerminalPane'

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(effectiveTheme('system'))
  useEffect(() => {
    // 追踪系统主题供 themeMode prop；同步重应用 data-theme（原 App 行为，main.tsx 只做首帧前的一次性应用）
    const off = watchSystemTheme(() => {
      applyTheme('system')
      setTheme(effectiveTheme('system'))
    })
    return off
  }, [])
  const [sessionId, setSessionId] = useState<string | null>(null)
  useEffect(() => {
    void window.api.sessions.create('/tmp').then((s) => setSessionId(s.id))
  }, [])
  return (
    <div style={{ height: '100%' }}>
      {sessionId ? (
        <TerminalPane
          session={{ id: sessionId, title: 'tmp', cwd: '', shellCommand: '', createdAt: '', alive: true }}
          active
          themeMode={theme}
        />
      ) : null}
    </div>
  )
}
