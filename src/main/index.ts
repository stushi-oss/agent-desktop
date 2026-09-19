import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, mkdirSync } from 'node:fs'
import { probeUserEnv, mergedEnv, resolveClaudePath } from './env'
import { defaultShellFor, resolveWindowsShell, type ShellChoice } from './shellSelect'
import { nodePtyFactory } from './ptyFactory'
import { SessionManager } from './session/SessionManager'
import { TaskService } from './tasks/TaskService'
import { scanRegistry, createNodeScannerFs } from './registry/RegistryScanner'
import { registerIpc, hookAppShortcuts } from './ipc'
import { installAppMenu } from './menu'
import { initNotifications, showNotification, setDockBadge } from './notifications'
import { notifyTexts } from './notifyText'

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

  initNotifications()

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
      setDockBadge(history.filter((r) => r.status === 'running').length)
    },
    notify: (rec, task) => {
      const texts = notifyTexts(app.getLocale())
      const failed = rec.status === 'failed'
      if (failed && !task.notify.onFailure) return
      if (!failed && rec.status !== 'success') return
      if (!failed && !task.notify.onComplete) return
      showNotification(failed ? texts.failed(task.name) : texts.done(task.name), texts.detail, () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          createWindow() // 点击通知时窗口已关：重建并打开任务抽屉
        } else {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show()
          mainWindow.focus()
        }
        // send 需要在窗口就绪后发；重建路径下 did-finish-load 后再发
        const w = mainWindow
        if (w && !w.isDestroyed()) {
          const send = (): void => { if (!w.isDestroyed()) w.webContents.send('app:openTasks') }
          if (w.webContents.isLoadingMainFrame()) w.webContents.once('did-finish-load', send)
          else send()
        }
      })
    }
  })
  taskService.load()
  const schedulerTimer = setInterval(() => taskService.tick(), 30_000)
  schedulerTimer.unref()

  // 自定义应用菜单须在建窗前装好：macOS 默认菜单的 File>Close 会抢占 ⌘W
  installAppMenu()

  // 先建窗口再注册 IPC：registerIpc 里的快捷键转发依赖 getWindow() 非 null
  createWindow()

  // 扩展扫描的 project 目录取当前活跃会话 cwd（无会话时 home）
  let activeCwd = homedir()

  registerIpc({
    getWindow: () => mainWindow,
    sessions,
    tasks: taskService,
    shellFor: () => shell,
    scanRegistry: () => scanRegistry(createNodeScannerFs(), homedir(), activeCwd),
    onSessionCreated: (cwd: string) => {
      activeCwd = cwd
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
