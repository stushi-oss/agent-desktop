import { create } from 'zustand'
import type { SessionSummary } from '@shared/types'

interface SessionState {
  sessions: SessionSummary[]
  activeId: string | null
  hydrate: () => Promise<void>
  activate: (id: string) => void
  createAndActivate: (cwd: string, launchClaude?: boolean) => Promise<SessionSummary | null>
  rename: (id: string, title: string) => void
  markExited: (id: string, code: number | undefined) => void
  close: (id: string) => Promise<void>
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  sessions: [],
  activeId: null,
  hydrate: async () => {
    const sessions = await window.api.sessions.list()
    set({ sessions, activeId: sessions.length > 0 ? sessions[0].id : null })
  },
  activate: (id) => set({ activeId: id }),
  createAndActivate: async (cwd, launchClaude = false) => {
    try {
      const info = await window.api.sessions.create(cwd, launchClaude)
      set((s) => ({ sessions: [...s.sessions, info], activeId: info.id }))
      return info
    } catch (e) {
      console.error('create session failed', e)
      return null
    }
  },
  rename: (id, title) =>
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, title } : x)) })),
  markExited: (id, _code) =>
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, alive: false } : x)) })),
  close: async (id) => {
    await window.api.sessions.kill(id)
    // 关闭后激活相邻 tab（优先左侧），与常见 tab 栏行为一致
    const idx = get().sessions.findIndex((x) => x.id === id)
    const rest = get().sessions.filter((x) => x.id !== id)
    const next = rest[idx - 1] ?? rest[0] ?? null
    set({ sessions: rest, activeId: get().activeId === id ? next?.id ?? null : get().activeId })
  }
}))
