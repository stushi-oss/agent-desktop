import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AppSettings,
  RegistrySnapshot,
  RunRecord,
  ScheduledTask,
  SessionSummary,
  TaskInput,
  TranscriptItem
} from '@shared/types'
import { INVOKE_CHANNELS, PUSH_CHANNELS } from '@shared/channels'

const api = {
  sessions: {
    create: (cwd: string, launchClaude?: boolean): Promise<SessionSummary> =>
      ipcRenderer.invoke(INVOKE_CHANNELS.sessions.create, cwd, launchClaude),
    write: (id: string, data: string): Promise<void> =>
      ipcRenderer.invoke(INVOKE_CHANNELS.sessions.write, id, data),
    resize: (id: string, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke(INVOKE_CHANNELS.sessions.resize, id, cols, rows),
    kill: (id: string): Promise<void> => ipcRenderer.invoke(INVOKE_CHANNELS.sessions.kill, id),
    list: (): Promise<SessionSummary[]> => ipcRenderer.invoke(INVOKE_CHANNELS.sessions.list),
    rename: (id: string, title: string): Promise<boolean> =>
      ipcRenderer.invoke(INVOKE_CHANNELS.sessions.rename, id, title)
  },
  onSessionData: (cb: (ev: { id: string; data: string }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, ev: { id: string; data: string }) => cb(ev)
    ipcRenderer.on(PUSH_CHANNELS.sessionData, listener)
    return () => ipcRenderer.removeListener(PUSH_CHANNELS.sessionData, listener)
  },
  onSessionExit: (cb: (ev: { id: string; code: number | undefined }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, ev: { id: string; code: number | undefined }) => cb(ev)
    ipcRenderer.on(PUSH_CHANNELS.sessionExit, listener)
    return () => ipcRenderer.removeListener(PUSH_CHANNELS.sessionExit, listener)
  },
  onSessionsChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(PUSH_CHANNELS.sessionsChanged, listener)
    return () => ipcRenderer.removeListener(PUSH_CHANNELS.sessionsChanged, listener)
  },
  app: {
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke(INVOKE_CHANNELS.app.pickDirectory),
    platform: process.platform,
    getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(INVOKE_CHANNELS.app.getSettings),
    setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke(INVOKE_CHANNELS.app.setSettings, patch),
    getClaudeStatus: (): Promise<{ found: boolean; candidates: string[] }> =>
      ipcRenderer.invoke(INVOKE_CHANNELS.app.getClaudeStatus)
  },
  registry: {
    scan: (): Promise<RegistrySnapshot> => ipcRenderer.invoke(INVOKE_CHANNELS.registry.scan)
  },
  tasks: {
    list: (): Promise<ScheduledTask[]> => ipcRenderer.invoke(INVOKE_CHANNELS.tasks.list),
    history: (taskId?: string): Promise<RunRecord[]> => ipcRenderer.invoke(INVOKE_CHANNELS.tasks.history, taskId),
    create: (input: TaskInput): Promise<ScheduledTask> => ipcRenderer.invoke(INVOKE_CHANNELS.tasks.create, input),
    update: (id: string, patch: Partial<TaskInput> & { enabled?: boolean }): Promise<ScheduledTask | undefined> =>
      ipcRenderer.invoke(INVOKE_CHANNELS.tasks.update, id, patch),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke(INVOKE_CHANNELS.tasks.remove, id),
    setEnabled: (id: string, enabled: boolean): Promise<void> => ipcRenderer.invoke(INVOKE_CHANNELS.tasks.setEnabled, id, enabled),
    runNow: (id: string): Promise<void> => ipcRenderer.invoke(INVOKE_CHANNELS.tasks.runNow, id),
    transcript: (rec: RunRecord): Promise<TranscriptItem[]> => ipcRenderer.invoke(INVOKE_CHANNELS.tasks.transcript, rec)
  },
  onTasksChanged: (cb: (payload: { tasks: ScheduledTask[]; history: RunRecord[] }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: { tasks: ScheduledTask[]; history: RunRecord[] }) => cb(payload)
    ipcRenderer.on(PUSH_CHANNELS.tasksChanged, listener)
    return () => ipcRenderer.removeListener(PUSH_CHANNELS.tasksChanged, listener)
  },
  onShortcut: (cb: (s: { key: string }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, s: { key: string }) => cb(s)
    ipcRenderer.on(PUSH_CHANNELS.appShortcut, listener)
    return () => ipcRenderer.removeListener(PUSH_CHANNELS.appShortcut, listener)
  },
  onSettingsChanged: (cb: (s: AppSettings) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, s: AppSettings) => cb(s)
    ipcRenderer.on(PUSH_CHANNELS.appSettingsChanged, listener)
    return () => ipcRenderer.removeListener(PUSH_CHANNELS.appSettingsChanged, listener)
  },
  onOpenTasks: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(PUSH_CHANNELS.appOpenTasks, listener)
    return () => ipcRenderer.removeListener(PUSH_CHANNELS.appOpenTasks, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
export type AgentDeskApi = typeof api
