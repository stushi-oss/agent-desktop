import { readFileSync } from 'node:fs'
import type { RunRecord, ScheduledTask, StreamEvent, TaskInput } from '@shared/types'
import { isValidCronExpr } from '@shared/scheduleCheck'
import { loadStore, newId, saveHistory, saveTasks, trimHistory } from '../store/TaskStore'
import { isDue, nextRunOf } from './schedule'
import { parseStreamLine } from './streamJson'
import { startRun, type RunContext, type RunHandle } from './TaskRunner'

export type { RunContext }
export type StartRunFn = (task: ScheduledTask, ctx: RunContext) => RunHandle

export interface TaskServiceDeps {
  storeDir: string
  runsDir: string
  claudePath: string | null
  env: NodeJS.ProcessEnv
  runner?: StartRunFn
  log?: (msg: string) => void
  notify?: (rec: RunRecord, task: ScheduledTask) => void
  onChanged?: (tasks: ScheduledTask[], history: RunRecord[]) => void
}

function validateInput(input: TaskInput, now: Date): void {
  if (!input.name.trim() || !input.prompt.trim() || !input.cwd.trim()) {
    throw new Error('name/prompt/cwd required')
  }
  const s = input.schedule
  if (s.type === 'cron' && !isValidCronExpr(s.expr)) throw new Error('invalid cron expression')
  if (s.type === 'interval' && !(s.minutes > 0)) throw new Error('interval must be positive')
  if (s.type === 'once' && new Date(s.at).getTime() <= now.getTime()) throw new Error('once schedule must be in the future')
}

export class TaskService {
  tasks: ScheduledTask[] = []
  history: RunRecord[] = []
  private active = new Map<string, RunHandle>()

  constructor(public readonly deps: TaskServiceDeps) {}

  private get runner(): StartRunFn {
    return this.deps.runner ?? ((t, c) => startRun(t, c))
  }

  private log(msg: string): void {
    ;(this.deps.log ?? console.log)(msg)
  }

  private emit(): void {
    this.deps.onChanged?.(this.tasks, this.history)
  }

  persist(): void {
    saveTasks(this.deps.storeDir, this.tasks)
    saveHistory(this.deps.storeDir, this.history)
  }

  load(now: Date = new Date()): void {
    const data = loadStore(this.deps.storeDir)
    this.tasks = data.tasks
    this.history = data.history
    for (const t of this.tasks) {
      if (t.enabled && isDue(t.nextRunAt, now)) {
        this.history.push({
          id: newId(),
          taskId: t.id,
          startedAt: t.nextRunAt!,
          finishedAt: now.toISOString(),
          status: 'missed'
        })
      }
      t.nextRunAt = t.enabled ? this.nextOf(t, now) : undefined
    }
    this.history = trimHistory(this.history)
    this.persist()
    this.emit()
  }

  private nextOf(t: ScheduledTask, from: Date): string | undefined {
    const d = nextRunOf(t.schedule, from)
    return d?.toISOString()
  }

  tick(now: Date = new Date()): void {
    let changed = false
    for (const t of this.tasks) {
      if (!t.enabled) continue
      if (isDue(t.nextRunAt, now)) {
        if (this.active.has(t.id)) {
          this.log(`[tasks] skip "${t.name}": previous run still active`)
          t.nextRunAt = this.nextOf(t, now)
          changed = true
          continue
        }
        this.fire(t, now)
        changed = true
      } else if (!t.nextRunAt) {
        t.nextRunAt = this.nextOf(t, now)
        changed = true
      }
    }
    if (changed) {
      saveTasks(this.deps.storeDir, this.tasks)
      this.emit()
    }
  }

  private fire(t: ScheduledTask, now: Date): void {
    const ctx: RunContext | null = this.deps.claudePath
      ? { claudePath: this.deps.claudePath, env: this.deps.env, runsDir: this.deps.runsDir }
      : null
    // 先拿 handle：run 记录 id 与 runner 的 runId 对齐（transcript 文件名同源）
    const handle = ctx ? this.runner(t, ctx) : null
    const running: RunRecord = {
      id: handle?.runId ?? newId(),
      taskId: t.id,
      startedAt: now.toISOString(),
      status: 'running'
    }
    this.history = trimHistory([running, ...this.history])
    saveHistory(this.deps.storeDir, this.history)
    this.emit()

    t.nextRunAt = this.nextOf(t, now)

    if (!handle) {
      this.finishRun(t, running, {
        status: 'failed',
        error: 'claude executable not found',
        finishedAt: new Date().toISOString()
      })
      return
    }
    this.active.set(t.id, handle)
    void handle.promise.then((final) => {
      this.active.delete(t.id)
      this.finishRun(t, running, final)
    })
  }

  private finishRun(t: ScheduledTask, running: RunRecord, final: Partial<RunRecord>): void {
    const merged: RunRecord = { ...running, ...final, id: running.id, taskId: t.id }
    this.history = trimHistory(this.history.map((r) => (r.id === running.id ? merged : r)))
    saveHistory(this.deps.storeDir, this.history)
    if (t.schedule.type === 'once') {
      t.enabled = false
      t.nextRunAt = undefined
    }
    saveTasks(this.deps.storeDir, this.tasks)
    this.deps.notify?.(merged, t)
    this.emit()
  }

  runNow(taskId: string, now: Date = new Date()): void {
    const t = this.tasks.find((x) => x.id === taskId)
    if (!t || this.active.has(t.id)) return
    this.fire(t, now)
    saveTasks(this.deps.storeDir, this.tasks)
    this.emit()
  }

  create(input: TaskInput, now: Date = new Date()): ScheduledTask {
    validateInput(input, now)
    const task: ScheduledTask = {
      id: newId(),
      name: input.name.trim(),
      prompt: input.prompt.trim(),
      cwd: input.cwd,
      schedule: input.schedule,
      enabled: true,
      permissionMode: input.permissionMode,
      model: input.model || undefined,
      timeoutMinutes: input.timeoutMinutes ?? 30,
      notify: {
        onComplete: input.notify?.onComplete ?? true,
        onFailure: input.notify?.onFailure ?? true
      },
      createdAt: now.toISOString(),
      nextRunAt: undefined
    }
    task.nextRunAt = this.nextOf(task, now)
    this.tasks.push(task)
    this.persist()
    this.emit()
    return task
  }

  update(id: string, patch: Partial<TaskInput> & { enabled?: boolean }, now: Date = new Date()): ScheduledTask | undefined {
    const t = this.tasks.find((x) => x.id === id)
    if (!t) return undefined
    const notify = {
      onComplete: patch.notify?.onComplete ?? t.notify.onComplete,
      onFailure: patch.notify?.onFailure ?? t.notify.onFailure
    }
    const merged: TaskInput = {
      name: patch.name ?? t.name,
      prompt: patch.prompt ?? t.prompt,
      cwd: patch.cwd ?? t.cwd,
      schedule: patch.schedule ?? t.schedule,
      permissionMode: patch.permissionMode ?? t.permissionMode,
      model: patch.model ?? t.model,
      timeoutMinutes: patch.timeoutMinutes ?? t.timeoutMinutes,
      notify
    }
    validateInput(merged, now)
    Object.assign(t, {
      ...merged,
      model: merged.model || undefined,
      notify
    })
    if (patch.enabled !== undefined) t.enabled = patch.enabled
    t.nextRunAt = t.enabled ? this.nextOf(t, now) : undefined
    this.persist()
    this.emit()
    return t
  }

  remove(id: string): boolean {
    const before = this.tasks.length
    this.tasks = this.tasks.filter((t) => t.id !== id)
    if (this.tasks.length === before) return false
    this.persist()
    this.emit()
    return true
  }

  setEnabled(id: string, enabled: boolean, now: Date = new Date()): void {
    const t = this.tasks.find((x) => x.id === id)
    if (!t) return
    t.enabled = enabled
    t.nextRunAt = enabled ? this.nextOf(t, now) : undefined
    this.persist()
    this.emit()
  }

  isRunning(taskId: string): boolean {
    return this.active.has(taskId)
  }

  historyOf(taskId?: string): RunRecord[] {
    return taskId ? this.history.filter((r) => r.taskId === taskId) : this.history
  }

  readTranscript(rec: RunRecord): StreamEvent[] {
    if (!rec.transcriptPath) return []
    try {
      return readFileSync(rec.transcriptPath, 'utf8')
        .split('\n')
        .map((l) => parseStreamLine(l))
        .filter((ev): ev is StreamEvent => ev !== null)
    } catch {
      return []
    }
  }
}
