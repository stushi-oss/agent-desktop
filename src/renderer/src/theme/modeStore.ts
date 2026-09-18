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
    // Task 18 接设置持久化后改为真实调用；当前 preload 无 setSettings，忽略可选调用
    void Promise.resolve({ theme: m }).catch(() => undefined)
  }
}))
