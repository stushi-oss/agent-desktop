import { describe, it, expect, beforeEach } from 'vitest'
import { cancelTask, isCancelled, clearCancelled } from './taskLifecycle'

describe('taskLifecycle', () => {
  beforeEach(() => clearCancelled('t1'))

  it('cancelTask 标记 taskId', () => {
    expect(cancelTask('t1')).toBe(true)
    expect(isCancelled('t1')).toBe(true)
  })

  it('cancelTask 重复调用返回 false', () => {
    cancelTask('t1')
    expect(cancelTask('t1')).toBe(false)
  })

  it('clearCancelled 清除标记', () => {
    cancelTask('t1')
    clearCancelled('t1')
    expect(isCancelled('t1')).toBe(false)
  })

  it('isCancelled 默认 false', () => {
    expect(isCancelled('never-cancelled')).toBe(false)
  })
})