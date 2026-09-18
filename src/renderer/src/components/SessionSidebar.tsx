import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSessionStore } from '@/stores/sessions'
import { StatusDot } from './ui/StatusDot'
import { NextTaskCard } from './NextTaskCard'

export function SessionSidebar({ onNewSession, onOpenTasks }: { onNewSession: () => void; onOpenTasks: () => void }) {
  const { t } = useTranslation()
  const sessions = useSessionStore((s) => s.sessions)
  const activeId = useSessionStore((s) => s.activeId)
  const activate = useSessionStore((s) => s.activate)
  const close = useSessionStore((s) => s.close)
  const rename = useSessionStore((s) => s.rename)
  const createAndActivate = useSessionStore((s) => s.createAndActivate)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null)

  return (
    <aside className="sidebar" onClick={() => setMenu(null)}>
      <div className="sidebar-head">
        <span>{t('sessions.title')}</span>
        <button className="btn btn-ghost" onClick={onNewSession} title={t('sessions.new')}>＋</button>
      </div>
      <div className="sidebar-list">
        {sessions.length === 0 && (
          <p style={{ color: 'var(--text-dim)', fontSize: 12, padding: '8px' }}>{t('sessions.empty')}</p>
        )}
        {sessions.map((s) => (
          <button
            key={s.id}
            className={`session-item${s.id === activeId ? ' active' : ''}`}
            onClick={() => activate(s.id)}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ id: s.id, x: e.clientX, y: e.clientY }) }}
            onDoubleClick={() => setEditing({ id: s.id, value: s.title })}
          >
            <StatusDot alive={s.alive} />
            {editing?.id === s.id ? (
              <input
                autoFocus
                value={editing.value}
                onChange={(e) => setEditing({ id: s.id, value: e.target.value })}
                onBlur={() => { rename(s.id, editing.value.trim() || s.title); setEditing(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') { rename(s.id, editing.value.trim() || s.title); setEditing(null) } }}
                style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--text-strong)' }}
              />
            ) : (
              <span className="label" title={s.cwd}>{s.title}</span>
            )}
            <span className="close-x" onClick={(e) => { e.stopPropagation(); void close(s.id) }}>✕</span>
          </button>
        ))}
      </div>
      <div className="sidebar-foot">
        <NextTaskCard onOpenTasks={onOpenTasks} />
      </div>
      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
          <button onClick={() => { const s = sessions.find((x) => x.id === menu.id); if (s) void navigator.clipboard.writeText(s.cwd); setMenu(null) }}>
            {t('sessions.copyPath')}
          </button>
          <button onClick={() => { const s = sessions.find((x) => x.id === menu.id); if (s) setEditing({ id: s.id, value: s.title }); setMenu(null) }}>
            {t('sessions.rename')}
          </button>
          <button onClick={() => { void close(menu.id); setMenu(null) }}>
            {t('sessions.closeSession')}
          </button>
          <button onClick={() => { const s = sessions.find((x) => x.id === menu.id); if (s) void createAndActivate(s.cwd); setMenu(null) }}>
            {t('sessions.restart')}
          </button>
        </div>
      )}
    </aside>
  )
}
