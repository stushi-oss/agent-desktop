import { app, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, mkdirSync } from 'node:fs'
import { probeUserEnv, mergedEnv, resolveClaudePath, claudeCandidates } from './env'
import { loadSettings, saveSettings, resolveLocale, SETTINGS_DEFAULT } from './store/settings'
import { createTray, type TrayWithMenu } from './tray'
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
// close 守卫与托盘跟随每次 createWindow 生效，相关状态提升到模块作用域
let quitting = false
let settingsPath = ''
let settings = { ...SETTINGS_DEFAULT }
let tray: TrayWithMenu | null = null
let trayWin: BrowserWindow | null = null // 托盘当前绑定的窗口；窗口重建后需重绑

/** 托盘跟随设置与当前窗口：closeToTray 开→绑定最新窗口；关→销毁；每次刷新「退出」标签 */
function syncTray(): void {
  if (settings.closeToTray && mainWindow && trayWin !== mainWindow) {
    tray?.destroy()
    tray = createTray(mainWindow)
    trayWin = mainWindow
  }
  if (!settings.closeToTray && tray) {
    tray.destroy()
    tray = null
    trayWin = null
  }
  tray?.rebuild(settings.closeToTray)
}

function createWindow(): void {
  const win = (mainWindow = new BrowserWindow({
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
  }))
  // close 守卫须随窗口（重）建挂上：否则重建后的窗口一关即退出，定时任务随之中断
  win.on('close', (e) => {
    if (settings.closeToTray && !quitting) {
      e.preventDefault()
      win.hide()
    }
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  // 窗口（重）建后重挂应用快捷键（macOS activate 重建窗口场景）
  win.webContents.once('did-finish-load', () => hookAppShortcuts(win))
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  syncTray() // 窗口可能被重建：托盘重绑到新窗口
}

app.whenReady().then(async () => {
  // userData 下的持久化目录
  const storeDir = join(app.getPath('userData'), 'store')
  const runsDir = join(app.getPath('userData'), 'runs')
  mkdirSync(storeDir, { recursive: true })
  mkdirSync(runsDir, { recursive: true })

  // ---- 设置（最前：nativeTheme 影响首帧底色） ----
  settingsPath = join(storeDir, 'settings.json')
  settings = loadSettings(settingsPath)
  nativeTheme.themeSource = settings.theme

  const probed = await probeUserEnv(process.platform, process.env.SHELL)
  const env = mergedEnv(process.env, probed)
  const claudePath = resolveClaudePath(env, process.platform)

  const shell: ShellChoice =
    process.platform === 'win32'
      ? resolveWindowsShell(env, existsSync)
      : defaultShellFor(process.platform, env)

  const sessions = new SessionManager(nodePtyFactory, {
    env
  })

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
      const texts = notifyTexts(resolveLocale(settings.locale, app.getLocale()))
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

  // ---- 关闭行为 + 托盘（close 守卫在 createWindow 内挂；托盘由 createWindow 末尾的 syncTray 建立） ----
  app.on('before-quit', () => { quitting = true })

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
    },
    settings: {
      get: () => settings,
      set: (patch) => {
        settings = { ...settings, ...patch }
        saveSettings(settingsPath, patch)
        syncTray()
        return settings
      }
    },
    claudeStatus: { found: claudePath !== null, candidates: claudeCandidates(env, process.platform) }
  })

  // 首启自动开一个 homedir 的纯 shell terminal（不自动启动 claude）。
  // 不广播 session:created —— 渲染端 hydrate() 会通过 sessions.list() 拉到这个会话并激活第一个 tab，
  // 避免与 hydrate 抢跑造成重复渲染。
  {
    const initialCwd = homedir()
    sessions.create(initialCwd, 80, 24, shell, false)
    activeCwd = initialCwd
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    // closeToTray 隐藏的窗口：dock 图标点击应重新显示
    else if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
