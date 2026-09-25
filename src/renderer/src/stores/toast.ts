import { create } from 'zustand'

export interface ToastItem {
  id: number
  kind: 'danger' | 'info'
  message: string
}

interface ToastState {
  toasts: ToastItem[]
  show: (message: string, kind?: ToastItem['kind']) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  show: (message, kind = 'danger') => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 5000)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

/** 便捷调用：任意 catch 块里 useToastStore.getState().show(errMessage(e)) */
export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
