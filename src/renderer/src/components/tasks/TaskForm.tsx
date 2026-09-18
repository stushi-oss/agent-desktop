import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PermissionMode, Schedule, ScheduledTask, TaskInput } from '@shared/types'
import { validateTaskForm, type TaskFormErrors } from '@/lib/taskForm'
import { toLocalInputValue } from '@/lib/format'
import { Toggle } from '@/components/ui/Toggle'

interface Props {
  initial?: ScheduledTask
  onSubmit: (input: TaskInput) => Promise<boolean>
  onCancel: () => void
}

type ScheduleType = Schedule['type']

export function TaskForm({ initial, onSubmit, onCancel }: Props) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.name ?? '')
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')
  const [cwd, setCwd] = useState(initial?.cwd ?? '')
  const [scheduleType, setScheduleType] = useState<ScheduleType>(initial?.schedule.type ?? 'interval')
  const [cronExpr, setCronExpr] = useState(initial?.schedule.type === 'cron' ? initial.schedule.expr : '30 8 * * *')
  const [intervalMin, setIntervalMin] = useState<number>(initial?.schedule.type === 'interval' ? initial.schedule.minutes : 30)
  const [onceAt, setOnceAt] = useState(
    initial?.schedule.type === 'once'
      ? toLocalInputValue(new Date(new Date(initial.schedule.at).getTime() + 60_000))
      : toLocalInputValue(new Date(Date.now() + 60 * 60_000))
  )
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(initial?.permissionMode ?? 'default')
  const [model, setModel] = useState(initial?.model ?? '')
  const [timeoutMinutes, setTimeoutMinutes] = useState<number>(initial?.timeoutMinutes ?? 30)
  const [notifyComplete, setNotifyComplete] = useState(initial?.notify.onComplete ?? true)
  const [notifyFailure, setNotifyFailure] = useState(initial?.notify.onFailure ?? true)
  const [errors, setErrors] = useState<TaskFormErrors>({})
  const [saveFailed, setSaveFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  const buildSchedule = (): Schedule => {
    if (scheduleType === 'cron') return { type: 'cron', expr: cronExpr.trim() }
    if (scheduleType === 'interval') return { type: 'interval', minutes: Number(intervalMin) || 0 }
    // 日期被清空时 toISOString 会抛 RangeError，原样传给校验层报 vOnceFuture
    const d = new Date(onceAt)
    return Number.isNaN(d.getTime()) ? { type: 'once', at: onceAt } : { type: 'once', at: d.toISOString() }
  }

  const submit = async (): Promise<void> => {
    const schedule = buildSchedule()
    const errs = validateTaskForm({ name, prompt, cwd, schedule }, new Date())
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    setBusy(true)
    setSaveFailed(false)
    const ok = await onSubmit({
      name, prompt, cwd, schedule, permissionMode,
      model: model.trim() || undefined,
      timeoutMinutes,
      notify: { onComplete: notifyComplete, onFailure: notifyFailure }
    })
    setBusy(false)
    setSaveFailed(!ok)
    if (ok) onCancel()
  }

  const err = (k: keyof TaskFormErrors): string | undefined => (errors[k] ? t(errors[k]!) : undefined)

  return (
    <div>
      <div className="field">
        <label>{t('tasks.name')}</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
        {err('name') && <span className="error">{err('name')}</span>}
      </div>
      <div className="field">
        <label>{t('tasks.prompt')}</label>
        <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        {err('prompt') && <span className="error">{err('prompt')}</span>}
      </div>
      <div className="field">
        <label>{t('tasks.cwd')}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={cwd} readOnly style={{ flex: 1 }} />
          <button className="btn" onClick={() => void window.api.app.pickDirectory().then((d) => d && setCwd(d))}>
            {t('tasks.pickDir')}
          </button>
        </div>
        {err('cwd') && <span className="error">{err('cwd')}</span>}
      </div>
      <div className="field">
        <label>{t('tasks.scheduleType')}</label>
        <select value={scheduleType} onChange={(e) => setScheduleType(e.target.value as ScheduleType)}>
          <option value="cron">Cron</option>
          <option value="interval">{t('tasks.interval')}</option>
          <option value="once">{t('tasks.once')}</option>
        </select>
      </div>
      {scheduleType === 'cron' && (
        <div className="field">
          <label>{t('tasks.cron')}</label>
          <input value={cronExpr} onChange={(e) => setCronExpr(e.target.value)} placeholder="30 8 * * *" />
          {err('schedule') && <span className="error">{err('schedule')}</span>}
        </div>
      )}
      {scheduleType === 'interval' && (
        <div className="field">
          <label>{t('tasks.interval')}</label>
          <input type="number" min={1} value={intervalMin} onChange={(e) => setIntervalMin(Number(e.target.value))} />
          {err('schedule') && <span className="error">{err('schedule')}</span>}
        </div>
      )}
      {scheduleType === 'once' && (
        <div className="field">
          <label>{t('tasks.once')}</label>
          <input type="datetime-local" value={onceAt} onChange={(e) => setOnceAt(e.target.value)} />
          {err('schedule') && <span className="error">{err('schedule')}</span>}
        </div>
      )}
      <div className="field">
        <label>{t('tasks.permissionMode')}</label>
        <select value={permissionMode} onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}>
          <option value="default">{t('tasks.pmDefault')}</option>
          <option value="acceptEdits">{t('tasks.pmAcceptEdits')}</option>
          <option value="bypassPermissions">{t('tasks.pmBypass')}</option>
        </select>
      </div>
      {permissionMode === 'bypassPermissions' && <div className="risk-note">⚠️ {t('tasks.pmRisk')}</div>}
      <div className="field">
        <label>{t('tasks.model')}</label>
        <input value={model} onChange={(e) => setModel(e.target.value)} />
      </div>
      <div className="field">
        <label>{t('tasks.timeout')}</label>
        <input type="number" min={1} value={timeoutMinutes} onChange={(e) => setTimeoutMinutes(Number(e.target.value) || 30)} />
      </div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
        <Toggle checked={notifyComplete} onChange={setNotifyComplete} label={t('tasks.notifyComplete')} />
        <Toggle checked={notifyFailure} onChange={setNotifyFailure} label={t('tasks.notifyFailure')} />
      </div>
      {saveFailed && (
        <div className="field"><span className="error">{t('tasks.saveFailed')}</span></div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn" onClick={onCancel} disabled={busy}>{t('common.cancel')}</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{t('common.save')}</button>
      </div>
    </div>
  )
}
