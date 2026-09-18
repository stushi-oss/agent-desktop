import { useTranslation } from 'react-i18next'
import { useTaskStore, selectNextTask, selectRunningCount } from '@/stores/tasks'
import { formatRelative } from '@/lib/format'

export function NextTaskCard({ onOpenTasks }: { onOpenTasks: () => void }) {
  const { t, i18n } = useTranslation()
  const next = useTaskStore(selectNextTask)
  const running = useTaskStore(selectRunningCount)

  return (
    <button
      onClick={onOpenTasks}
      style={{
        width: '100%', textAlign: 'left', background: 'var(--bg-raised)',
        border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', cursor: 'pointer'
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
        {running > 0 ? t('tasks.runningCount', { count: running }) : t('tasks.summaryNext')}
      </div>
      {next ? (
        <div style={{ fontSize: 12.5, color: 'var(--text-strong)', marginTop: 2 }}>
          ⏰ {next.name}
          <span style={{ color: 'var(--accent)', marginLeft: 6 }}>
            {formatRelative(next.nextRunAt!, i18n.language)}
          </span>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 2 }}>{t('tasks.summaryNone')}</div>
      )}
    </button>
  )
}
