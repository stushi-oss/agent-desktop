import { existsSync, readFileSync } from 'node:fs'
import { writeAtomic } from './fileStore'
import type { AppSettings } from '@shared/types'

export const SETTINGS_DEFAULT: AppSettings = { theme: 'system', locale: 'system', closeToTray: false }

export function loadSettings(path: string): AppSettings {
  try {
    if (!existsSync(path)) return { ...SETTINGS_DEFAULT }
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<AppSettings>
    return {
      theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'system',
      locale: raw.locale === 'zh-CN' || raw.locale === 'en' ? raw.locale : 'system',
      closeToTray: raw.closeToTray === true
    }
  } catch {
    return { ...SETTINGS_DEFAULT }
  }
}

export function saveSettings(path: string, patch: Partial<AppSettings>): void {
  const merged = { ...loadSettings(path), ...patch }
  writeAtomic(path, merged)
}

/** 'system' 时跟随应用 locale（近似系统语言） */
export function resolveLocale(pref: AppSettings['locale'], appLocale: string): 'zh-CN' | 'en' {
  if (pref === 'zh-CN' || pref === 'en') return pref
  return appLocale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}
