import { CronExpressionParser } from 'cron-parser'
import type { Schedule } from '@shared/types'

/** 计算下一次触发时间（本地时区语义）；无法得出有效时间时返回 null */
export function nextRunOf(schedule: Schedule, from: Date): Date | null {
  switch (schedule.type) {
    case 'cron':
      try {
        return CronExpressionParser.parse(schedule.expr, { currentDate: from }).next().toDate()
      } catch {
        return null
      }
    case 'interval': {
      if (!(schedule.minutes > 0)) return null
      const d = new Date(from.getTime() + schedule.minutes * 60_000)
      return Number.isFinite(d.getTime()) ? d : null
    }
    case 'once': {
      const d = new Date(schedule.at)
      return Number.isFinite(d.getTime()) ? d : null
    }
    default:
      return null // 运行时穷尽守卫（旧 schema 的未知 type）
  }
}

export function isDue(nextRunAt: string | undefined, now: Date): boolean {
  if (!nextRunAt) return false
  return new Date(nextRunAt).getTime() <= now.getTime()
}
