import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { probeUserEnv, mergedEnv, resolveClaudePath } from './env'
import { defaultShellFor, resolveWindowsShell, type ShellChoice } from './shellSelect'
import { nodePtyFactory } from './ptyFactory'
import { SessionManager } from './session/SessionManager'
import { registerIpc } from './ipc'

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

  registerIpc({
    getWindow: () => mainWindow,
    sessions,
    shellFor: () => shell
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
