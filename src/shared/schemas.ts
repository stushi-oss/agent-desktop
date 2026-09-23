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
