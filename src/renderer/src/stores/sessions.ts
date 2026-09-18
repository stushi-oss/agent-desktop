import { create } from 'zustand'
import type { SessionSummary } from '@shared/types'

interface SessionState {
  sessions: SessionSummary[]
  activeId: string | null
  hydrate: () => Promise<void>
  activate: (id: string) => void
  createAndActivate: (cwd: string) => Promise<SessionSummary | null>
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
  createAndActivate: async (cwd) => {
    try {
      const info = await window.api.sessions.create(cwd)
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
    const rest = get().sessions.filter((x) => x.id !== id)
    set({
      sessions: rest,
      activeId:
        get().activeId === id ? (rest.length > 0 ? rest[rest.length - 1].id : null) : get().activeId
    })
  }
}))
