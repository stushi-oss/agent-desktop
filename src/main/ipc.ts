import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { SessionManager } from './session/SessionManager'
import type { TaskService } from './tasks/TaskService'
import type { ShellChoice } from './shellSelect'
import type { RunRecord, SessionSummary, TaskInput } from '@shared/types'
import { toTranscriptItems } from './tasks/streamJson'

export interface IpcDeps {
  getWindow: () => BrowserWindow | null
  sessions: SessionManager
  tasks: TaskService
  shellFor: (cwd: string) => ShellChoice
}

/** 渲染进程 ← 主进程推送（preload 里包装成 onXxx 订阅） */
export const CHANNELS = {
  sessionData: 'session:data',
  sessionExit: 'session:exit',
  tasksChanged: 'tasks:changed'
} as const

function push(win: BrowserWindow | null, channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

/** 注册 sessions + app + tasks 相关 IPC（registry/settings 由后续任务追加） */
export function registerIpc(deps: IpcDeps): void {
  const { sessions, tasks } = deps

  ipcMain.handle('sessions:create', (_e, cwd: string): SessionSummary =>
    sessions.create(cwd, 80, 24, deps.shellFor(cwd))
  )
  ipcMain.handle('sessions:write', (_e, id: string, data: string) => sessions.write(id, data))
  ipcMain.handle('sessions:resize', (_e, id: string, cols: number, rows: number) =>
    sessions.resize(id, cols, rows)
  )
  ipcMain.handle('sessions:kill', (_e, id: string) => sessions.kill(id))
  ipcMain.handle('sessions:list', () => sessions.list())

  ipcMain.handle('app:pickDirectory', async () => {
    const win = deps.getWindow()
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory']
    })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })

  // ---------- 定时任务 ----------
  ipcMain.handle('tasks:list', () => tasks.tasks)
  ipcMain.handle('tasks:history', (_e, taskId?: string) => tasks.historyOf(taskId))
  ipcMain.handle('tasks:create', (_e, input: TaskInput) => tasks.create(input))
  ipcMain.handle('tasks:update', (_e, id: string, patch: Parameters<TaskService['update']>[1]) =>
    tasks.update(id, patch)
  )
  ipcMain.handle('tasks:remove', (_e, id: string) => tasks.remove(id))
  ipcMain.handle('tasks:setEnabled', (_e, id: string, enabled: boolean) => tasks.setEnabled(id, enabled))
  ipcMain.handle('tasks:runNow', (_e, id: string) => tasks.runNow(id))
  ipcMain.handle('tasks:transcript', (_e, rec: RunRecord) => toTranscriptItems(tasks.readTranscript(rec)))

  // 广播转发：类级监听器，注册一次覆盖所有会话
  sessions.onData((ev) => push(deps.getWindow(), CHANNELS.sessionData, ev))
  sessions.onExit((ev) => push(deps.getWindow(), CHANNELS.sessionExit, ev))
}
