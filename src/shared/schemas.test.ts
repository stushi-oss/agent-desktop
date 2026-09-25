import { describe, it, expect } from 'vitest'
import { AppSettingsSchema, AppSettingsPatchSchema, TaskInputSchema, TaskPatchSchema } from './schemas'

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

const validInput = {
  name: 'demo', prompt: 'hi', cwd: '/tmp',
  schedule: { type: 'interval', minutes: 5 },
  permissionMode: 'default'
}

describe('TaskInputSchema (#17)', () => {
  it('合法 input（interval）通过', () => {
    expect(() => TaskInputSchema.parse(validInput)).not.toThrow()
  })
  it('cron / once 变体通过', () => {
    expect(() => TaskInputSchema.parse({ ...validInput, schedule: { type: 'cron', expr: '0 9 * * *' } })).not.toThrow()
    expect(() => TaskInputSchema.parse({ ...validInput, schedule: { type: 'once', at: '2026-10-01T00:00:00Z' } })).not.toThrow()
  })
  it('非法 permissionMode 拒绝（枚举无 plan）', () => {
    expect(() => TaskInputSchema.parse({ ...validInput, permissionMode: 'plan' })).toThrow()
    expect(() => TaskInputSchema.parse({ ...validInput, permissionMode: 'bypassPermissions' })).not.toThrow()
  })
  it('未知 key 拒绝（strict）', () => {
    expect(() => TaskInputSchema.parse({ ...validInput, rogue: 1 })).toThrow()
  })
  it('schedule 非法变体拒绝', () => {
    expect(() => TaskInputSchema.parse({ ...validInput, schedule: { type: 'interval', minutes: 'x' } })).toThrow()
    expect(() => TaskInputSchema.parse({ ...validInput, schedule: { type: 'nope' } })).toThrow()
  })
  it('可选字段（model/timeoutMinutes/notify）通过', () => {
    expect(() => TaskInputSchema.parse({
      ...validInput,
      model: 'claude-sonnet-4-5',
      timeoutMinutes: 30,
      notify: { onComplete: true, onFailure: false }
    })).not.toThrow()
  })
  it('TaskPatchSchema 允许 partial + enabled', () => {
    expect(() => TaskPatchSchema.parse({ name: 'renamed' })).not.toThrow()
    expect(() => TaskPatchSchema.parse({ enabled: true })).not.toThrow()
    expect(() => TaskPatchSchema.parse({ rogue: 1 })).toThrow()
  })
})
