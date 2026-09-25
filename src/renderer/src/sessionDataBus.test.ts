import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerTerminal, _resetForTests } from './sessionDataBus'

let listener: ((ev: { id: string; data: string }) => void) | null = null
const onSessionData = vi.fn((cb: (ev: { id: string; data: string }) => void) => {
  listener = cb
  return () => {
    listener = null
  }
})

beforeEach(() => {
  listener = null
  vi.clearAllMocks()
  _resetForTests()
  ;(globalThis as unknown as { window: unknown }).window = {
    api: { onSessionData }
  }
})

describe('sessionDataBus', () => {
  it('首个注册建立唯一一次 onSessionData 订阅', () => {
    const off = registerTerminal('a', vi.fn())
    expect(onSessionData).toHaveBeenCalledTimes(1)
    off()
  })

  it('第二个注册不重复订阅', () => {
    const off1 = registerTerminal('a', vi.fn())
    const off2 = registerTerminal('b', vi.fn())
    expect(onSessionData).toHaveBeenCalledTimes(1)
    off1()
    off2()
  })

  it('事件按 id 路由到对应 write，其他 write 不收到', () => {
    const writeA = vi.fn()
    const writeB = vi.fn()
    registerTerminal('a', writeA)
    registerTerminal('b', writeB)
    listener!({ id: 'a', data: 'hello' })
    expect(writeA).toHaveBeenCalledWith('hello')
    expect(writeB).not.toHaveBeenCalled()
  })

  it('注销后不再收到事件', () => {
    const write = vi.fn()
    const off = registerTerminal('a', write)
    off()
    listener!({ id: 'a', data: 'x' })
    expect(write).not.toHaveBeenCalled()
  })

  it('重复注册同 id 覆盖旧 write', () => {
    const w1 = vi.fn()
    const w2 = vi.fn()
    registerTerminal('a', w1)
    registerTerminal('a', w2)
    listener!({ id: 'a', data: 'x' })
    expect(w1).not.toHaveBeenCalled()
    expect(w2).toHaveBeenCalledWith('x')
  })

  it('writer 抛错后订阅存活：B 的事件正常路由，A 之后的事件仍可路由', () => {
    // writeA 仅首次抛错：之后恢复，用于验证后续事件仍真实送达
    let threwOnce = false
    const writeA = vi.fn(() => {
      if (!threwOnce) {
        threwOnce = true
        throw new Error('term write exploded')
      }
    })
    const writeB = vi.fn()
    registerTerminal('a', writeA)
    registerTerminal('b', writeB)

    // A 抛错沿 dispatch 冒泡（异常穿透到 IPC listener 一侧），但不破坏分发器状态
    expect(() => listener!({ id: 'a', data: 'boom' })).toThrow('term write exploded')

    // 订阅存活：writer 表未被清，B 的事件照常路由
    listener!({ id: 'b', data: 'hello-b' })
    expect(writeB).toHaveBeenCalledWith('hello-b')

    // A 的注册仍在：后续 A 的事件仍会送达（不影响 app 继续运行）
    listener!({ id: 'a', data: 'after' })
    expect(writeA).toHaveBeenCalledTimes(2)
    expect(writeA).toHaveBeenLastCalledWith('after')
  })
})
