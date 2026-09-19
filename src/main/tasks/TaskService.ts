import { readFileSync } from 'node:fs'
import type { RunRecord, ScheduledTask, StreamEvent, TaskInput } from '@shared/types'
import { isValidCronExpr } from '@shared/scheduleCheck'
import { loadStore, newId, saveHistory, saveTasks, trimHistory } from '../store/TaskStore'
import { isDue, nextRunOf } from './schedule'
import { parseStreamLine } from './streamJson'
import { startRun, type RunContext, type RunHandle } from './TaskRunner'

export type { RunContext }
export type StartRunFn = (task: ScheduledTask, ctx: RunContext) => RunHandle | null

export interface TaskServiceDeps {
  storeDir: string
  runsDir: string
  claudePath: string | null
  env: NodeJS.ProcessEnv
  runner?: StartRunFn
  log?: (msg: string) => void
  notify?: (rec: RunRecord, task: ScheduledTask) => void
  onChanged?: (tasks: ScheduledTask[], history: RunRecord[]) => void
  /** 持久化失败回调：index.ts 接到后展示一次性 toast，避免主进程因 IO 错误退出 */
  onPersistError?: (err: unknown) => void
}

function validateInput(input: TaskInput, now: Date, opts: { onceFuture?: boolean } = {}): void {
  if (!input.name.trim() || !input.prompt.trim() || !input.cwd.trim()) {
    throw new Error('name/prompt/cwd required')
  }
  const s = input.schedule
  if (s.type === 'cron' && !isValidCronExpr(s.expr)) throw new Error('invalid cron expression')
  if (s.type === 'interval' && !(s.minutes > 0)) throw new Error('interval must be positive')
  // once-future 校验仅在调度本身变化时应用：改名等 patch 不应被已过期的 once 任务锁死
  if (opts.onceFuture !== false && s.type === 'once') {
    const at = new Date(s.at).getTime()
    if (Number.isNaN(at) || at <= now.getTime()) {
      throw new Error('once schedule must be a valid future date')
    }
  }
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

  /**
   * 集中 try/catch 包装器：捕获 EACCES/EROFS/ENOSPC 等 IO 错误，避免冒泡到 setInterval 回调导致主进程退出。
   * - 写日志便于排查
   * - 调用 onPersistError 回调，index.ts 接住后展示一次性 toast
   */
  private safePersist(label: string): void {
    try {
      this.persist()
    } catch (err) {
      this.log(`[tasks] persist failed (${label}): ${err instanceof Error ? err.message : String(err)}`)
      this.deps.onPersistError?.(err)
    }
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
      if (this.disableExpiredOnce(t, now)) {
        // 错过的 once 任务不补跑：标记 missed 后直接禁用，重算 nextRunAt 只会得到过去的时刻
        continue
      }
      t.nextRunAt = t.enabled ? this.nextOf(t, now) : undefined
    }
    this.history = trimHistory(this.history)
    this.safePersist('load')
    this.emit()
  }

  private nextOf(t: ScheduledTask, from: Date): string | undefined {
    const d = nextRunOf(t.schedule, from)
    return d?.toISOString()
  }

  /** 错过的 once 任务不补跑：触发时刻已过则禁用并清空 nextRunAt（load/update/setEnabled 共用） */
  private disableExpiredOnce(t: ScheduledTask, now: Date): boolean {
    if (t.schedule.type === 'once' && t.enabled && new Date(t.schedule.at).getTime() <= now.getTime()) {
      t.enabled = false
      t.nextRunAt = undefined
      return true
    }
    return false
  }

  tick(now: Date = new Date()): void {
    let changed = false
    for (const t of this.tasks) {
      // 单任务异常（如脏数据导致 nextOf 解析失败）隔离：记日志后继续处理其余任务
      try {
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
          const next = this.nextOf(t, now)
          if (next) {
            t.nextRunAt = next
            changed = true
          }
        }
      } catch (err) {
        this.log(`[tasks] tick error on "${t.name}": ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (changed) {
      this.safePersist('tick-changed')
      this.emit()
    }
  }

  private fire(t: ScheduledTask, now: Date): void {
    // 修复 finding #1：claudePath 缺失时直接失败 + 禁用，避免 interval/cron 任务每 tick 重跑
    if (!this.deps.claudePath) {
      const failed: RunRecord = {
        id: newId(),
        taskId: t.id,
        startedAt: now.toISOString(),
        finishedAt: now.toISOString(),
        status: 'failed',
        error: 'claude executable not found'
      }
      this.history = trimHistory([failed, ...this.history])
      this.safePersist('fire-claude-missing-insert')
      t.enabled = false
      t.nextRunAt = undefined
      this.safePersist('fire-claude-missing-disable')
      this.deps.notify?.(failed, t)
      this.emit()
      return
    }
    const ctx: RunContext | null = this.deps.claudePath
      ? { claudePath: this.deps.claudePath, env: this.deps.env, runsDir: this.deps.runsDir }
      : null
    // 修复 finding #9：runner 同步抛错时也要写 history
    let handle: RunHandle | null = null
    let runnerError: unknown = null
    try {
      handle = ctx ? this.runner(t, ctx) : null
    } catch (err) {
      runnerError = err
    }
    const running: RunRecord = {
      id: handle?.runId ?? newId(),
      taskId: t.id,
      startedAt: now.toISOString(),
      status: 'running'
    }

    if (handle) {
      // 拿到 handle 立即登记 active + 挂接完成链，消除「进程在跑但未登记」的孤儿窗口
      this.active.set(t.id, handle)
      void handle.promise
        .then((final) => {
          this.active.delete(t.id)
          this.finishRun(t, running, final)
        })
        .catch((err: unknown) => {
          this.active.delete(t.id)
          this.finishRun(t, running, {
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
            finishedAt: new Date().toISOString()
          })
        })
    }

    this.history = trimHistory([running, ...this.history])
    this.safePersist('fire-insert')
    this.emit()

    t.nextRunAt = this.nextOf(t, now)

    if (runnerError) {
      this.finishRun(t, running, {
        status: 'failed',
        error: runnerError instanceof Error ? runnerError.message : String(runnerError),
        finishedAt: new Date().toISOString()
      })
    } else if (!handle) {
      this.finishRun(t, running, {
        status: 'failed',
        error: 'runner returned null',
        finishedAt: new Date().toISOString()
      })
    }
  }

  private finishRun(t: ScheduledTask, running: RunRecord, final: Partial<RunRecord>): void {
    const merged: RunRecord = { ...running, ...final, id: running.id, taskId: t.id }
    this.history = trimHistory(this.history.map((r) => (r.id === running.id ? merged : r)))
    this.safePersist('finish-run-history')
    if (t.schedule.type === 'once') {
      t.enabled = false
      t.nextRunAt = undefined
    }
    this.safePersist('finish-run-tasks')
    this.deps.notify?.(merged, t)
    this.emit()
  }

  runNow(taskId: string, now: Date = new Date()): void {
    const t = this.tasks.find((x) => x.id === taskId)
    if (!t || this.active.has(t.id)) return
    this.fire(t, now)
    this.safePersist('runNow')
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
    this.safePersist('create')
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
    validateInput(merged, now, { onceFuture: patch.schedule !== undefined })
    Object.assign(t, {
      ...merged,
      model: merged.model || undefined,
      notify
    })
    if (patch.enabled !== undefined) t.enabled = patch.enabled
    if (!this.disableExpiredOnce(t, now)) {
      t.nextRunAt = t.enabled ? this.nextOf(t, now) : undefined
    }
    this.safePersist('update')
    this.emit()
    return t
  }

  remove(id: string): boolean {
    const before = this.tasks.length
    this.tasks = this.tasks.filter((t) => t.id !== id)
    if (this.tasks.length === before) return false
    this.safePersist('remove')
    this.emit()
    return true
  }

  setEnabled(id: string, enabled: boolean, now: Date = new Date()): void {
    const t = this.tasks.find((x) => x.id === id)
    if (!t) return
    t.enabled = enabled
    if (!this.disableExpiredOnce(t, now)) {
      t.nextRunAt = enabled ? this.nextOf(t, now) : undefined
    }
    this.safePersist('setEnabled')
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
