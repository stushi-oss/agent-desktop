import { BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import { homedir } from 'node:os'
import type { SessionManager } from './session/SessionManager'
import type { TaskService } from './tasks/TaskService'
import type { ShellChoice } from './shellSelect'
import type { AppSettings, RegistrySnapshot, SessionSummary, TaskInput } from '@shared/types'
import { INVOKE_CHANNELS, PUSH_CHANNELS } from '@shared/channels'
import { AppSettingsPatchSchema } from '@shared/schemas'
import { CwdSchema, TranscriptRequestSchema, assertRealDir, pathWithinParents } from '@shared/security'
import { toTranscriptItems } from './tasks/streamJson'

export interface IpcDeps {
  getWindow: () => BrowserWindow | null
  sessions: SessionManager
  tasks: TaskService
  shellFor: (cwd: string) => ShellChoice
  /** 扩展扫描：主进程实时扫描 ~/.claude + project */
  scanRegistry: () => RegistrySnapshot
  /** 会话创建后回调（index.ts 用它更新扩展扫描的 project 目录 + 当前活跃会话 id） */
  onSessionCreated?: (cwd: string, sessionId: string) => void
  /** 应用设置（load/save 由 index.ts 装配） */
  settings: {
    get(): AppSettings
    set(patch: Partial<AppSettings>): AppSettings
  }
  /** claude 可执行文件探测结果（启动时一次） */
  claudeStatus: { found: boolean; candidates: string[] }
}

function push(win: BrowserWindow | null, channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

// 修复 #6：bootstrap session 由 renderer hydrate() 后通过 app:sessionsReady 触发。
// 之前 main 启动立即 create + spawn pty，renderer 无 listener 时 IPC 不重放 → 丢 banner/prompt。
// 第二次调用返回 false（幂等），防止 hydrate 重入或 reload 重复创建。
let bootstrapDone = false

/** 重置 bootstrapDone — 仅供测试用 */
export function _resetBootstrapForTests(): void {
  bootstrapDone = false
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
      push(win, PUSH_CHANNELS.appShortcut, { key })
    }
  })
}

/** 注册 sessions + app + tasks + registry + settings 相关 IPC */
export function registerIpc(deps: IpcDeps): void {
  const { sessions, tasks } = deps

  ipcMain.handle(INVOKE_CHANNELS.sessions.create, (_e, rawCwd: unknown, launchClaude?: boolean): SessionSummary => {
    // 修复 #2：renderer-supplied cwd + login shell = rc 文件 RCE
    // 三重校验：zod 类型 → 真实目录（非 symlink）→ 在 homedir 下
    const cwd = CwdSchema.parse(rawCwd)
    assertRealDir(cwd)
    pathWithinParents(cwd, [homedir()])
    const summary = sessions.create(cwd, 80, 24, deps.shellFor(cwd), launchClaude ?? false)
    deps.onSessionCreated?.(cwd, summary.id)
    push(deps.getWindow(), PUSH_CHANNELS.sessionsChanged, undefined)
    return summary
  })
  ipcMain.handle(INVOKE_CHANNELS.sessions.write, (_e, id: string, data: string) => sessions.write(id, data))
  ipcMain.handle(INVOKE_CHANNELS.sessions.resize, (_e, id: string, cols: number, rows: number) =>
    sessions.resize(id, cols, rows)
  )
  ipcMain.handle(INVOKE_CHANNELS.sessions.kill, (_e, id: string) => {
    sessions.kill(id)
    push(deps.getWindow(), PUSH_CHANNELS.sessionsChanged, undefined)
  })
  ipcMain.handle(INVOKE_CHANNELS.sessions.list, () => sessions.list())
  ipcMain.handle(INVOKE_CHANNELS.sessions.rename, (_e, id: string, title: string): boolean =>
    sessions.rename(id, title)
  )

  ipcMain.handle(INVOKE_CHANNELS.app.pickDirectory, async () => {
    const win = deps.getWindow()
    if (!win || win.isDestroyed()) return null
    const r = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory']
    })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })

  // ---------- 扩展 ----------
  ipcMain.handle(INVOKE_CHANNELS.registry.scan, () => deps.scanRegistry())

  // ---------- 设置 ----------
  ipcMain.handle(INVOKE_CHANNELS.app.getSettings, () => deps.settings.get())
  ipcMain.handle(INVOKE_CHANNELS.app.setSettings, (_e, patch: unknown): AppSettings => {
    // zod 严格校验：拒绝非法 theme / locale 长度 / 未知 key
    // 抛 ZodError → IPC promise reject → renderer console.error
    const parsed = AppSettingsPatchSchema.parse(patch)
    const next = deps.settings.set(parsed)
    if (parsed.theme) nativeTheme.themeSource = parsed.theme
    push(deps.getWindow(), PUSH_CHANNELS.appSettingsChanged, next)
    return next
  })
  ipcMain.handle(INVOKE_CHANNELS.app.getClaudeStatus, () => deps.claudeStatus)

  // 修复 #6：bootstrap handshake —— renderer hydrate() 后调一次，main 才创建 home session
  ipcMain.handle(INVOKE_CHANNELS.app.sessionsReady, (): boolean => {
    if (bootstrapDone) return false
    bootstrapDone = true
    const initialCwd = homedir()
    const initial = sessions.create(initialCwd, 80, 24, deps.shellFor(initialCwd), false)
    deps.onSessionCreated?.(initialCwd, initial.id)
    push(deps.getWindow(), PUSH_CHANNELS.sessionsChanged, undefined)
    push(deps.getWindow(), PUSH_CHANNELS.sessionCreated, initial)
    return true
  })

  // ---------- 定时任务 ----------
  ipcMain.handle(INVOKE_CHANNELS.tasks.list, () => tasks.tasks)
  ipcMain.handle(INVOKE_CHANNELS.tasks.history, (_e, taskId?: string) => tasks.historyOf(taskId))
  ipcMain.handle(INVOKE_CHANNELS.tasks.create, (_e, input: TaskInput) => tasks.create(input))
  ipcMain.handle(INVOKE_CHANNELS.tasks.update, (_e, id: string, patch: Parameters<TaskService['update']>[1]) =>
    tasks.update(id, patch)
  )
  ipcMain.handle(INVOKE_CHANNELS.tasks.remove, (_e, id: string) => tasks.remove(id))
  ipcMain.handle(INVOKE_CHANNELS.tasks.setEnabled, (_e, id: string, enabled: boolean) => tasks.setEnabled(id, enabled))
  ipcMain.handle(INVOKE_CHANNELS.tasks.runNow, (_e, id: string) => tasks.runNow(id))
  ipcMain.handle(INVOKE_CHANNELS.tasks.transcript, (_e, rawReq: unknown) => {
    // 修复 #1：renderer-supplied transcriptPath → 任意本地文件读
    // 改成 { taskId, runId }，main 端用 runsDir + id 拼路径，renderer 不可选文件
    const req = TranscriptRequestSchema.parse(rawReq)
    return toTranscriptItems(tasks.readTranscriptByRunId(req.taskId, req.runId))
  })

  // 广播转发：类级监听器，注册一次覆盖所有会话
  sessions.onData((ev) => push(deps.getWindow(), PUSH_CHANNELS.sessionData, ev))
  sessions.onExit((ev) => push(deps.getWindow(), PUSH_CHANNELS.sessionExit, ev))
}
