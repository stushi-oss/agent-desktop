// src/shared/schemas.ts
import { z } from 'zod'

export const ThemeSchema = z.enum(['system', 'light', 'dark'])
export const LocaleSchema = z.enum(['system', 'zh-CN', 'en'])

export const AppSettingsSchema = z.object({
  theme: ThemeSchema,
  locale: LocaleSchema,
  closeToTray: z.boolean()
}).strict()

export type AppSettings = z.infer<typeof AppSettingsSchema>

/** Partial patch schema (setSettings handler 接收) */
export const AppSettingsPatchSchema = AppSettingsSchema.partial().strict()

// ---------- 定时任务 (#17) ----------
// 边界说明：这里只做「形状」校验；cron 表达式合法性、interval 正数、once 必须是
// 未来时间等「业务规则」仍由 TaskService.validateInput 负责，两处各司其职。

const ScheduleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('interval'), minutes: z.number().int() }),
  z.object({ type: z.literal('cron'), expr: z.string().min(1) }),
  z.object({ type: z.literal('once'), at: z.string().min(1) })
])

export const TaskInputSchema = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1),
  cwd: z.string().min(1),
  schedule: ScheduleSchema,
  permissionMode: z.enum(['default', 'acceptEdits', 'bypassPermissions']),
  model: z.string().optional(),
  timeoutMinutes: z.number().int().positive().optional(),
  notify: z.object({
    onComplete: z.boolean().optional(),
    onFailure: z.boolean().optional()
  }).optional()
}).strict()

/** update patch：TaskInput partial + enabled 开关（对齐 TaskService.update 第二参） */
export const TaskPatchSchema = TaskInputSchema.partial().extend({
  enabled: z.boolean().optional()
}).strict()
