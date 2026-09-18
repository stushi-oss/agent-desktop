import { describe, it, expect } from 'vitest'
import { validateTaskForm } from './taskForm'

const NOW = new Date('2026-01-15T10:00:00')
const base = {
  name: 'n', prompt: 'p', cwd: '/tmp',
  schedule: { type: 'interval', minutes: 5 } as const
}

describe('validateTaskForm（返回 i18n key）', () => {
  it('全部合法 → {}', () => expect(validateTaskForm(base, NOW)).toEqual({}))
  it('名称/指令/目录必填', () => {
    expect(validateTaskForm({ ...base, name: '  ' }, NOW).name).toBe('tasks.vNameRequired')
    expect(validateTaskForm({ ...base, prompt: '' }, NOW).prompt).toBe('tasks.vPromptRequired')
    expect(validateTaskForm({ ...base, cwd: '' }, NOW).cwd).toBe('tasks.vCwdRequired')
  })
  it('cron 非法', () => {
    expect(validateTaskForm({ ...base, schedule: { type: 'cron', expr: 'oops' } }, NOW).schedule).toBe('tasks.vCronInvalid')
  })
  it('interval 必须 > 0', () => {
    expect(validateTaskForm({ ...base, schedule: { type: 'interval', minutes: 0 } }, NOW).schedule).toBe('tasks.vIntervalPositive')
  })
  it('once 必须在未来', () => {
    expect(validateTaskForm({ ...base, schedule: { type: 'once', at: '2026-01-15T09:00:00' } }, NOW).schedule).toBe('tasks.vOnceFuture')
    expect(validateTaskForm({ ...base, schedule: { type: 'once', at: '2026-01-16T09:00:00' } }, NOW)).toEqual({})
  })
})
