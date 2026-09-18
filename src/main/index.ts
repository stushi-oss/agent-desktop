import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { probeUserEnv, mergedEnv, resolveClaudePath } from './env'
import { defaultShellFor, resolveWindowsShell, type ShellChoice } from './shellSelect'
import { nodePtyFactory } from './ptyFactory'
import { SessionManager } from './session/SessionManager'
import { TaskService } from './tasks/TaskService'
import { registerIpc, hookAppShortcuts } from './ipc'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#161b22',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  // 窗口（重）建后重挂应用快捷键（macOS activate 重建窗口场景）
  mainWindow.webContents.once('did-finish-load', () => hookAppShortcuts(mainWindow!))
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  const probed = await probeUserEnv(process.platform, process.env.SHELL)
  const env = mergedEnv(process.env, probed)
  const claudePath = resolveClaudePath(env, process.platform)

  const shell: ShellChoice =
    process.platform === 'win32'
      ? resolveWindowsShell(env, existsSync)
      : defaultShellFor(process.platform, env)

  const sessions = new SessionManager(nodePtyFactory, {
    env,
    launchClaude: claudePath !== null
  })

  // userData 下的持久化目录
  const storeDir = join(app.getPath('userData'), 'store')
  const runsDir = join(app.getPath('userData'), 'runs')
  mkdirSync(storeDir, { recursive: true })
  mkdirSync(runsDir, { recursive: true })

  const taskService = new TaskService({
    storeDir,
    runsDir,
    claudePath,
    env,
    log: (m) => console.log(m),
    onChanged: (tasks, history) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tasks:changed', { tasks, history })
      }
    }
    // notify 在 Task 15 接入系统通知
  })
  taskService.load()
  const schedulerTimer = setInterval(() => taskService.tick(), 30_000)
  schedulerTimer.unref()

  // 先建窗口再注册 IPC：registerIpc 里的快捷键转发依赖 getWindow() 非 null
  createWindow()

  registerIpc({
    getWindow: () => mainWindow,
    sessions,
    tasks: taskService,
    shellFor: () => shell
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
