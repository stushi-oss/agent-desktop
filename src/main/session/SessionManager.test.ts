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

function makeManager() {
  const created: FakePty[] = []
  const factory: PtyFactory = (opts) => {
    const pty = new FakePty(opts)
    created.push(pty)
    return pty
  }
  const mgr = new SessionManager(factory, { env: { HOME: '/Users/u' }, claudeLaunchDelayMs: 10 })
  return { mgr, created }
}

const zshShell = { file: '/bin/zsh', args: ['-l'], label: 'zsh' }
const shShell = { file: '/bin/zsh', args: [], label: 'zsh' }

describe('SessionManager', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('create 返回会话摘要，title 为 cwd basename', () => {
    const { mgr } = makeManager()
    const info = mgr.create('/Users/u/proj-a', 80, 24, shShell)
    expect(info.title).toBe('proj-a')
    expect(info.cwd).toBe('/Users/u/proj-a')
    expect(info.alive).toBe(true)
    expect(mgr.list().map((s) => s.id)).toEqual([info.id])
  })

  it('create 后延迟写入 "claude\\r"（launchClaude=true）', () => {
    const { mgr, created } = makeManager()
    mgr.create('/Users/u/p', 80, 24, zshShell, true)
    expect(created[0].written).toEqual([])
    vi.advanceTimersByTime(20)
    expect(created[0].written).toEqual(['claude\r'])
  })

  it('launchClaude=false 不写入 claude', () => {
    const { mgr, created } = makeManager()
    mgr.create('/p', 80, 24, shShell, false)
    vi.advanceTimersByTime(50)
    expect(created[0].written).toEqual([])
  })

  it('create() default launchClaude=false', () => {
    const { mgr, created } = makeManager()
    mgr.create('/p', 80, 24, shShell)
    vi.advanceTimersByTime(50)
    expect(created[0].written).toEqual([])
  })

  it('write/resize 转发到对应 pty', () => {
    const { mgr, created } = makeManager()
    const a = mgr.create('/a', 80, 24, shShell)
    mgr.write(a.id, 'ls\n')
    mgr.resize(a.id, 100, 30)
    expect(created[0].written).toEqual(['ls\n'])
    expect(created[0].opts.cols).toBe(100)
  })

  it('onData 广播带会话 id；onExit 后 alive=false', () => {
    const { mgr, created } = makeManager()
    const seen: Array<{ id: string; data: string }> = []
    const exits: Array<{ id: string; code: number | undefined }> = []
    mgr.onData((ev) => seen.push(ev))
    mgr.onExit((ev) => exits.push(ev))
    const a = mgr.create('/a', 80, 24, shShell)
    created[0].emitData('hello')
    expect(seen).toEqual([{ id: a.id, data: 'hello' }])
    created[0].exit(3)
    expect(exits).toEqual([{ id: a.id, code: 3 }])
    expect(mgr.list()[0].alive).toBe(false)
  })

  it('kill 杀 pty 并标记退出', () => {
    const { mgr, created } = makeManager()
    const a = mgr.create('/a', 80, 24, shShell)
    mgr.kill(a.id)
    expect(created[0].killed).toBe(true)
    expect(mgr.list()[0].alive).toBe(false)
  })

  it('kill 不存在的 id 不抛错', () => {
    const { mgr } = makeManager()
    expect(() => mgr.kill('nope')).not.toThrow()
  })

  it('延迟到期前 pty 退出 → 不再写入 claude', () => {
    const { mgr, created } = makeManager()
    mgr.create('/p', 80, 24, zshShell, true)
    created[0].exit(0)
    vi.advanceTimersByTime(50)
    expect(created[0].written).toEqual([])
  })

  it('延迟到期前 kill → 不再写入 claude', () => {
    const { mgr, created } = makeManager()
    const a = mgr.create('/p', 80, 24, zshShell, true)
    mgr.kill(a.id)
    vi.advanceTimersByTime(50)
    expect(created[0].written).toEqual([])
  })

  it('listener 抛异常被隔离，不影响其他 listener 与事件流', () => {
    const { mgr, created } = makeManager()
    const seen: string[] = []
    const exits: Array<number | undefined> = []
    mgr.onData(() => { throw new Error('data listener dead') })
    mgr.onData((ev) => seen.push(ev.data))
    mgr.onExit(() => { throw new Error('exit listener dead') })
    mgr.onExit((ev) => exits.push(ev.code))
    mgr.create('/a', 80, 24, shShell)
    expect(() => created[0].emitData('x')).not.toThrow()
    expect(seen).toEqual(['x'])
    expect(() => created[0].exit(1)).not.toThrow()
    expect(exits).toEqual([1])
    expect(mgr.list()[0].alive).toBe(false)
  })
})
