import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SessionManager, type PtyFactory, type PtyProcess } from './SessionManager'

class FakePty implements PtyProcess {
  written: string[] = []
  killed = false
  exited = false
  private dataCbs: Array<(d: string) => void> = []
  private exitCbs: Array<(c: number | undefined) => void> = []
  constructor(public opts: { file: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; cols: number; rows: number }) {}
  write(data: string): void { this.written.push(data) }
  resize(cols: number, rows: number): void { this.opts.cols = cols; this.opts.rows = rows }
  kill(): void { this.killed = true; this.exit(0) }
  onData(cb: (d: string) => void): void { this.dataCbs.push(cb) }
  onExit(cb: (c: number | undefined) => void): void { this.exitCbs.push(cb) }
  emitData(d: string): void { for (const cb of this.dataCbs) cb(d) }
  exit(code: number | undefined): void { if (this.exited) return; this.exited = true; for (const cb of this.exitCbs) cb(code) }
}

function makeManager(runClaude = true) {
  const created: FakePty[] = []
  const factory: PtyFactory = (opts) => {
    const pty = new FakePty(opts)
    created.push(pty)
    return pty
  }
  const mgr = new SessionManager(factory, { env: { HOME: '/Users/u' }, launchClaude: runClaude, claudeLaunchDelayMs: 10 })
  return { mgr, created }
}

describe('SessionManager', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('create 返回会话摘要，title 为 cwd basename', () => {
    const { mgr } = makeManager(false)
    const info = mgr.create('/Users/u/proj-a', 80, 24, { file: '/bin/zsh', args: ['-l'], label: 'zsh' })
    expect(info.title).toBe('proj-a')
    expect(info.cwd).toBe('/Users/u/proj-a')
    expect(info.alive).toBe(true)
    expect(mgr.list().map((s) => s.id)).toEqual([info.id])
  })

  it('create 后延迟写入 "claude\\r"（launchClaude=true）', () => {
    const { mgr, created } = makeManager(true)
    mgr.create('/Users/u/p', 80, 24, { file: '/bin/zsh', args: ['-l'], label: 'zsh' })
    expect(created[0].written).toEqual([])
    vi.advanceTimersByTime(20)
    expect(created[0].written).toEqual(['claude\r'])
  })

  it('launchClaude=false 不写入 claude', () => {
    const { mgr, created } = makeManager(false)
    mgr.create('/p', 80, 24, { file: '/bin/zsh', args: [], label: 'zsh' })
    vi.advanceTimersByTime(50)
    expect(created[0].written).toEqual([])
  })

  it('write/resize 转发到对应 pty', () => {
    const { mgr, created } = makeManager(false)
    const a = mgr.create('/a', 80, 24, { file: '/bin/zsh', args: [], label: 'zsh' })
    mgr.write(a.id, 'ls\n')
    mgr.resize(a.id, 100, 30)
    expect(created[0].written).toEqual(['ls\n'])
    expect(created[0].opts.cols).toBe(100)
  })

  it('onData 广播带会话 id；onExit 后 alive=false', () => {
    const { mgr, created } = makeManager(false)
    const seen: Array<{ id: string; data: string }> = []
    const exits: Array<{ id: string; code: number | undefined }> = []
    mgr.onData((ev) => seen.push(ev))
    mgr.onExit((ev) => exits.push(ev))
    const a = mgr.create('/a', 80, 24, { file: '/bin/zsh', args: [], label: 'zsh' })
    created[0].emitData('hello')
    expect(seen).toEqual([{ id: a.id, data: 'hello' }])
    created[0].exit(3)
    expect(exits).toEqual([{ id: a.id, code: 3 }])
    expect(mgr.list()[0].alive).toBe(false)
  })

  it('kill 杀 pty 并标记退出', () => {
    const { mgr, created } = makeManager(false)
    const a = mgr.create('/a', 80, 24, { file: '/bin/zsh', args: [], label: 'zsh' })
    mgr.kill(a.id)
    expect(created[0].killed).toBe(true)
    expect(mgr.list()[0].alive).toBe(false)
  })

  it('kill 不存在的 id 不抛错', () => {
    const { mgr } = makeManager(false)
    expect(() => mgr.kill('nope')).not.toThrow()
  })
})
