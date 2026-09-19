import { BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import type { SessionManager } from './session/SessionManager'
import type { TaskService } from './tasks/TaskService'
import type { ShellChoice } from './shellSelect'
import type { AppSettings, RegistrySnapshot, RunRecord, SessionSummary, TaskInput } from '@shared/types'
import { toTranscriptItems } from './tasks/streamJson'

export interface IpcDeps {
  getWindow: () => BrowserWindow | null
  sessions: SessionManager
  tasks: TaskService
  shellFor: (cwd: string) => ShellChoice
  /** 扩展扫描：主进程实时扫描 ~/.claude + project */
  scanRegistry: () => RegistrySnapshot
  /** 会话创建后回调（index.ts 用它更新扩展扫描的 project 目录） */
  onSessionCreated?: (cwd: string) => void
  /** 应用设置（load/save 由 index.ts 装配） */
  settings: {
    get(): AppSettings
    set(patch: Partial<AppSettings>): AppSettings
  }
  /** claude 可执行文件探测结果（启动时一次） */
  claudeStatus: { found: boolean; candidates: string[] }
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

// 应用级快捷键：⌘/Ctrl+T 新会话、⌘/Ctrl+W 关会话、⌘/Ctrl+1-9 切换
// before-input-event 拦截，避免 macOS 默认菜单把 ⌘W 变成关窗口。
// 独立导出：窗口重建（macOS activate）后由 createWindow 重新挂载。
const SHORTCUT_KEYS = new Set(['t', 'w', '1', '2', '3', '4', '5', '6', '7', '8', '9'])

export function hookAppShortcuts(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.webContents.removeAllListeners('before-input-event')
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (!(input.meta || input.control) || input.alt || input.shift) return
    const key = input.key.toLowerCase()
    if (SHORTCUT_KEYS.has(key)) {
      event.preventDefault()
      push(win, 'app:shortcut', { key })
    }
  })
}

/** 注册 sessions + app + tasks + registry + settings 相关 IPC */
export function registerIpc(deps: IpcDeps): void {
  const { sessions, tasks } = deps

  ipcMain.handle('sessions:create', (_e, cwd: string, launchClaude?: boolean): SessionSummary => {
    const summary = sessions.create(cwd, 80, 24, deps.shellFor(cwd), launchClaude ?? false)
    deps.onSessionCreated?.(cwd)
    return summary
  })
  ipcMain.handle('sessions:write', (_e, id: string, data: string) => sessions.write(id, data))
  ipcMain.handle('sessions:resize', (_e, id: string, cols: number, rows: number) =>
    sessions.resize(id, cols, rows)
  )
  ipcMain.handle('sessions:kill', (_e, id: string) => sessions.kill(id))
  ipcMain.handle('sessions:list', () => sessions.list())
  ipcMain.handle('sessions:rename', (_e, id: string, title: string): boolean =>
    sessions.rename(id, title)
  )

  ipcMain.handle('app:pickDirectory', async () => {
    const win = deps.getWindow()
    if (!win || win.isDestroyed()) return null
    const r = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory']
    })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })

  // ---------- 扩展 ----------
  ipcMain.handle('registry:scan', () => deps.scanRegistry())

  // ---------- 设置 ----------
  ipcMain.handle('app:getSettings', () => deps.settings.get())
  ipcMain.handle('app:setSettings', (_e, patch: Partial<AppSettings>) => {
    const next = deps.settings.set(patch)
    if (patch.theme) nativeTheme.themeSource = patch.theme
    push(deps.getWindow(), 'app:settingsChanged', next)
    return next
  })
  ipcMain.handle('app:getClaudeStatus', () => deps.claudeStatus)

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
