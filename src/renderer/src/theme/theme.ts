// 跟随系统主题：Electron 中 nativeTheme.themeSource='system' 时
// matchMedia('(prefers-color-scheme: dark)') 可用且随系统切换。
// 设置页的显式切换（Task 18）通过设置 theme 后仍收敛到这里的 applyTheme。

export type ThemeMode = 'system' | 'light' | 'dark'

export function effectiveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = effectiveTheme(mode)
}

export function watchSystemTheme(cb: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = () => cb()
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}
