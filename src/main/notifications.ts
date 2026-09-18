import { app, Notification } from 'electron'

export function initNotifications(): void {
  // Windows Toast 需要 AppUserModelID
  if (process.platform === 'win32') app.setAppUserModelId('com.agentdesk.app')
}

export function showNotification(title: string, body: string, onClick?: () => void): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body })
  if (onClick) n.on('click', onClick)
  n.show()
}

export function setDockBadge(count: number): void {
  if (process.platform === 'darwin' && typeof app.dock !== 'undefined') {
    app.dock.setBadge(count > 0 ? String(count) : '')
  }
}
