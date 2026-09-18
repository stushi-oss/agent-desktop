import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RunRecord } from '@shared/types'
import { useTaskStore } from '@/stores/tasks'
import { formatDateTime } from '@/lib/format'
import { TranscriptView } from './TranscriptView'

function durationOf(rec: RunRecord): string | null {
  if (!rec.finishedAt) return null
  const ms = new Date(rec.finishedAt).getTime() - new Date(rec.startedAt).getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60_000)}m`
}

export function RunHistory({ taskId }: { taskId: string }) {
  const { t, i18n } = useTranslation()
  const history = useTaskStore((s) => s.history)
  const runs = history.filter((r) => r.taskId === taskId).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const [viewing, setViewing] = useState<RunRecord | null>(null)

  if (runs.length === 0) {
    return <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>{t('transcript.empty')}</p>
  }

  const statusText = (status: string): string =>
    status === 'running' ? t('tasks.statusRunning')
    : status === 'success' ? t('tasks.statusSuccess')
    : status === 'failed' ? t('tasks.statusFailed')
    : t('tasks.statusMissed')

  return (
    <div>
      {runs.map((rec) => (
        <div key={rec.id} className="run-item">
          <div className="row1">
            <span className={`status-chip ${rec.status}`}>{statusText(rec.status)}</span>
            <span className="when">
              {formatDateTime(rec.startedAt, i18n.language)}
              {durationOf(rec) ? ` · ${durationOf(rec)}` : ''}
              {rec.exitCode !== undefined ? ` · ${t('transcript.exitCode', { code: rec.exitCode })}` : ''}
            </span>
          </div>
          {rec.resultText && <div className="result">{rec.resultText}</div>}
          {rec.status !== 'running' && (
            <button className="link" onClick={() => setViewing(rec)}>{t('tasks.viewTranscript')}</button>
          )}
        </div>
      ))}
      {viewing && <TranscriptView run={viewing} taskId={taskId} onClose={() => setViewing(null)} />}
    </div>
  )
}
