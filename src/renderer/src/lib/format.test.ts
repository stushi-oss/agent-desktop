import { describe, it, expect } from 'vitest'
import { formatRelative, formatDateTime, toLocalInputValue } from './format'

const NOW = new Date('2026-01-15T10:00:00')

describe('formatRelative', () => {
  it('5 分钟后（en）包含 5', () => {
    expect(formatRelative(new Date(NOW.getTime() + 5 * 60_000).toISOString(), 'en', NOW)).toContain('5')
  })
  it('3 小时前（en）包含 3', () => {
    expect(formatRelative(new Date(NOW.getTime() - 3 * 3_600_000).toISOString(), 'en', NOW)).toContain('3')
  })
  it('2 天后（en）包含 2', () => {
    expect(formatRelative(new Date(NOW.getTime() + 2 * 86_400_000).toISOString(), 'en', NOW)).toContain('2')
  })
})

describe('formatDateTime', () => {
  it('en 输出包含 Jan', () => {
    expect(formatDateTime('2026-01-15T10:00:00', 'en').toLowerCase()).toContain('jan')
  })
})

describe('toLocalInputValue', () => {
  it('转 datetime-local 格式', () => {
    expect(toLocalInputValue(new Date(2026, 0, 15, 9, 5))).toBe('2026-01-15T09:05')
  })
})
