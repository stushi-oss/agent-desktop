import { describe, it, expect } from 'vitest'
import { notifyTexts } from './notifyText'

describe('notifyTexts', () => {
  it('zh 系 locale 输出中文且含任务名', () => {
    const t = notifyTexts('zh-CN')
    expect(t.done('任务A')).toContain('任务A')
    expect(t.failed('任务A')).toContain('任务A')
    expect(t.detail.length).toBeGreaterThan(0)
  })
  it('其他 locale 输出英文且含名字、不含中文引号', () => {
    const t = notifyTexts('en-US')
    expect(t.done('X')).toContain('X')
    expect(t.done('X')).not.toContain('「')
  })
})
