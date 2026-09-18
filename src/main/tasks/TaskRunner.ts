import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { RunRecord, ScheduledTask, StreamEvent } from '@shared/types'
import { extractResultText, parseStreamLine } from './streamJson'
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

/** headless 执行一个任务：spawn claude -p、transcript 落盘、超时杀进程 */
export function startRun(task: ScheduledTask, ctx: RunContext, opts: RunOpts = {}): RunHandle {
  const spawnFn = opts.spawnFn ?? spawn
  const runId = newId()
  const startedAt = new Date().toISOString()
  const events: StreamEvent[] = []
  let finished = false
  let timedOut = false

  const dir = join(ctx.runsDir, task.id)
  mkdirSync(dir, { recursive: true })
  const transcriptPath = join(dir, `${runId}.jsonl`)
  const out = createWriteStream(transcriptPath, { encoding: 'utf8', flags: 'w' })
  let buffer = ''

  const args = [
    '-p', task.prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', task.permissionMode
  ]
  if (task.model) args.push('--model', task.model)

  const child: ChildProcess = spawnFn(ctx.claudePath, args, { cwd: task.cwd, env: ctx.env })
  const timeoutMs = opts.timeoutMs ?? Math.max(1, task.timeoutMinutes) * 60_000

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
        const ev = parseStreamLine(line)
        if (ev) events.push(ev)
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
      setTimeout(() => {
        if (!finished && child.exitCode === null) child.kill('SIGKILL')
      }, 3000).unref()
    }, timeoutMs)
    timer.unref()
  })

  return { runId, promise, kill: () => child.kill('SIGTERM') }
}
