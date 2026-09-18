import { CronExpressionParser } from 'cron-parser'
import type { Schedule } from '@shared/types'

/** 计算下一次触发时间（本地时区语义） */
export function nextRunOf(schedule: Schedule, from: Date): Date | null {
  switch (schedule.type) {
    case 'cron':
      return CronExpressionParser.parse(schedule.expr, { currentDate: from }).next().toDate()
    case 'interval':
      return new Date(from.getTime() + schedule.minutes * 60_000)
    case 'once':
      return new Date(schedule.at)
  }
}

export function isDue(nextRunAt: string | undefined, now: Date): boolean {
  if (!nextRunAt) return false
  return new Date(nextRunAt).getTime() <= now.getTime()
}
