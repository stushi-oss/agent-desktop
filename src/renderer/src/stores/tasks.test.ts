import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useTaskStore } from './tasks'

const tasksApi = {
  list: vi.fn(),
  history: vi.fn(),
  setEnabled: vi.fn(),
  runNow: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn()
}
;(globalThis as unknown as { window: { api: { tasks: typeof tasksApi } } }).window = {
  api: { tasks: tasksApi }
}

describe('useTaskStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTaskStore.setState({ tasks: [], history: [], _pendingMutations: 0 })
  })

  it('refreshFromPush 在没有本地 mutation 时正常覆盖', () => {
    const store = useTaskStore.getState()
    store.refreshFromPush([{ id: 't1', enabled: true } as never], [])
    expect(useTaskStore.getState().tasks).toHaveLength(1)
  })

  it('本地 setEnabled pending 中 refreshFromPush 不覆盖', async () => {
    let resolveSet!: () => void
    tasksApi.setEnabled.mockImplementation(() => new Promise<void>((res) => { resolveSet = res }))
    tasksApi.list.mockResolvedValue([])
    tasksApi.history.mockResolvedValue([])
    const store = useTaskStore.getState()
    await store.hydrate()
    store.refreshFromPush([{ id: 't1', enabled: true } as never], [])
    expect(useTaskStore.getState()._pendingMutations).toBe(0)

    // 启动一个 pending mutation
    const p = store.setEnabled('t1', false)
    // mutation 进行中：pendingMutations 必须为 1
    expect(useTaskStore.getState()._pendingMutations).toBe(1)
    // mutation 进行中：push 冲突数据 (enabled:false) 应被 guard 丢弃，状态保持 enabled:true
    store.refreshFromPush([{ id: 't1', enabled: false } as never], [])
    expect(useTaskStore.getState().tasks[0].enabled).toBe(true)
    resolveSet()
    await p
    // mutation 完成后 pendingMutations 归零
    expect(useTaskStore.getState()._pendingMutations).toBe(0)
    // mutation 完成后下次 push 正常覆盖
    store.refreshFromPush([{ id: 't1', enabled: false } as never], [])
    expect(useTaskStore.getState().tasks[0].enabled).toBe(false)
  })

  it('update 失败时 rethrow（TaskDrawer submit 依赖此契约显示 saveFailed）', async () => {
    tasksApi.update.mockRejectedValueOnce(new Error('validation failed'))
    await expect(useTaskStore.getState().update('t1', { name: 'x' })).rejects.toThrow('validation failed')
    // rethrow 也不能泄漏 mutation guard
    expect(useTaskStore.getState()._pendingMutations).toBe(0)
  })

  it('remove 失败时 rethrow（TaskDrawer onDelete 依赖此契约显示 toast）', async () => {
    tasksApi.remove.mockRejectedValueOnce(new Error('boom'))
    await expect(useTaskStore.getState().remove('t1')).rejects.toThrow('boom')
    expect(useTaskStore.getState()._pendingMutations).toBe(0)
  })
})
