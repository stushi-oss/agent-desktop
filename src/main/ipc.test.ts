// src/main/ipc.test.ts
// 验证 #1 #2：IPC handler 入口安全校验
// - sessions.create：拒绝非字符串 cwd（zod CwdSchema）
// - sessions.create：拒绝 symlink（assertRealDir）
// - sessions.create：拒绝 homedir 外路径（pathWithinParents）
// - tasks.transcript：handler 调用 readTranscriptByRunId 而非 readTranscript
// - tasks.transcript：拒绝非法 uuid
// - #16：19 个 invoke handler 全覆盖（委托传参 + 关键错误分支：
//   setSettings 非法 patch / pickDirectory 窗口销毁与取消 /
//   tasks.create 非法 input / tasks.update 非法 patch 的 zod 路径）
//
// vi.mock electron：ipc.ts 用 `import { ipcMain } from 'electron'` 在模块加载时
// 拿到的是绑定，不是 getter，所以必须在模块加载前替换。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dialog, type BrowserWindow } from 'electron'
import type { AppSettings } from '@shared/types'

const handlers = vi.hoisted(() => ({ map: {} as Record<string, Function> }))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Function): void => {
      handlers.map[channel] = fn
    }
  },
  dialog: { showOpenDialog: vi.fn() },
  nativeTheme: { themeSource: 'system' }
}))

import { registerIpc, _resetBootstrapForTests, type IpcDeps } from './ipc'

function makeDeps(over: Partial<IpcDeps> = {}): IpcDeps {
  const sessions = {
    create: vi.fn((cwd: string) => ({
      id: 's1',
      cwd,
      title: 't',
      shellCommand: '/bin/zsh',
      createdAt: '',
      alive: true
    })),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    list: vi.fn(() => []),
    rename: vi.fn(() => true),
    onData: vi.fn(),
    onExit: vi.fn()
  }
  const tasks = {
    tasks: [],
    historyOf: vi.fn(() => []),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(() => true),
    setEnabled: vi.fn(),
    runNow: vi.fn(),
    readTranscript: vi.fn(() => []),
    readTranscriptByRunId: vi.fn(() => [])
  }
  return {
    getWindow: () => null,
    sessions: sessions as unknown as IpcDeps['sessions'],
    tasks: tasks as unknown as IpcDeps['tasks'],
    shellFor: () => ({ file: '/bin/zsh', args: [], label: 'zsh' }),
    scanRegistry: () => ({
      skills: [],
      mcp: [],
      agents: [],
      scannedAt: 0,
      cwd: '',
      home: ''
    }),
    settings: { get: () => ({}) as ReturnType<IpcDeps['settings']['get']>, set: (p) => p as ReturnType<IpcDeps['settings']['set']> },
    claudeStatus: { found: false, candidates: [] },
    ...over
  } as IpcDeps
}

beforeEach(() => {
  handlers.map = {}
  // 修复 #6：每个测试前重置 bootstrap 状态，否则第一个测试后 create 被永久 disable
  _resetBootstrapForTests()
})

describe('registerIpc security', () => {
  it('sessions.create 拒绝非字符串 cwd', () => {
    registerIpc(makeDeps())
    const handler = handlers.map['sessions:create']
    expect(() => handler({}, 123)).toThrow()
  })

  it('sessions.create 拒绝 null cwd', () => {
    registerIpc(makeDeps())
    const handler = handlers.map['sessions:create']
    expect(() => handler({}, null)).toThrow()
  })

  it('sessions.create 拒绝 symlink cwd', () => {
    // 用 /tmp 下的 symlink 指向 home 下的真目录：
    // pathWithinParents 检查路径前先 lstat 看到 symlink → 抛 SecurityError
    // 用一段临时 fs：mkdtemp + symlink，断言抛错。
    // 避免依赖 os.homedir() 在 sandbox 下的可写性。
    const { mkdtempSync, symlinkSync, rmSync } = require('node:fs') as typeof import('node:fs')
    const { tmpdir } = require('node:os') as typeof import('node:os')
    const { join } = require('node:path') as typeof import('node:path')
    const real = mkdtempSync(join(tmpdir(), 'sec-real-'))
    const link = join(tmpdir(), `sec-link-${Date.now()}`)
    symlinkSync(real, link)
    try {
      registerIpc(makeDeps())
      const handler = handlers.map['sessions:create']
      expect(() => handler({}, link)).toThrow()
    } finally {
      rmSync(link, { force: true })
      rmSync(real, { recursive: true, force: true })
    }
  })

  it('tasks.transcript 使用 runId-based lookup', () => {
    const deps = makeDeps()
    registerIpc(deps)
    const handler = handlers.map['tasks:transcript']
    const req = {
      taskId: '11111111-1111-4111-8111-111111111111',
      runId: '22222222-2222-4222-8222-222222222222'
    }
    handler({}, req)
    expect(deps.tasks.readTranscriptByRunId).toHaveBeenCalledWith(req.taskId, req.runId)
  })

  it('tasks.transcript 拒绝非法 uuid', () => {
    registerIpc(makeDeps())
    const handler = handlers.map['tasks:transcript']
    expect(() => handler({}, { taskId: 'x', runId: 'y' })).toThrow()
  })
})

describe('app:sessionsReady handshake', () => {
  function makeSessionsWithCreate(create: ReturnType<typeof vi.fn>): IpcDeps['sessions'] {
    return {
      create,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      list: vi.fn(() => []),
      rename: vi.fn(() => true),
      onData: vi.fn(),
      onExit: vi.fn(),
      onRemove: vi.fn()
    } as unknown as IpcDeps['sessions']
  }

  it('第一次调用创建 session 并返回 true', () => {
    const { homedir } = require('node:os') as typeof import('node:os')
    const sessionsCreate = vi.fn((cwd: string) => ({
      id: 's1',
      cwd,
      title: 't',
      shellCommand: '/bin/zsh',
      createdAt: '',
      alive: true
    }))
    const deps = makeDeps({ sessions: makeSessionsWithCreate(sessionsCreate) })
    registerIpc(deps)
    const handler = handlers.map['app:sessionsReady']
    expect(handler({})).toBe(true)
    expect(sessionsCreate).toHaveBeenCalledWith(homedir(), 80, 24, expect.objectContaining({ file: '/bin/zsh' }), false)
  })

  it('第二次调用返回 false（已 bootstrap）', () => {
    const sessionsCreate = vi.fn((cwd: string) => ({
      id: 's1',
      cwd,
      title: 't',
      shellCommand: '/bin/zsh',
      createdAt: '',
      alive: true
    }))
    const deps = makeDeps({ sessions: makeSessionsWithCreate(sessionsCreate) })
    registerIpc(deps)
    const handler = handlers.map['app:sessionsReady']
    handler({})
    expect(handler({})).toBe(false)
    expect(sessionsCreate).toHaveBeenCalledTimes(1)
  })
})

// ---------- #16：invoke handler 全量覆盖 ----------

/** 假窗口：isDestroyed=false + 可断言的 webContents.send（用于 push channel 断言） */
function makeFakeWindow(): { win: BrowserWindow; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn()
  const win = { isDestroyed: () => false, webContents: { send } } as unknown as BrowserWindow
  return { win, send }
}

/** 可覆写单个方法的 sessions mock（与上面 makeSessionsWithCreate 同型） */
function makeSessions(over: Record<string, unknown> = {}): IpcDeps['sessions'] {
  return {
    create: vi.fn((cwd: string) => ({
      id: 's1',
      cwd,
      title: 't',
      shellCommand: '/bin/zsh',
      createdAt: '',
      alive: true
    })),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    list: vi.fn(() => []),
    rename: vi.fn(() => true),
    onData: vi.fn(),
    onExit: vi.fn(),
    onRemove: vi.fn(),
    ...over
  } as unknown as IpcDeps['sessions']
}

describe('#16 sessions handler 委托', () => {
  it('sessions.write 委托 (id, data)', () => {
    const deps = makeDeps()
    registerIpc(deps)
    handlers.map['sessions:write']({}, 's1', 'ls -la')
    expect(deps.sessions.write).toHaveBeenCalledWith('s1', 'ls -la')
  })

  it('sessions.resize 委托 (id, cols, rows)', () => {
    const deps = makeDeps()
    registerIpc(deps)
    handlers.map['sessions:resize']({}, 's1', 132, 43)
    expect(deps.sessions.resize).toHaveBeenCalledWith('s1', 132, 43)
  })

  it('sessions.kill 委托并 push sessions:changed', () => {
    const { win, send } = makeFakeWindow()
    const deps = makeDeps({ getWindow: () => win })
    registerIpc(deps)
    handlers.map['sessions:kill']({}, 's1')
    expect(deps.sessions.kill).toHaveBeenCalledWith('s1')
    expect(send).toHaveBeenCalledWith('sessions:changed', undefined)
  })

  it('sessions.list 返回 sessions.list() 结果', () => {
    const rows = [{ id: 's1', cwd: '/tmp', title: 't', shellCommand: '/bin/zsh', createdAt: '', alive: true }]
    const list = vi.fn(() => rows)
    const deps = makeDeps({ sessions: makeSessions({ list }) })
    registerIpc(deps)
    expect(handlers.map['sessions:list']({})).toBe(rows)
  })

  it('sessions.rename 委托并返回 boolean', () => {
    const rename = vi.fn(() => true)
    const deps = makeDeps({ sessions: makeSessions({ rename }) })
    registerIpc(deps)
    expect(handlers.map['sessions:rename']({}, 's1', '新标题')).toBe(true)
    expect(rename).toHaveBeenCalledWith('s1', '新标题')
  })
})

describe('#16 app handler（pickDirectory / settings / registry）', () => {
  const showOpenDialog = dialog.showOpenDialog as unknown as ReturnType<typeof vi.fn>

  it('app.pickDirectory 窗口销毁（getWindow → null）返回 null 且不弹 dialog', async () => {
    const deps = makeDeps({ getWindow: () => null })
    registerIpc(deps)
    showOpenDialog.mockClear()
    await expect(handlers.map['app:pickDirectory']({})).resolves.toBeNull()
    expect(showOpenDialog).not.toHaveBeenCalled()
  })

  it('app.pickDirectory dialog 取消返回 null', async () => {
    const { win, send } = makeFakeWindow()
    const deps = makeDeps({ getWindow: () => win })
    registerIpc(deps)
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await expect(handlers.map['app:pickDirectory']({})).resolves.toBeNull()
    expect(send).not.toHaveBeenCalled()
  })

  it('app.pickDirectory 选中目录返回第一个路径', async () => {
    const { win } = makeFakeWindow()
    const deps = makeDeps({ getWindow: () => win })
    registerIpc(deps)
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/demo'] })
    await expect(handlers.map['app:pickDirectory']({})).resolves.toBe('/tmp/demo')
    expect(showOpenDialog).toHaveBeenCalledWith(win, { properties: ['openDirectory', 'createDirectory'] })
  })

  it('registry.scan 委托 deps.scanRegistry', () => {
    const snapshot = { scannedAt: '2026-01-01T00:00:00Z', skills: [], mcpServers: [], agents: [] }
    const scanRegistry = vi.fn(() => snapshot)
    const deps = makeDeps({ scanRegistry })
    registerIpc(deps)
    expect(handlers.map['registry:scan']({})).toBe(snapshot)
    expect(scanRegistry).toHaveBeenCalledTimes(1)
  })

  it('app.getSettings 委托 settings.get', () => {
    const current = { theme: 'dark', locale: 'zh-CN', closeToTray: false } as AppSettings
    const get = vi.fn(() => current)
    const deps = makeDeps({ settings: { get, set: (p) => ({ ...current, ...p }) } })
    registerIpc(deps)
    expect(handlers.map['app:getSettings']({})).toBe(current)
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('app.setSettings happy：合法 patch → settings.set 结果 + app:settingsChanged push', () => {
    const { win, send } = makeFakeWindow()
    const current = { theme: 'dark', locale: 'zh-CN', closeToTray: false } as AppSettings
    const set = vi.fn((p: Partial<AppSettings>) => ({ ...current, ...p }))
    const deps = makeDeps({ settings: { get: () => current, set }, getWindow: () => win })
    registerIpc(deps)
    const result = handlers.map['app:setSettings']({}, { closeToTray: true })
    expect(set).toHaveBeenCalledWith({ closeToTray: true })
    expect(result).toEqual({ theme: 'dark', locale: 'zh-CN', closeToTray: true })
    expect(send).toHaveBeenCalledWith('app:settingsChanged', { theme: 'dark', locale: 'zh-CN', closeToTray: true })
  })

  it('app.setSettings 非法 patch（{ theme: "red" }）抛（zod 回归锚）', () => {
    const deps = makeDeps()
    registerIpc(deps)
    expect(() => handlers.map['app:setSettings']({}, { theme: 'red' })).toThrow()
  })

  it('app.getClaudeStatus 委托返回', () => {
    const status = { found: true, candidates: ['/opt/homebrew/bin/claude'] }
    const deps = makeDeps({ claudeStatus: status })
    registerIpc(deps)
    expect(handlers.map['app:getClaudeStatus']({})).toBe(status)
  })
})

describe('#16 tasks handler 委托 + zod（#17 信任边界）', () => {
  const validTaskInput = {
    name: 'demo',
    prompt: 'hi',
    cwd: '/tmp',
    schedule: { type: 'interval', minutes: 5 },
    permissionMode: 'default'
  }

  it('tasks.list 返回任务数组', () => {
    const deps = makeDeps()
    const rows = [{ id: 't1', name: 'demo' }]
    const tasks = deps.tasks as unknown as { tasks: unknown[] }
    tasks.tasks = rows
    registerIpc(deps)
    expect(handlers.map['tasks:list']({})).toBe(rows)
  })

  it('tasks.history 带 taskId 委托 historyOf(taskId)', () => {
    const deps = makeDeps()
    registerIpc(deps)
    expect(handlers.map['tasks:history']({}, 't1')).toEqual([])
    expect(deps.tasks.historyOf).toHaveBeenCalledWith('t1')
  })

  it('tasks.history 不带 taskId 传 undefined', () => {
    const deps = makeDeps()
    registerIpc(deps)
    handlers.map['tasks:history']({})
    expect(deps.tasks.historyOf).toHaveBeenCalledWith(undefined)
  })

  it('tasks.remove 委托并返回 boolean', () => {
    const deps = makeDeps()
    registerIpc(deps)
    expect(handlers.map['tasks:remove']({}, 't1')).toBe(true)
    expect(deps.tasks.remove).toHaveBeenCalledWith('t1')
  })

  it('tasks.setEnabled 委托 (id, enabled)', () => {
    const deps = makeDeps()
    registerIpc(deps)
    handlers.map['tasks:setEnabled']({}, 't1', false)
    expect(deps.tasks.setEnabled).toHaveBeenCalledWith('t1', false)
  })

  it('tasks.runNow 委托 (id)', () => {
    const deps = makeDeps()
    registerIpc(deps)
    handlers.map['tasks:runNow']({}, 't1')
    expect(deps.tasks.runNow).toHaveBeenCalledWith('t1')
  })

  it('tasks.create happy：合法 input → tasks.create 收到 parsed 对象', () => {
    const deps = makeDeps()
    registerIpc(deps)
    handlers.map['tasks:create']({}, validTaskInput)
    expect(deps.tasks.create).toHaveBeenCalledTimes(1)
    expect(deps.tasks.create).toHaveBeenCalledWith(validTaskInput)
  })

  it('tasks.create 非法 input（{ rogue: 1 }）抛（TaskInputSchema 路径）', () => {
    const deps = makeDeps()
    registerIpc(deps)
    expect(() => handlers.map['tasks:create']({}, { rogue: 1 })).toThrow()
    expect(deps.tasks.create).not.toHaveBeenCalled()
  })

  it('tasks.update happy：合法 patch（含 enabled）→ tasks.update 被调', () => {
    const deps = makeDeps()
    registerIpc(deps)
    handlers.map['tasks:update']({}, 't1', { name: 'renamed', enabled: false })
    expect(deps.tasks.update).toHaveBeenCalledWith('t1', { name: 'renamed', enabled: false })
  })

  it('tasks.update 非法 patch（{ rogue: 1 }）抛（TaskPatchSchema 路径）', () => {
    const deps = makeDeps()
    registerIpc(deps)
    expect(() => handlers.map['tasks:update']({}, 't1', { rogue: 1 })).toThrow()
    expect(deps.tasks.update).not.toHaveBeenCalled()
  })
})