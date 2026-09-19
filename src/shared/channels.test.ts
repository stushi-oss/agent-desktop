import { describe, it, expect } from 'vitest'
import { INVOKE_CHANNELS, PUSH_CHANNELS } from './channels'

describe('@shared/channels', () => {
  it('INVOKE_CHANNELS 字符串稳定（renderer 跨版本依赖）', () => {
    expect(INVOKE_CHANNELS.sessions.create).toBe('sessions:create')
    expect(INVOKE_CHANNELS.sessions.write).toBe('sessions:write')
    expect(INVOKE_CHANNELS.sessions.resize).toBe('sessions:resize')
    expect(INVOKE_CHANNELS.sessions.kill).toBe('sessions:kill')
    expect(INVOKE_CHANNELS.sessions.list).toBe('sessions:list')
    expect(INVOKE_CHANNELS.sessions.rename).toBe('sessions:rename')
    expect(INVOKE_CHANNELS.app.pickDirectory).toBe('app:pickDirectory')
    expect(INVOKE_CHANNELS.app.getSettings).toBe('app:getSettings')
    expect(INVOKE_CHANNELS.app.setSettings).toBe('app:setSettings')
    expect(INVOKE_CHANNELS.app.getClaudeStatus).toBe('app:getClaudeStatus')
    expect(INVOKE_CHANNELS.registry.scan).toBe('registry:scan')
    expect(INVOKE_CHANNELS.tasks.list).toBe('tasks:list')
    expect(INVOKE_CHANNELS.tasks.history).toBe('tasks:history')
    expect(INVOKE_CHANNELS.tasks.create).toBe('tasks:create')
    expect(INVOKE_CHANNELS.tasks.update).toBe('tasks:update')
    expect(INVOKE_CHANNELS.tasks.remove).toBe('tasks:remove')
    expect(INVOKE_CHANNELS.tasks.setEnabled).toBe('tasks:setEnabled')
    expect(INVOKE_CHANNELS.tasks.runNow).toBe('tasks:runNow')
    expect(INVOKE_CHANNELS.tasks.transcript).toBe('tasks:transcript')
  })

  it('PUSH_CHANNELS 字符串稳定', () => {
    expect(PUSH_CHANNELS.sessionData).toBe('session:data')
    expect(PUSH_CHANNELS.sessionExit).toBe('session:exit')
    expect(PUSH_CHANNELS.tasksChanged).toBe('tasks:changed')
    expect(PUSH_CHANNELS.appShortcut).toBe('app:shortcut')
    expect(PUSH_CHANNELS.appSettingsChanged).toBe('app:settingsChanged')
    expect(PUSH_CHANNELS.appOpenTasks).toBe('app:openTasks')
    expect(PUSH_CHANNELS.sessionsChanged).toBe('sessions:changed')
  })
})
