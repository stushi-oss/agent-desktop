import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { SessionSummary } from '@shared/types'

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
    platform: process.platform
  }
}

contextBridge.exposeInMainWorld('api', api)
export type AgentDeskApi = typeof api
