import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSettings, saveSettings, resolveLocale, SETTINGS_DEFAULT } from './settings'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ad-settings-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('settings', () => {
  it('缺失 → 默认值', () => {
    expect(loadSettings(join(dir, 'settings.json'))).toEqual(SETTINGS_DEFAULT)
  })
  it('损坏 → 默认值 + 不抛错', () => {
    writeFileSync(join(dir, 'settings.json'), 'xx', 'utf8')
    expect(loadSettings(join(dir, 'settings.json'))).toEqual(SETTINGS_DEFAULT)
  })
  it('保存往返 + 部分字段合并', () => {
    const p = join(dir, 'settings.json')
    saveSettings(p, { theme: 'dark', locale: 'en', closeToTray: true })
    expect(loadSettings(p).theme).toBe('dark')
    saveSettings(p, { theme: 'light' })
    const s = loadSettings(p)
    expect(s.theme).toBe('light')
    expect(s.locale).toBe('en')
    expect(s.closeToTray).toBe(true)
  })
})

describe('saveSettings atomic', () => {
  let path: string
  beforeEach(() => {
    path = join(dir, 'settings.json')
  })

  it('保存后 load 回来内容一致', () => {
    saveSettings(path, { theme: 'dark', closeToTray: true })
    const loaded = loadSettings(path)
    expect(loaded.theme).toBe('dark')
    expect(loaded.closeToTray).toBe(true)
  })

  it('保存后无 .tmp 残留文件', () => {
    saveSettings(path, { theme: 'light' })
    const files = readdirSync(dir)
    expect(files.filter((f) => f.includes('.tmp-')).length).toBe(0)
  })

  it('部分 patch 与既有 field 合并', () => {
    saveSettings(path, { theme: 'dark' })
    saveSettings(path, { closeToTray: true })
    const loaded = loadSettings(path)
    expect(loaded.theme).toBe('dark')
    expect(loaded.closeToTray).toBe(true)
  })
})

describe('resolveLocale', () => {
  it('system + zh 环境 → zh-CN；system + 其他 → en', () => {
    expect(resolveLocale('system', 'zh_CN')).toBe('zh-CN')
    expect(resolveLocale('system', 'en_US')).toBe('en')
  })
  it('显式指定优先', () => {
    expect(resolveLocale('zh-CN', 'en_US')).toBe('zh-CN')
    expect(resolveLocale('en', 'zh_CN')).toBe('en')
  })
})