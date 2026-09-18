import { CronExpressionParser } from 'cron-parser'

/** 5 段标准 cron 校验（渲染端表单与主端创建共用同一规则） */
export function isValidCronExpr(expr: string): boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  try {
    CronExpressionParser.parse(expr)
    return true
  } catch {
    return false
  }
}
