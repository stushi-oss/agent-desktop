import { create } from 'zustand'
import type { RegistrySnapshot } from '@shared/types'

interface RegistryState {
  snapshot: RegistrySnapshot | null
  loading: boolean
  lastScanAt: number
  scan: () => Promise<void>
}

const CACHE_MS = 60_000

export const useRegistryStore = create<RegistryState>()((set, get) => ({
  snapshot: null,
  loading: false,
  lastScanAt: 0,
  scan: async () => {
    if (get().loading) return
    if (get().snapshot && Date.now() - get().lastScanAt < CACHE_MS) return
    set({ loading: true })
    try {
      const snapshot = await window.api.registry.scan()
      set({ snapshot, lastScanAt: Date.now() })
    } catch (e) {
      // 扫描失败保留旧快照（不缓存失败，下次打开重试）
      console.error('registry scan failed', e)
    } finally {
      set({ loading: false })
    }
  }
}))
