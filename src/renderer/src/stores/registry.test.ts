import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useRegistryStore } from './registry'

const registryApi = { scan: vi.fn() }
const listeners: Array<() => void> = []
;(globalThis as unknown as {
  window: {
    api: {
      registry: typeof registryApi
      onSessionsChanged: (cb: () => void) => () => void
    }
  }
}).window = {
  api: {
    registry: registryApi,
    onSessionsChanged: (cb: () => void) => {
      listeners.push(cb)
      return () => {
        const i = listeners.indexOf(cb)
        if (i >= 0) listeners.splice(i, 1)
      }
    }
  }
}

describe('useRegistryStore invalidate on sessions:changed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 不清 listeners：registry.ts 在首次 scan() 时懒订阅一次，整个测试文件周期内复用同一订阅。
    // 重置 store state：模拟「60s 缓存内但被 sessions:changed 强制 invalidate」
    useRegistryStore.setState({ snapshot: null, lastScanAt: 0 } as any)
  })

  it('初始 scan 后有 snapshot', async () => {
    registryApi.scan.mockResolvedValue({ skills: [], mcp: [], agents: [] } as any)
    await useRegistryStore.getState().scan()
    expect(useRegistryStore.getState().snapshot).not.toBeNull()
  })

  it('收到 sessions:changed 事件后缓存清空，下次 scan 重新拉', async () => {
    registryApi.scan.mockResolvedValue({ skills: [], mcp: [], agents: [] } as any)
    await useRegistryStore.getState().scan()
    const snap1 = useRegistryStore.getState().snapshot
    expect(snap1).not.toBeNull()

    // 模拟 main 广播 sessions:changed
    listeners.forEach((fn) => fn())

    expect(useRegistryStore.getState().snapshot).toBeNull()
    expect(useRegistryStore.getState().lastScanAt).toBe(0)

    await useRegistryStore.getState().scan()
    expect(registryApi.scan).toHaveBeenCalledTimes(2)
  })
})
