import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { scheduleForceKill } from './TaskRunner'

describe('scheduleForceKill (finding #10)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('延迟后子进程未退出，发送 SIGKILL', () => {
    const child = { kill: vi.fn(), exitCode: null, signalCode: null }
    scheduleForceKill(child, () => false, 100)
    vi.advanceTimersByTime(100)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('子进程已退出（finished=true）时不发送 SIGKILL', () => {
    const child = { kill: vi.fn(), exitCode: 0, signalCode: null }
    scheduleForceKill(child, () => true, 100)
    vi.advanceTimersByTime(100)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('子进程 signalCode 非 null 时不发送 SIGKILL（已被信号终止）', () => {
    const child = { kill: vi.fn(), exitCode: null, signalCode: 'SIGTERM' as NodeJS.Signals }
    scheduleForceKill(child, () => false, 100)
    vi.advanceTimersByTime(100)
    expect(child.kill).not.toHaveBeenCalled()
  })
})