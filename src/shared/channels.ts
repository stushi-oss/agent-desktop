// src/shared/channels.ts

/** 所有 IPC invoke channel（renderer → main） */
export const INVOKE_CHANNELS = {
  sessions: {
    create: 'sessions:create',
    write: 'sessions:write',
    resize: 'sessions:resize',
    kill: 'sessions:kill',
    list: 'sessions:list',
    rename: 'sessions:rename'
  },
  app: {
    pickDirectory: 'app:pickDirectory',
    getSettings: 'app:getSettings',
    setSettings: 'app:setSettings',
    getClaudeStatus: 'app:getClaudeStatus'
  },
  registry: { scan: 'registry:scan' },
  tasks: {
    list: 'tasks:list',
    history: 'tasks:history',
    create: 'tasks:create',
    update: 'tasks:update',
    remove: 'tasks:remove',
    setEnabled: 'tasks:setEnabled',
    runNow: 'tasks:runNow',
    transcript: 'tasks:transcript'
  }
} as const

/** 所有 IPC 推送 channel（main → renderer） */
export const PUSH_CHANNELS = {
  sessionData: 'session:data',
  sessionExit: 'session:exit',
  tasksChanged: 'tasks:changed',
  appShortcut: 'app:shortcut',
  appSettingsChanged: 'app:settingsChanged',
  appOpenTasks: 'app:openTasks',
  sessionsChanged: 'sessions:changed'
} as const
