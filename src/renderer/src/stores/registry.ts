import { create } from 'zustand'
import type { RegistrySnapshot } from '@shared/types'

interface RegistryState {
  snapshot: RegistrySnapshot | null
  loading: boolean
  lastScanAt: number
  scan: () => Promise<void>
}

const CACHE_MS = 60_000

// 懒订阅：模块加载时 window.api 可能还没就绪（preload 启动前 / 测试 setup 之前），
// 第一次 scan() 时再订阅。订阅只发生一次，后续 scan() 跳过。
let invalidateSubscribed = false
const ensureInvalidateSubscription = (): void => {
  if (invalidateSubscribed) return
  if (typeof window === 'undefined' || !window.api?.onSessionsChanged) return
  invalidateSubscribed = true
  window.api.onSessionsChanged(() => {
    // 保守 invalidate：宁可多拉一次，不可漏掉新 session 的 project 技能。
    useRegistryStore.setState({ snapshot: null, lastScanAt: 0 })
  })
}

export const useRegistryStore = create<RegistryState>()((set, get) => ({
  snapshot: null,
  loading: false,
  lastScanAt: 0,
  scan: async () => {
    ensureInvalidateSubscription()
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
