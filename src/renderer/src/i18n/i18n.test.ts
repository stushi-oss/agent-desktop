import { describe, it, expect } from 'vitest'
import { zhCN } from './zh-CN'
import { en } from './en'

function keysOf(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keysOf(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]
  )
}

function valueAt(obj: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((o, seg) => (o as Record<string, unknown>)![seg], obj)
}

function placeholders(value: unknown): Set<string> {
  return new Set([...String(value ?? '').matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))
}

describe('i18n resources', () => {
  it('zh-CN 与 en 的 key 集合完全一致', () => {
    expect(new Set(keysOf(en))).toEqual(new Set(keysOf(zhCN)))
  })
  it('zh-CN 与 en 的插值占位符完全一致', () => {
    for (const k of keysOf(zhCN)) {
      expect(placeholders(valueAt(zhCN, k)), `key ${k}`).toEqual(placeholders(valueAt(en, k)))
    }
  })
  it('zh-CN 与 en 均无空字符串值', () => {
    for (const [name, dict] of [['zh-CN', zhCN], ['en', en]] as const) {
      for (const k of keysOf(dict)) {
        expect(String(valueAt(dict, k) ?? '').length, `${name} key ${k}`).toBeGreaterThan(0)
      }
    }
  })
})
