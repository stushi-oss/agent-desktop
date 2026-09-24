// src/main/ipc.test.ts
// 验证 #1 #2：IPC handler 入口安全校验
// - sessions.create：拒绝非字符串 cwd（zod CwdSchema）
// - sessions.create：拒绝 symlink（assertRealDir）
// - sessions.create：拒绝 homedir 外路径（pathWithinParents）
// - tasks.transcript：handler 调用 readTranscriptByRunId 而非 readTranscript
// - tasks.transcript：拒绝非法 uuid
//
// vi.mock electron：ipc.ts 用 `import { ipcMain } from 'electron'` 在模块加载时
// 拿到的是绑定，不是 getter，所以必须在模块加载前替换。

import { describe, it, expect, vi, beforeEach } from 'vitest'

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