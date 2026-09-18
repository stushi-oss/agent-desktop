import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { SessionSummary } from '@shared/types'
import type { ShellChoice } from '../shellSelect'

export interface PtySpawnOptions {
  file: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  cols: number
  rows: number
}

export interface PtyProcess {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  onData(cb: (data: string) => void): void
  onExit(cb: (code: number | undefined) => void): void
}

export type PtyFactory = (opts: PtySpawnOptions) => PtyProcess

interface SessionEntry {
  info: SessionSummary
  pty: PtyProcess
  claudeTimer?: NodeJS.Timeout
}

export class SessionManager {
  private sessions = new Map<string, SessionEntry>()
  // 类级监听器集合：注册时机与会话创建顺序解耦（IPC 广播在启动时注册，早于任何会话）
  private dataListeners = new Set<(ev: { id: string; data: string }) => void>()
  private exitListeners = new Set<(ev: { id: string; code: number | undefined }) => void>()

  constructor(
    private readonly factory: PtyFactory,
    private readonly defaults: {
      env: NodeJS.ProcessEnv
      launchClaude: boolean
      claudeLaunchDelayMs?: number
    }
  ) {}

  create(cwd: string, cols: number, rows: number, shell: ShellChoice): SessionSummary {
    const id = randomUUID()
    const pty = this.factory({
      file: shell.file,
      args: shell.args,
      cwd,
      env: this.defaults.env,
      cols,
      rows
    })
    const info: SessionSummary = {
      id,
      title: basename(cwd) || cwd,
      cwd,
      shellCommand: shell.file,
      createdAt: new Date().toISOString(),
      alive: true
    }
    const entry: SessionEntry = { info, pty }
    this.sessions.set(id, entry)

    pty.onData((data) => {
      for (const cb of this.dataListeners) {
        try {
          cb({ id, data })
        } catch (err) {
          console.error('[SessionManager] data listener error', err)
        }
      }
    })
    pty.onExit((code) => {
      info.alive = false
      if (entry.claudeTimer) clearTimeout(entry.claudeTimer)
      for (const cb of this.exitListeners) {
        try {
          cb({ id, code })
        } catch (err) {
          console.error('[SessionManager] exit listener error', err)
        }
      }
    })

    if (this.defaults.launchClaude) {
      entry.claudeTimer = setTimeout(
        () => pty.write('claude\r'),
        this.defaults.claudeLaunchDelayMs ?? 600
      )
    }
    return { ...info }
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.pty.resize(cols, rows)
  }

  kill(id: string): void {
    const entry = this.sessions.get(id)
    if (!entry) return
    if (entry.claudeTimer) clearTimeout(entry.claudeTimer)
    entry.pty.kill()
    entry.info.alive = false
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()].map((s) => ({ ...s.info }))
  }

  onData(cb: (ev: { id: string; data: string }) => void): void {
    this.dataListeners.add(cb)
  }

  onExit(cb: (ev: { id: string; code: number | undefined }) => void): void {
    this.exitListeners.add(cb)
  }
}
