import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useToastStore, errMessage } from './toast'

describe('useToastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    vi.useFakeTimers()
  })

  it('show 叠加两条', () => {
    useToastStore.getState().show('a')
    useToastStore.getState().show('b', 'info')
    const t = useToastStore.getState().toasts
    expect(t).toHaveLength(2)
    expect(t[0]).toMatchObject({ message: 'a', kind: 'danger' })
    expect(t[1]).toMatchObject({ message: 'b', kind: 'info' })
  })

  it('5s 自动消失', () => {
    useToastStore.getState().show('x')
    vi.advanceTimersByTime(5000)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('dismiss 移除指定条', () => {
    useToastStore.getState().show('a')
    useToastStore.getState().show('b')
    const id = useToastStore.getState().toasts[0].id
    useToastStore.getState().dismiss(id)
    const t = useToastStore.getState().toasts
    expect(t).toHaveLength(1)
    expect(t[0].message).toBe('b')
  })

  it('errMessage 提取 Error message / String 兜底', () => {
    expect(errMessage(new Error('boom'))).toBe('boom')
    expect(errMessage('raw')).toBe('raw')
  })
})
