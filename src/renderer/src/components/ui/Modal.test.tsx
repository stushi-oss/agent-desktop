import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { Modal } from './Modal'

// 显式 cleanup：vitest globals:false 下 RTL 不自动注册 afterEach(cleanup)，
// 多实例用例若不清理会让监听器跨用例泄漏，污染后续断言。
afterEach(cleanup)

describe('Modal Escape (#11)', () => {
  it('Escape 触发 onClose', () => {
    const onClose = vi.fn()
    render(<Modal title="t" onClose={onClose}>x</Modal>)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('非 Escape 键不触发', () => {
    const onClose = vi.fn()
    render(<Modal title="t" onClose={onClose}>x</Modal>)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(onClose).not.toHaveBeenCalled()
  })
  it('卸载后监听移除', () => {
    const onClose = vi.fn()
    const { unmount } = render(<Modal title="t" onClose={onClose}>x</Modal>)
    unmount()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).not.toHaveBeenCalled()
  })
  it('多个实例时各自触发自己的 onClose', () => {
    const onA = vi.fn(); const onB = vi.fn()
    render(<Modal title="a" onClose={onA}>x</Modal>)
    render(<Modal title="b" onClose={onB}>y</Modal>)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onA).toHaveBeenCalledTimes(1)
    expect(onB).toHaveBeenCalledTimes(1)
  })
})
