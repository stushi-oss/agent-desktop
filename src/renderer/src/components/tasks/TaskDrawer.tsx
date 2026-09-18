import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ScheduledTask, TaskInput } from '@shared/types'
import { useTaskStore } from '@/stores/tasks'
import { formatRelative } from '@/lib/format'
import { Toggle } from '@/components/ui/Toggle'
import { TaskForm } from './TaskForm'
import { RunHistory } from './RunHistory'

type View =
  | { kind: 'list' }
  | { kind: 'form'; task?: ScheduledTask }
  | { kind: 'detail'; taskId: string }

export function TaskDrawer({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const [view, setView] = useState<View>({ kind: 'list' })
  const tasks = useTaskStore((s) => s.tasks)
  const history = useTaskStore((s) => s.history)
  const setEnabled = useTaskStore((s) => s.setEnabled)
  const runNow = useTaskStore((s) => s.runNow)
  const create = useTaskStore((s) => s.create)
  const update = useTaskStore((s) => s.update)
  const remove = useTaskStore((s) => s.remove)

  const lastRunByTask = useMemo(() => {
    const m = new Map<string, (typeof history)[number]>()
    for (const r of [...history].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) m.set(r.taskId, r)
    return m
  }, [history])

  const submit = async (input: TaskInput): Promise<boolean> => {
    if (view.kind === 'form' && view.task) {
      try {
        await update(view.task.id, input)
        return true
      } catch (e) {
        console.error('update task failed', e)
        return false
      }
    }
    const created = await create(input)
    return created !== null
  }

  const statusText = (status: string): string =>
    status === 'running' ? t('tasks.statusRunning')
    : status === 'success' ? t('tasks.statusSuccess')
    : status === 'failed' ? t('tasks.statusFailed')
    : t('tasks.statusMissed')

  return (
    <div className="drawer">
      <div className="drawer-head">
        <h2>{t('tasks.title')}</h2>
        <div style={{ display: 'flex', gap: 4 }}>
          {view.kind !== 'list' && (
            <button className="btn btn-ghost" onClick={() => setView({ kind: 'list' })}>{t('common.back')}</button>
          )}
          <button className="btn btn-ghost" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>
      </div>
      <div className="drawer-body">
        {view.kind === 'list' && (
          <>
            {tasks.length === 0 && <p style={{ color: 'var(--text-dim)' }}>{t('tasks.empty')}</p>}
            {tasks.map((task) => {
              const last = lastRunByTask.get(task.id)
              return (
                <div key={task.id} className="task-item" onClick={() => setView({ kind: 'detail', taskId: task.id })}>
                  <span onClick={(e) => e.stopPropagation()}>
                    <Toggle checked={task.enabled} onChange={(v) => { void setEnabled(task.id, v) }} />
                  </span>
                  <div className="meta">
                    <div className="name">{task.name}</div>
                    <div className="sub">
                      {task.enabled && task.nextRunAt
                        ? `${t('tasks.nextRun')} ${formatRelative(task.nextRunAt, i18n.language)}`
                        : '⏸'}
                    </div>
                  </div>
                  {last && <span className={`status-chip ${last.status}`}>{statusText(last.status)}</span>}
                </div>
              )
            })}
          </>
        )}
        {view.kind === 'form' && (
          <TaskForm
            initial={view.task}
            onSubmit={submit}
            onCancel={() => setView(view.task ? { kind: 'detail', taskId: view.task.id } : { kind: 'list' })}
          />
        )}
        {view.kind === 'detail' && (
          <TaskDetail
            taskId={view.taskId}
            onEdit={() => setView({ kind: 'form', task: tasks.find((x) => x.id === view.taskId) })}
            onRunNow={() => { void runNow(view.taskId) }}
            onDelete={() => { void remove(view.taskId); setView({ kind: 'list' }) }}
          />
        )}
      </div>
      {view.kind === 'list' && (
        <div className="drawer-foot">
          <button className="btn btn-primary" onClick={() => setView({ kind: 'form' })}>{t('tasks.new')}</button>
        </div>
      )}
    </div>
  )
}

function TaskDetail({ taskId, onEdit, onRunNow, onDelete }: {
  taskId: string
  onEdit: () => void
  onRunNow: () => void
  onDelete: () => void
}) {
  const { t, i18n } = useTranslation()
  const task = useTaskStore((s) => s.tasks.find((x) => x.id === taskId))
  if (!task) return <p style={{ color: 'var(--text-dim)' }}>{t('tasks.empty')}</p>
  const scheduleText =
    task.schedule.type === 'cron' ? task.schedule.expr
    : task.schedule.type === 'interval' ? `${task.schedule.minutes} ${t('common.minutes')}`
    : new Date(task.schedule.at).toLocaleString(i18n.language)
  return (
    <div>
      <dl className="kv">
        <dt>{t('tasks.name')}</dt><dd>{task.name}</dd>
        <dt>{t('tasks.prompt')}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{task.prompt}</dd>
        <dt>{t('tasks.cwd')}</dt><dd>{task.cwd}</dd>
        <dt>{t('tasks.scheduleType')}</dt><dd>{scheduleText}</dd>
        <dt>{t('tasks.permissionMode')}</dt><dd>{task.permissionMode}</dd>
        {task.model && (<><dt>{t('tasks.model')}</dt><dd>{task.model}</dd></>)}
        <dt>{t('tasks.timeout')}</dt><dd>{task.timeoutMinutes} {t('common.minutes')}</dd>
        <dt>{t('tasks.nextRun')}</dt><dd>{task.nextRunAt ? formatRelative(task.nextRunAt, i18n.language) : '—'}</dd>
      </dl>
      <div style={{ display: 'flex', gap: 8, margin: '14px 0' }}>
        <button className="btn" onClick={onRunNow}>{t('tasks.runNow')}</button>
        <button className="btn" onClick={onEdit}>{t('common.edit')}</button>
        <button className="btn btn-danger" style={{ marginLeft: 'auto' }} onClick={onDelete}>{t('common.delete')}</button>
      </div>
      <h3 style={{ fontSize: 13, color: 'var(--text-strong)' }}>{t('tasks.history')}</h3>
      <RunHistory taskId={task.id} />
    </div>
  )
}
