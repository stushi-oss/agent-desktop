import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSessionStore } from './sessions'
import type { SessionSummary } from '@shared/types'

const sessionsApi = {
  list: vi.fn(),
  create: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  rename: vi.fn()
}
const appApi = {
  sessionsReady: vi.fn()
}
;(globalThis as unknown as {
  window: { api: { sessions: typeof sessionsApi; app: typeof appApi } }
}).window = {
  api: { sessions: sessionsApi, app: appApi }
}

const fakeSession = (id: string): SessionSummary => ({
  id,
  title: `s-${id}`,
  cwd: '/tmp',
  shellCommand: 'zsh',
  createdAt: '2024-01-01T00:00:00.000Z',
  alive: true
})

describe('useSessionStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSessionStore.setState({ sessions: [], activeId: null })
  })

  it('hydrate 末尾调 window.api.app.sessionsReady 触发 bootstrap handshake', async () => {
    sessionsApi.list.mockResolvedValue([])
    appApi.sessionsReady.mockResolvedValue(true)

    await useSessionStore.getState().hydrate()

    expect(sessionsApi.list).toHaveBeenCalledTimes(1)
    expect(appApi.sessionsReady).toHaveBeenCalledTimes(1)
    // 顺序：list → set → sessionsReady
    const listOrder = sessionsApi.list.mock.invocationCallOrder[0]
    const readyOrder = appApi.sessionsReady.mock.invocationCallOrder[0]
    expect(listOrder).toBeLessThan(readyOrder)
  })

  it('hydrate 把 list 结果写到 state 并激活第一个', async () => {
    sessionsApi.list.mockResolvedValue([fakeSession('a'), fakeSession('b')])
    appApi.sessionsReady.mockResolvedValue(true)

    await useSessionStore.getState().hydrate()

    const s = useSessionStore.getState()
    expect(s.sessions).toHaveLength(2)
    expect(s.activeId).toBe('a')
  })

  it('addSession 把新 session 追加到列表且首次激活', () => {
    const s = useSessionStore.getState()
    s.addSession(fakeSession('x'))
    const after = useSessionStore.getState()
    expect(after.sessions.map((x) => x.id)).toEqual(['x'])
    expect(after.activeId).toBe('x')
  })

  it('addSession 重复 push 同 id 不重复添加（防 hydration + bootstrap 双 push）', () => {
    const s = useSessionStore.getState()
    s.addSession(fakeSession('x'))
    s.addSession(fakeSession('x'))
    expect(useSessionStore.getState().sessions).toHaveLength(1)
  })

  it('addSession 在已有 activeId 时不切换激活', () => {
    const s = useSessionStore.getState()
    s.addSession(fakeSession('a'))
    s.addSession(fakeSession('b'))
    expect(useSessionStore.getState().activeId).toBe('a')
  })
})
