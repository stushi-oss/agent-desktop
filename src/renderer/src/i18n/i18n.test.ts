import { describe, it, expect } from 'vitest'
import { zhCN } from './zh-CN'
import { en } from './en'

function keysOf(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keysOf(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]
  )
}

describe('i18n resources', () => {
  it('zh-CN 与 en 的 key 集合完全一致', () => {
    expect(new Set(keysOf(en))).toEqual(new Set(keysOf(zhCN)))
  })
  it('zh-CN 无空字符串值', () => {
    for (const k of keysOf(zhCN)) {
      const val = k.split('.').reduce<unknown>((o, seg) => (o as Record<string, unknown>)![seg], zhCN)
      expect(String(val ?? '').length, `key ${k}`).toBeGreaterThan(0)
    }
  })
})
