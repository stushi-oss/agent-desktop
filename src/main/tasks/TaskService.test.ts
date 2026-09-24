import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskService, type StartRunFn, type RunContext } from './TaskService'
import type { RunRecord, ScheduledTask, TaskInput } from '@shared/types'

let storeDir: string
let runsDir: string
beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), 'ad-svc-store-'))
  runsDir = mkdtempSync(join(tmpdir(), 'ad-svc-runs-'))
})

const input = (over: Partial<TaskInput> = {}): TaskInput => ({
  name: 'demo', prompt: 'hi', cwd: '/tmp',
  schedule: { type: 'interval', minutes: 5 },
  permissionMode: 'default', ...over
})

interface Deferred { resolve: (r: Partial<RunRecord>) => void; promise: Promise<RunRecord> }
function deferred(): Deferred {
  let resolve!: (r: Partial<RunRecord>) => void
  const promise = new Promise<RunRecord>((res) => {
    resolve = (partial) => res({ id: 'run-x', taskId: '', startedAt: '', status: 'success', ...partial } as RunRecord)
  })
  return { resolve, promise }
}

function makeService(runner?: StartRunFn) {
  const notified: Array<{ rec: RunRecord; task: ScheduledTask }> = []
  const logs: string[] = []
  const changes: number[] = []
  const persistErrors: unknown[] = []
  const svc = new TaskService({
    storeDir, runsDir, claudePath: '/fake/claude', env: { PATH: '/x' },
    runner,
    log: (m) => logs.push(m),
    notify: (rec, task) => notified.push({ rec, task }),
    onChanged: () => changes.push(changes.length),
    onPersistError: (e) => persistErrors.push(e)
  })
  return { svc, notified, logs, persistErrors }
}

describe('TaskService.create/update/remove', () => {
  it('create 计算 nextRunAt = now + interval；持久化', () => {
    const { svc } = makeService()
    const now = new Date('2026-01-15T10:00:00')
    const t = svc.create(input(), now)
    expect(svc.tasks).toHaveLength(1)
    // 注意用毫秒差比较：nextRunAt 是 UTC ISO 串，测试机时区未知，禁止字符串断言
    expect(new Date(t.nextRunAt!).getTime() - now.getTime()).toBe(5 * 60_000)
  })
  it('create 非法调度抛错：坏 cron / interval<=0 / once 过去', () => {
    const { svc } = makeService()
    const now = new Date('2026-01-15T10:00:00')
    expect(() => svc.create(input({ schedule: { type: 'cron', expr: 'bad' } }), now)).toThrow()
    expect(() => svc.create(input({ schedule: { type: 'interval', minutes: 0 } }), now)).toThrow()
    expect(() => svc.create(input({ schedule: { type: 'once', at: '2026-01-15T09:00:00' } }), now)).toThrow()
  })
  it('create once 畸形 at（NaN）抛错', () => {
    const { svc } = makeService()
    expect(() => svc.create(input({ schedule: { type: 'once', at: '' } }), new Date('2026-01-15T10:00:00'))).toThrow()
  })
  it('update 改调度后重算 nextRunAt；setEnabled(false) 清空', () => {
    const { svc } = makeService()
    const now = new Date('2026-01-15T10:00:00')
    const t = svc.create(input(), now)
    svc.update(t.id, { schedule: { type: 'interval', minutes: 10 } }, new Date('2026-01-15T11:00:00'))
    expect(new Date(svc.tasks[0].nextRunAt!).getTime() - new Date('2026-01-15T11:00:00').getTime()).toBe(10 * 60_000)
    svc.setEnabled(t.id, false)
    expect(svc.tasks[0].nextRunAt).toBeUndefined()
    svc.setEnabled(t.id, true)
    expect(svc.tasks[0].nextRunAt).toBeDefined()
  })
  it('remove 删除任务', () => {
    const { svc } = makeService()
    const t = svc.create(input())
    expect(svc.remove(t.id)).toBe(true)
    expect(svc.tasks).toHaveLength(0)
  })
  it('过期 once 任务：update 改名成功（不校验 once-future）；patch schedule 为过去 once 仍抛错', () => {
    const { svc } = makeService()
    const t = svc.create(input({ schedule: { type: 'once', at: '2026-01-15T10:30:00' } }), new Date('2026-01-15T10:00:00'))
    const later = new Date('2026-01-15T11:00:00')
    const updated = svc.update(t.id, { name: 'renamed' }, later)
    expect(updated?.name).toBe('renamed')
    expect(() => svc.update(t.id, { schedule: { type: 'once', at: '2026-01-15T10:30:00' } }, later)).toThrow()
  })
  it('过期 once 任务 update({name}) 不唤醒：禁用 + 清 nextRunAt + tick 不触发', () => {
    const d = deferred()
    const calls: string[] = []
    const { svc } = makeService((t) => {
      calls.push(t.id)
      return { runId: 'r', promise: d.promise, kill: () => undefined }
    })
    const task = svc.create(input({ schedule: { type: 'once', at: '2026-01-15T10:30:00' } }), new Date('2026-01-15T10:00:00'))
    const updated = svc.update(task.id, { name: 'renamed' }, new Date('2026-01-15T11:00:00'))
    expect(updated?.name).toBe('renamed')
    expect(svc.tasks[0].enabled).toBe(false)
    expect(svc.tasks[0].nextRunAt).toBeUndefined()
    svc.tick(new Date('2026-01-15T11:00:30'))
    expect(calls).toHaveLength(0)
  })
  it('setEnabled(true) 不复活过期 once 任务', () => {
    const { svc } = makeService()
    const task = svc.create(input({ schedule: { type: 'once', at: '2026-01-15T10:30:00' } }), new Date('2026-01-15T10:00:00'))
    svc.setEnabled(task.id, false, new Date('2026-01-15T10:10:00'))
    svc.setEnabled(task.id, true, new Date('2026-01-15T11:00:00'))
    expect(svc.tasks[0].enabled).toBe(false)
    expect(svc.tasks[0].nextRunAt).toBeUndefined()
  })
})

describe('TaskService.tick 触发与防抖', () => {
  it('到点触发一次：history 出现 running，runner 收到任务；nextRunAt 前进', async () => {
    const calls: ScheduledTask[] = []
    const d = deferred()
    const { svc } = makeService((t, _ctx: RunContext) => { calls.push(t); return { runId: 'run-x', promise: d.promise, kill: () => undefined } })
    const t0 = new Date('2026-01-15T10:00:00')
    const task = svc.create(input(), t0)
    ;(task as ScheduledTask).nextRunAt = '2026-01-15T10:00:00' // 强制立即到期
    const t1 = new Date('2026-01-15T10:00:01')
    svc.tick(t1)
    expect(calls).toHaveLength(1)
    expect(calls[0].id).toBe(task.id)
    expect(svc.history.some((r) => r.taskId === task.id && r.status === 'running')).toBe(true)
    expect(new Date(svc.tasks[0].nextRunAt!).getTime() - t1.getTime()).toBe(5 * 60_000)

    // 运行中第二次 tick：跳过，不重复触发
    svc.tick(new Date('2026-01-15T10:05:30'))
    expect(calls).toHaveLength(1)

    // 完成：状态合并 success + 通知
    d.resolve({ id: 'run-x', status: 'success', exitCode: 0, resultText: 'ok', finishedAt: '2026-01-15T10:06:00.000Z' })
    await settle()
    const rec = svc.history.find((r) => r.id === 'run-x')!
    expect(rec.status).toBe('success')
    expect(rec.resultText).toBe('ok')
  })
  it('once 任务完成后自动禁用', async () => {
    const d = deferred()
    const { svc } = makeService(() => ({ runId: 'run-y', promise: d.promise, kill: () => undefined }))
    const task = svc.create(input({ schedule: { type: 'once', at: '2026-01-15T10:01:00' } }), new Date('2026-01-15T10:00:00'))
    ;(task as ScheduledTask).nextRunAt = '2026-01-15T10:00:30'
    svc.tick(new Date('2026-01-15T10:00:31'))
    d.resolve({ id: 'run-y', status: 'success' })
    await settle()
    expect(svc.tasks[0].enabled).toBe(false)
  })
  it('runNow 可手动触发（含已禁用任务）', () => {
    const d = deferred()
    const calls: string[] = []
    const { svc } = makeService((t) => { calls.push(t.id); return { runId: 'r', promise: d.promise, kill: () => undefined } })
    const task = svc.create(input())
    svc.setEnabled(task.id, false)
    svc.runNow(task.id)
    expect(calls).toEqual([task.id])
  })
  it('claudePath=null：立即失败记录 + 通知', async () => {
    const d = deferred()
    const { svc, notified } = makeService(() => ({ runId: 'r', promise: d.promise, kill: () => undefined }))
    ;(svc as unknown as { deps: { claudePath: string | null } }).deps.claudePath = null
    const task = svc.create(input())
    svc.runNow(task.id)
    const rec = svc.history.find((r) => r.taskId === task.id)!
    expect(rec.status).toBe('failed')
    expect(rec.error).toContain('claude')
    expect(notified).toHaveLength(1)
  })
  it('finding #1: claudePath 缺失时 interval 任务不循环 spam', () => {
    const d = deferred()
    const calls: string[] = []
    const { svc, notified } = makeService(() => { calls.push('ran'); return { runId: 'r', promise: d.promise, kill: () => undefined } })
    ;(svc as unknown as { deps: { claudePath: string | null } }).deps.claudePath = null
    const task = svc.create(input({ schedule: { type: 'interval', minutes: 5 } }), new Date('2026-01-15T10:00:00'))
    // 强制立即到期
    ;(task as ScheduledTask).nextRunAt = '2026-01-15T10:00:00'
    svc.tick(new Date('2026-01-15T10:00:01'))
    expect(calls).toEqual([])  // claudePath=null 时不调 runner
    expect(svc.tasks[0].enabled).toBe(false)  // 立即禁用
    expect(svc.tasks[0].nextRunAt).toBeUndefined()
    const failedRec = svc.history.find((r) => r.taskId === task.id && r.status === 'failed')
    expect(failedRec).toBeDefined()
    expect(failedRec?.error).toContain('claude')
    // 第二次 tick：不会重复触发
    svc.tick(new Date('2026-01-15T10:00:30'))
    expect(calls).toEqual([])
    expect(svc.history.filter((r) => r.taskId === task.id && r.status === 'failed')).toHaveLength(1)
    // 通知只发一次
    expect(notified).toHaveLength(1)
  })
  it('runner promise reject → failed 记录（error=异常 message）+ active 清理', async () => {
    let rejectFn!: (e: Error) => void
    const promise = new Promise<RunRecord>((_, rej) => {
      rejectFn = rej
    })
    const { svc } = makeService(() => ({ runId: 'run-rej', promise, kill: () => undefined }))
    const task = svc.create(input())
    svc.runNow(task.id)
    expect(svc.isRunning(task.id)).toBe(true)
    rejectFn(new Error('boom'))
    await settle()
    expect(svc.isRunning(task.id)).toBe(false)
    const rec = svc.history.find((r) => r.id === 'run-rej')!
    expect(rec.status).toBe('failed')
    expect(rec.error).toBe('boom')
  })
  it('tick 单任务异常隔离：runner 同步抛错不阻断其他任务触发', () => {
    const d = deferred()
    const calls: string[] = []
    const { svc } = makeService((t) => {
      if (t.name === 'bad') throw new Error('spawn fail')
      calls.push(t.id)
      return { runId: 'r', promise: d.promise, kill: () => undefined }
    })
    const bad = svc.create(input({ name: 'bad' }), new Date('2026-01-15T10:00:00'))
    const good = svc.create(input({ name: 'good' }), new Date('2026-01-15T10:00:00'))
    ;(bad as ScheduledTask).nextRunAt = '2026-01-15T10:00:00' // 两个任务都立即到期
    ;(good as ScheduledTask).nextRunAt = '2026-01-15T10:00:00'
    svc.tick(new Date('2026-01-15T10:00:01'))
    // 隔离：'good' 仍被触发，'bad' 的 runner 抛错没阻断后续
    expect(calls).toEqual([good.id])
    // 修复 finding #9：抛错也写 history，error 携带原始 message
    const badRec = svc.history.find((r) => r.taskId === bad.id && r.status === 'failed')
    expect(badRec).toBeDefined()
    expect(badRec?.error).toContain('spawn fail')
  })
})

describe('TaskService.load（错过标记）', () => {
  it('持久化 nextRunAt 已过 → missed 记录 + 重算', () => {
    const { svc: seed } = makeService()
    const task = seed.create(input(), new Date('2026-01-15T08:00:00'))
    // 直接用 seed 的 storeDir 构造第二个 service 实例模拟重启
    const { svc } = makeService()
    svc.tasks = JSON.parse(JSON.stringify(seed.tasks)) as ScheduledTask[]
    ;(svc.tasks[0] as ScheduledTask).nextRunAt = '2026-01-15T09:00:00'
    svc.persist()
    const rebooted = new TaskService({ storeDir, runsDir, claudePath: '/fake/claude', env: {} })
    rebooted.load(new Date('2026-01-15T10:00:00'))
    const missed = rebooted.history.find((r) => r.taskId === task.id && r.status === 'missed')
    expect(missed?.startedAt).toBe('2026-01-15T09:00:00') // 原样保留持久化的时刻串
    expect(new Date(rebooted.tasks[0].nextRunAt!).getTime() - new Date('2026-01-15T10:00:00').getTime()).toBe(5 * 60_000)
  })
  it('错过的 once 任务 load 后禁用不补跑', () => {
    const calls: string[] = []
    const d = deferred()
    const { svc: seed } = makeService()
    const task = seed.create(input({ schedule: { type: 'once', at: '2026-01-15T09:30:00' } }), new Date('2026-01-15T09:00:00'))
    // 同一 storeDir 重建实例模拟重启；load 后 tick 不应补跑
    const rebooted = new TaskService({
      storeDir, runsDir, claudePath: '/fake/claude', env: {},
      runner: (t) => {
        calls.push(t.id)
        return { runId: 'r2', promise: d.promise, kill: () => undefined }
      }
    })
    rebooted.load(new Date('2026-01-15T10:00:00'))
    expect(rebooted.tasks[0].enabled).toBe(false)
    expect(rebooted.tasks[0].nextRunAt).toBeUndefined()
    expect(rebooted.history.some((r) => r.taskId === task.id && r.status === 'missed')).toBe(true)
    rebooted.tick(new Date('2026-01-15T10:00:30'))
    expect(calls).toHaveLength(0)
  })
  it('load：missed push 到尾部破坏降序后一次性排序恢复（#13）', () => {
    const { svc: seed } = makeService()
    const task = seed.create(input(), new Date('2026-01-15T08:00:00'))
    const { svc } = makeService()
    svc.tasks = JSON.parse(JSON.stringify(seed.tasks)) as ScheduledTask[]
    ;(svc.tasks[0] as ScheduledTask).nextRunAt = '2026-01-15T09:00:00'
    // 磁盘 history 本身降序；missed(09:00) push 到尾部后变乱序 [10:00, 08:30, 09:00]
    svc.history = [
      { id: 'h-new', taskId: task.id, startedAt: '2026-01-15T10:00:00', status: 'success' },
      { id: 'h-old', taskId: task.id, startedAt: '2026-01-15T08:30:00', status: 'success' }
    ]
    svc.persist()
    const rebooted = new TaskService({ storeDir, runsDir, claudePath: '/fake/claude', env: {} })
    rebooted.load(new Date('2026-01-15T11:00:00'))
    // missed(09:00) 应落回 10:00 与 08:30 之间，整条 history 严格降序
    expect(rebooted.history.map((r) => r.startedAt)).toEqual([
      '2026-01-15T10:00:00',
      '2026-01-15T09:00:00',
      '2026-01-15T08:30:00'
    ])
  })
})

// 微任务沉淀：让 fire() 里 handle.promise.then 链跑完
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('finding #2: persist 失败不崩主进程', () => {
  it('saveTasks 抛错时 fire 不抛，history 仍保留在内存', async () => {
    const d = deferred()
    const { svc, persistErrors, logs } = makeService(() => ({ runId: 'r', promise: d.promise, kill: () => undefined }))
    // 让 saveTasks 抛 EACCES：模拟磁盘不可写（ESM export 是 getter，spyOn 才能覆盖）
    const origStore = await import('../store/TaskStore')
    const spy = vi.spyOn(origStore, 'saveTasks').mockImplementation(() => { throw new Error('EACCES') })
    try {
      const task = svc.create(input())
      // create → safePersist('create') 抛错被吞；fire 不冒泡
      expect(() => svc.runNow(task.id)).not.toThrow()
      // history 应仍含 running 记录（内存状态没丢）
      expect(svc.history.some((r) => r.taskId === task.id)).toBe(true)
      // onPersistError 已被收集
      expect(persistErrors.length).toBeGreaterThan(0)
      expect((persistErrors[0] as Error).message).toBe('EACCES')
      // log 也被记录（label 形如 create / fire-insert / runNow）
      expect(logs.some((l) => l.includes('persist failed'))).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('finding #9: runner 同步抛错写入 history', () => {
  it('runner 同步抛异常时，history 含 failed 记录且有 error 信息', () => {
    const d = deferred()
    const { svc } = makeService((t) => {
      if (t.name === 'boom') throw new Error('spawn fail sync')
      return { runId: 'r', promise: d.promise, kill: () => undefined }
    })
    const task = svc.create(input({ name: 'boom' }), new Date('2026-01-15T10:00:00'))
    ;(task as ScheduledTask).nextRunAt = '2026-01-15T10:00:00'
    svc.tick(new Date('2026-01-15T10:00:01'))
    const rec = svc.history.find((r) => r.taskId === task.id && r.status === 'failed')
    expect(rec).toBeDefined()
    expect(rec?.error).toContain('spawn fail sync')
  })

  it('runner 返回 null 时 history 含 failed 记录', () => {
    const { svc } = makeService(() => null)
    const task = svc.create(input({ name: 'nullish' }))
    svc.runNow(task.id)
    const rec = svc.history.find((r) => r.taskId === task.id && r.status === 'failed')
    expect(rec).toBeDefined()
    expect(rec?.error).toContain('runner')
  })
})

describe('finding #5: remove() cancels in-flight runner', () => {
  it('remove 取消 active handle 不 notify', async () => {
    const d = deferred()
    const calls: string[] = []
    const { svc, notified } = makeService((t) => {
      calls.push(t.id)
      return { runId: 'r', promise: d.promise, kill: () => { calls.push('kill') } }
    })
    const task = svc.create(input())
    svc.runNow(task.id)
    expect(svc.isRunning(task.id)).toBe(true)

    // 用户删除任务
    expect(svc.remove(task.id)).toBe(true)
    expect(calls).toContain('kill')

    // 模拟 runner 完成（finishRun 触发）
    d.resolve({ id: 'r', status: 'success' })
    await settle()

    // 没有通知（cancelled）
    expect(notified).toHaveLength(0)
    // 但 history 仍有记录
    expect(svc.history.some((r) => r.taskId === task.id)).toBe(true)
  })

  it('非 cancelled 任务正常 notify', async () => {
    const d = deferred()
    const { svc, notified } = makeService(() => ({ runId: 'r', promise: d.promise, kill: () => undefined }))
    const task = svc.create(input())
    svc.runNow(task.id)
    // 不删除，直接完成
    d.resolve({ id: 'r', status: 'success' })
    await settle()
    expect(notified.length).toBeGreaterThan(0)
  })
})
