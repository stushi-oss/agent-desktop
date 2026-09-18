import { describe, it, expect } from 'vitest'
import { nextRunOf, isDue } from './schedule'
import { isValidCronExpr } from '@shared/scheduleCheck'
import type { Schedule } from '@shared/types'

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

describe('nextRunOf 边界与兜底（全函数契约）', () => {
  it('坏 cron 表达式 → null', () => {
    expect(nextRunOf({ type: 'cron', expr: 'not a cron' }, T('2026-01-15T10:00:00'))).toBeNull()
  })
  it('畸形 once.at → null', () => {
    expect(nextRunOf({ type: 'once', at: 'not-a-date' }, T('2026-01-15T10:00:00'))).toBeNull()
  })
  it('minutes <= 0 → null（防 nextRunAt 恒在过去的热循环）', () => {
    expect(nextRunOf({ type: 'interval', minutes: 0 }, T('2026-01-15T10:00:00'))).toBeNull()
    expect(nextRunOf({ type: 'interval', minutes: -5 }, T('2026-01-15T10:00:00'))).toBeNull()
  })
  it('未知 type → null（旧 schema 运行时兜底）', () => {
    expect(nextRunOf({ type: 'weekly' } as unknown as Schedule, T('2026-01-15T10:00:00'))).toBeNull()
  })
  it('cron currentDate 恰等于触发点 → 明天（next() 严格晚于 currentDate）', () => {
    expect(nextRunOf({ type: 'cron', expr: '30 8 * * *' }, T('2026-01-15T08:30:00'))).toEqual(T('2026-01-16T08:30:00'))
  })
})

describe('isValidCronExpr', () => {
  it('5 段且合法 → true', () => expect(isValidCronExpr('*/30 * * * *')).toBe(true))
  it('非 5 段 → false', () => expect(isValidCronExpr('* * * *')).toBe(false))
  it('5 段但非法 → false', () => expect(isValidCronExpr('99 * * * *')).toBe(false))
})
