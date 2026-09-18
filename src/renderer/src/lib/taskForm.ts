import type { Schedule } from '@shared/types'
import { isValidCronExpr } from '@shared/scheduleCheck'

export type TaskFormErrorKey =
  | 'tasks.vNameRequired' | 'tasks.vPromptRequired' | 'tasks.vCwdRequired'
  | 'tasks.vCronInvalid' | 'tasks.vIntervalPositive' | 'tasks.vOnceFuture'

export type TaskFormErrors = Partial<Record<'name' | 'prompt' | 'cwd' | 'schedule', TaskFormErrorKey>>

export function validateTaskForm(
  input: { name: string; prompt: string; cwd: string; schedule: Schedule },
  now: Date
): TaskFormErrors {
  const errors: TaskFormErrors = {}
  if (!input.name.trim()) errors.name = 'tasks.vNameRequired'
  if (!input.prompt.trim()) errors.prompt = 'tasks.vPromptRequired'
  if (!input.cwd.trim()) errors.cwd = 'tasks.vCwdRequired'
  const s = input.schedule
  if (s.type === 'cron' && !isValidCronExpr(s.expr)) errors.schedule = 'tasks.vCronInvalid'
  else if (s.type === 'interval' && !(s.minutes > 0)) errors.schedule = 'tasks.vIntervalPositive'
  else if (s.type === 'once' && new Date(s.at).getTime() <= now.getTime()) errors.schedule = 'tasks.vOnceFuture'
  return errors
}
