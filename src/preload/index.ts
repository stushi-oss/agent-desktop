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

const api = {
  sessions: {
    create: (cwd: string): Promise<SessionSummary> => ipcRenderer.invoke('sessions:create', cwd),
    write: (id: string, data: string): Promise<void> =>
      ipcRenderer.invoke('sessions:write', id, data),
    resize: (id: string, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke('sessions:resize', id, cols, rows),
    kill: (id: string): Promise<void> => ipcRenderer.invoke('sessions:kill', id),
    list: (): Promise<SessionSummary[]> => ipcRenderer.invoke('sessions:list')
  },
  onSessionData: (cb: (ev: { id: string; data: string }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, ev: { id: string; data: string }) => cb(ev)
    ipcRenderer.on('session:data', listener)
    return () => ipcRenderer.removeListener('session:data', listener)
  },
  onSessionExit: (cb: (ev: { id: string; code: number | undefined }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, ev: { id: string; code: number | undefined }) => cb(ev)
    ipcRenderer.on('session:exit', listener)
    return () => ipcRenderer.removeListener('session:exit', listener)
  },
  app: {
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('app:pickDirectory'),
    platform: process.platform,
    getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('app:getSettings'),
    setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke('app:setSettings', patch),
    getClaudeStatus: (): Promise<{ found: boolean; candidates: string[] }> =>
      ipcRenderer.invoke('app:getClaudeStatus')
  },
  registry: {
    scan: (): Promise<RegistrySnapshot> => ipcRenderer.invoke('registry:scan')
  },
  tasks: {
    list: (): Promise<ScheduledTask[]> => ipcRenderer.invoke('tasks:list'),
    history: (taskId?: string): Promise<RunRecord[]> => ipcRenderer.invoke('tasks:history', taskId),
    create: (input: TaskInput): Promise<ScheduledTask> => ipcRenderer.invoke('tasks:create', input),
    update: (id: string, patch: Partial<TaskInput> & { enabled?: boolean }): Promise<ScheduledTask | undefined> =>
      ipcRenderer.invoke('tasks:update', id, patch),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke('tasks:remove', id),
    setEnabled: (id: string, enabled: boolean): Promise<void> => ipcRenderer.invoke('tasks:setEnabled', id, enabled),
    runNow: (id: string): Promise<void> => ipcRenderer.invoke('tasks:runNow', id),
    transcript: (rec: RunRecord): Promise<TranscriptItem[]> => ipcRenderer.invoke('tasks:transcript', rec)
  },
  onTasksChanged: (cb: (payload: { tasks: ScheduledTask[]; history: RunRecord[] }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: { tasks: ScheduledTask[]; history: RunRecord[] }) => cb(payload)
    ipcRenderer.on('tasks:changed', listener)
    return () => ipcRenderer.removeListener('tasks:changed', listener)
  },
  onShortcut: (cb: (s: { key: string }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, s: { key: string }) => cb(s)
    ipcRenderer.on('app:shortcut', listener)
    return () => ipcRenderer.removeListener('app:shortcut', listener)
  },
  onSettingsChanged: (cb: (s: AppSettings) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, s: AppSettings) => cb(s)
    ipcRenderer.on('app:settingsChanged', listener)
    return () => ipcRenderer.removeListener('app:settingsChanged', listener)
  },
  onOpenTasks: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('app:openTasks', listener)
    return () => ipcRenderer.removeListener('app:openTasks', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
export type AgentDeskApi = typeof api
