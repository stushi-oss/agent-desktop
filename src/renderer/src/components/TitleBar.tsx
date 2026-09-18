import { useTranslation } from 'react-i18next'
import { useSessionStore } from '@/stores/sessions'
import { StatusDot } from './ui/StatusDot'

interface Props {
  onNewSession: () => void
  onOpenTasks: () => void
  onOpenExtensions: () => void
  onOpenSettings: () => void
  tasksRunning: number
}

export function TitleBar({ onNewSession, onOpenTasks, onOpenExtensions, onOpenSettings, tasksRunning }: Props) {
  const { t } = useTranslation()
  const sessions = useSessionStore((s) => s.sessions)
  const activeId = useSessionStore((s) => s.activeId)
  const activate = useSessionStore((s) => s.activate)
  const close = useSessionStore((s) => s.close)

  return (
    <div className="titlebar">
      <span className="brand">AgentDesk</span>
      <div className="tabstrip">
        {sessions.map((s) => (
          <button
            key={s.id}
            className={`tab${s.id === activeId ? ' active' : ''}`}
            onClick={() => activate(s.id)}
            onMouseDown={(e) => { if (e.button === 1) void close(s.id) }}
            title={s.cwd}
          >
            <StatusDot alive={s.alive} />
            <span className="label">{s.title}</span>
            <span className="close-x" onClick={(e) => { e.stopPropagation(); void close(s.id) }}>✕</span>
          </button>
        ))}
        <button className="icon-btn" onClick={onNewSession} title={t('tabs.newTab')}>＋</button>
      </div>
      <div className="titlebar-actions">
        <button className="icon-btn" onClick={onOpenTasks}>
          ⏰ {t('tasks.title')}
          {tasksRunning > 0 && <span className="badge">{tasksRunning}</span>}
        </button>
        <button className="icon-btn" onClick={onOpenExtensions}>🧩 {t('registry.title')}</button>
        <button className="icon-btn" onClick={onOpenSettings} aria-label={t('settings.title')}>⚙️</button>
      </div>
    </div>
  )
}
