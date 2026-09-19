import { create } from 'zustand'
import { applyTheme, effectiveTheme } from './theme'

export type ThemeMode = 'system' | 'light' | 'dark'

interface ModeState {
  mode: ThemeMode
  effective: 'light' | 'dark'
  setMode: (m: ThemeMode) => void
}

export const useModeStore = create<ModeState>()((set) => ({
  mode: 'system',
  effective: effectiveTheme('system'),
  setMode: (m) => {
    applyTheme(m)
    set({ mode: m, effective: effectiveTheme(m) })
    // 持久化主题；主进程侧 nativeTheme.themeSource 由 app:setSettings 处理器同步
    void window.api.app.setSettings({ theme: m }).catch(() => undefined)
  }
}))
