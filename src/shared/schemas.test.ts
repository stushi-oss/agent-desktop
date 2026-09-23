import { describe, it, expect } from 'vitest'
import { AppSettingsSchema, AppSettingsPatchSchema } from './schemas'

describe('AppSettingsSchema', () => {
  it('完整合法 settings 通过', () => {
    expect(() => AppSettingsSchema.parse({
      theme: 'system', locale: 'zh-CN', closeToTray: false
    })).not.toThrow()
  })

  it('非法 theme 拒绝', () => {
    expect(() => AppSettingsSchema.parse({
      theme: 'red', locale: 'zh-CN', closeToTray: false
    })).toThrow()
  })

  it('locale 不在 enum 列表拒绝', () => {
    expect(() => AppSettingsSchema.parse({
      theme: 'system', locale: 'fr-FR', closeToTray: false
    })).toThrow()
  })

  it('schema 接受的 locale 与 loadSettings 一致', () => {
    // These should all parse
    expect(() => AppSettingsSchema.parse({ theme: 'system', locale: 'system', closeToTray: false })).not.toThrow()
    expect(() => AppSettingsSchema.parse({ theme: 'system', locale: 'zh-CN', closeToTray: false })).not.toThrow()
    expect(() => AppSettingsSchema.parse({ theme: 'system', locale: 'en', closeToTray: false })).not.toThrow()
    // These should all fail
    expect(() => AppSettingsSchema.parse({ theme: 'system', locale: 'fr-FR', closeToTray: false })).toThrow()
    expect(() => AppSettingsSchema.parse({ theme: 'system', locale: 'en-US', closeToTray: false })).toThrow()
  })

  it('strict: 未知 key 拒绝', () => {
    expect(() => AppSettingsSchema.parse({
      theme: 'system', locale: 'zh-CN', closeToTray: false, rogue: 1
    })).toThrow()
  })

  it('patch schema 允许 partial', () => {
    expect(() => AppSettingsPatchSchema.parse({ theme: 'light' })).not.toThrow()
  })

  it('patch schema 也严格拒绝未知 key', () => {
    expect(() => AppSettingsPatchSchema.parse({ theme: 'light', rogue: 1 })).toThrow()
  })
})
