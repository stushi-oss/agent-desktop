import { app, Menu, nativeImage, Tray, BrowserWindow } from 'electron'

// 黑白 template 图标（与 build/icon.icns 同款提示符）：自动适配深/浅色菜单栏
const TRAY_ICON_B64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAEKADAAQAAAABAAAAEAAAAAAXnVPIAAAAuElEQVQ4Ea2SUQqEIBiEp2Upuppv9tgluln2FHgkb6A95DrGHxTEbrkDaYjz+fuPVUxCgV4F3mz9H2BZFkzTBM63xB5Qxhj2Iiqlovd+W/xhhOwJIWTzXcgOIIgns4I7kAPgDOn7Xgq8nItTOFTw5ApviYzxdV2HeZ6R+oBxHNE0DZxzsNZiXde8tW1baK1R1/VmlctdxTgMQ24qGytfei9iixX/iGIFcvpOT+vfKtgBhDxRcQrFgA+bm3tnUG1H6gAAAABJRU5ErkJggg=='
const TRAY_ICON_2X_B64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACPTkDJAAABQElEQVRYCe2VXQ5EMBDHp5s9hIgH4R7iJpwGxxCJe7iIJx9xBU+2Qypd2w/JbmsfTFKtSZnf/NtpyUINLrTHhbHX0DfArcB/KjBNE6RpurZxHM0WCp4DR0uSBM+GtYVhuHRdd5zys3ftErRtC3EcQ9/3ZpQQpTIMw4KZMxWwN6UEiADQh7LbgJAC2IJQAtiA0AKoIHCvfGunAGQQWK7fmrYMzdQe99czGcgqwsoSyIL/6nRU7gHTwVF9KYCN4AhAVgpuT+AQb8AoigDvAWb0VISmacDzPOba+6qqoK5rmOd59/ED3/ehKApwHId3b2MEOBp/G9JZynuAQi6EkLd7A785NlnJastQlfmWwrknhRROfIq8KBezLMvAdV32+tEHQQBlWWqXIM/zj2/RIdwDwpmGnNolMBR3/+0NcCtwuQIvCchtTB4cJV4AAAAASUVORK5CYII='

export type TrayWithMenu = Tray & { rebuild(closeToTray: boolean): void }

export function createTray(win: BrowserWindow): TrayWithMenu {
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_B64}`)
  icon.addRepresentation({ scaleFactor: 2, dataURL: `data:image/png;base64,${TRAY_ICON_2X_B64}` })
  icon.setTemplateImage(true)
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
