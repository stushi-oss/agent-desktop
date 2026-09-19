import { app, Menu, nativeImage, Tray, BrowserWindow } from 'electron'

// 占位 16x16 图标（打包时可替换为 assets 图标）
const TRAY_ICON_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

export type TrayWithMenu = Tray & { rebuild(closeToTray: boolean): void }

export function createTray(win: BrowserWindow): TrayWithMenu {
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_B64}`)
  const tray = new Tray(icon)
  tray.setToolTip('AgentDesk')
  const t = tray as TrayWithMenu
  t.rebuild = (closeToTray: boolean): void => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示 AgentDesk', click: () => { win.show(); win.focus() } },
        { type: 'separator' },
        { label: closeToTray ? '退出（不保留定时任务）' : '退出', click: () => { app.quit() } }
      ])
    )
  }
  t.rebuild(false)
  tray.on('click', () => {
    if (win.isVisible()) win.hide()
    else { win.show(); win.focus() }
  })
  return t
}
