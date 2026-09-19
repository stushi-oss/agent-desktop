import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { RunRecord, ScheduledTask } from '@shared/types'
import type { NormalizedEvent } from '@shared/streamEvents'
import { extractResultText, parseEvents } from './streamJson'
import { newId } from '../store/TaskStore'

export interface RunContext {
  claudePath: string
  env: NodeJS.ProcessEnv
  runsDir: string
}

export interface RunHandle {
  runId: string
  promise: Promise<RunRecord>
  kill(): void
}

export type SpawnFn = typeof spawn

export interface RunOpts {
  spawnFn?: SpawnFn
  /** 测试用：毫秒级超时覆盖 task.timeoutMinutes */
  timeoutMs?: number
}

/**
 * 修复 finding #10：调度 SIGKILL fallback。
 * 创建的 timer **不要** `.unref()`——必须保持事件循环活跃直到 SIGKILL 触发或子进程退出。
 * 如果 child 忽略 SIGTERM 而 outer timer 已 unref，事件循环可能在外层 timer 触发
 * 与 SIGKILL 触发之间退出，留下 zombie 进程。
 * 导出此函数以便测试直接验证 timer 行为，绕开 spawn mock。
 */
export function scheduleForceKill(
  child: { kill: (signal?: NodeJS.Signals | number) => boolean; exitCode: number | null; signalCode: NodeJS.Signals | null },
  getFinished: () => boolean,
  delayMs = 3000
): NodeJS.Timeout {
  return setTimeout(() => {
    if (!getFinished() && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
    }
  }, delayMs)
}

/** headless 执行一个任务：spawn claude -p、transcript 落盘、超时杀进程 */
export function startRun(task: ScheduledTask, ctx: RunContext, opts: RunOpts = {}): RunHandle {
  const spawnFn = opts.spawnFn ?? spawn
  const runId = newId()
  const startedAt = new Date().toISOString()
  const events: NormalizedEvent[] = []
  let finished = false
  let timedOut = false

  const dir = join(ctx.runsDir, task.id)
  mkdirSync(dir, { recursive: true })
  const transcriptPath = join(dir, `${runId}.jsonl`)
  const out = createWriteStream(transcriptPath, { encoding: 'utf8', flags: 'w' })
  // 写失败（ENOSPC/EACCES/runsDir 被删）不能让流抛未捕获异常崩掉整个应用
  out.on('error', (err) => console.error('[runner] transcript write failed', err))
  let buffer = ''

  const args = [
    '-p', task.prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', task.permissionMode
  ]
  if (task.model) args.push('--model', task.model)

  const child: ChildProcess = spawnFn(ctx.claudePath, args, { cwd: task.cwd, env: ctx.env })
  // Number.isFinite 同时挡掉 undefined 与 NaN（NaN 的 setTimeout 会立即触发）
  const timeoutMs =
    opts.timeoutMs !== undefined && Number.isFinite(opts.timeoutMs)
      ? opts.timeoutMs
      : Math.max(1, task.timeoutMinutes) * 60_000

  const promise = new Promise<RunRecord>((resolve) => {
    const settle = (record: RunRecord): void => {
      if (finished) return
      finished = true
      if (timer) clearTimeout(timer)
      out.end(() => resolve(record))
    }

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      out.write(chunk)
      buffer += chunk
      let idx: number
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        // parseEvents 处理单行 raw 时返回 0 或 1 个 event；spread 累加到 events
        events.push(...parseEvents(line))
      }
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => out.write(chunk))

    child.on('error', (err) => {
      settle({
        id: runId, taskId: task.id, startedAt, finishedAt: new Date().toISOString(),
        status: 'failed', error: err.message, transcriptPath
      })
    })

    child.on('close', (code) => {
      // flush 未换行结尾的末行，否则 transcript 有它但 extractResultText 拿不到
      if (buffer.trim()) {
        events.push(...parseEvents(buffer))
        buffer = ''
      }
      settle({
        id: runId, taskId: task.id, startedAt, finishedAt: new Date().toISOString(),
        status: code === 0 ? 'success' : 'failed',
        exitCode: code ?? undefined,
        resultText: extractResultText(events),
        error: timedOut ? `timeout after ${timeoutMs}ms` : undefined,
        transcriptPath
      })
    })

    const timer: NodeJS.Timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      // 修复 finding #10：inner SIGKILL timer 不 .unref()——
      // 必须保持事件循环活跃直到 SIGKILL 触发或子进程退出。
      // outer timer 仍 .unref()，启动退出不受阻塞。
      scheduleForceKill(child, () => finished, 3000)
    }, timeoutMs)
    timer.unref()
  })

  return {
    runId,
    promise,
    kill: () => {
      if (!finished && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    }
  }
}
