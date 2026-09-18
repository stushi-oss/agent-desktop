import { describe, it, expect } from 'vitest'
import { nextRunOf, isDue } from './schedule'
import { isValidCronExpr } from '@shared/scheduleCheck'

const T = (s: string) => new Date(s)

describe('nextRunOf', () => {
  it('cron */30：10:07 → 10:30，10:31 → 11:00', () => {
    expect(nextRunOf({ type: 'cron', expr: '*/30 * * * *' }, T('2026-01-15T10:07:00'))).toEqual(T('2026-01-15T10:30:00'))
    expect(nextRunOf({ type: 'cron', expr: '*/30 * * * *' }, T('2026-01-15T10:31:00'))).toEqual(T('2026-01-15T11:00:00'))
  })
  it('cron 每日 08:30：当天已过 → 明天', () => {
    expect(nextRunOf({ type: 'cron', expr: '30 8 * * *' }, T('2026-01-15T09:00:00'))).toEqual(T('2026-01-16T08:30:00'))
  })
  it('interval 15 分钟', () => {
    expect(nextRunOf({ type: 'interval', minutes: 15 }, T('2026-01-15T10:00:00'))).toEqual(T('2026-01-15T10:15:00'))
  })
  it('once 返回其自身时间（无论过去与否，由 isDue 判定）', () => {
    expect(nextRunOf({ type: 'once', at: '2026-01-15T08:00:00' }, T('2026-01-15T09:00:00'))).toEqual(T('2026-01-15T08:00:00'))
  })
})

describe('isDue', () => {
  it('undefined → false', () => expect(isDue(undefined, new Date())).toBe(false))
  it('到点 → true；未到 → false', () => {
    expect(isDue('2026-01-15T10:00:00', T('2026-01-15T10:00:00'))).toBe(true)
    expect(isDue('2026-01-15T10:00:01', T('2026-01-15T10:00:00'))).toBe(false)
  })
})

describe('isValidCronExpr', () => {
  it('5 段且合法 → true', () => expect(isValidCronExpr('*/30 * * * *')).toBe(true))
  it('非 5 段 → false', () => expect(isValidCronExpr('* * * *')).toBe(false))
  it('5 段但非法 → false', () => expect(isValidCronExpr('99 * * * *')).toBe(false))
})
