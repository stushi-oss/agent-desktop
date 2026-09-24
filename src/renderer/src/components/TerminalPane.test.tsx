import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { TerminalPane } from './TerminalPane'

// 显式 cleanup：vitest globals:false 下 RTL 不会自动注册 afterEach(cleanup)，
// 不清理会让上一条用例的 t100/t500 定时器泄漏到后续用例，污染 resize 计数断言。
afterEach(() => cleanup())

// jsdom does not implement matchMedia; theme.ts reads it for 'system'.
// Pin to light so test is deterministic regardless of host color scheme.
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    })
  })
})

// Mock the preload API surface used by TerminalPane (window.api).
// Only `sessions.write/resize` and `onSessionData` are exercised; cast through
// `unknown` because global.d.ts tightens window.api to the full preload type.
const mockApi = {
  sessions: {
    write: vi.fn(async () => {}),
    resize: vi.fn(async () => {})
  },
  onSessionData: vi.fn(() => () => {})
}
;(window as unknown as { api: typeof mockApi }).api = mockApi

// mock xterm：捕获 options.theme；cols/rows 由 fit() 写入（初始 0 表示未 fit 过）
const termInstances: Array<{ options: { theme: unknown }; opts: unknown }> = []
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, unknown> = {}
    cols = 0
    rows = 0
    constructor(opts: Record<string, unknown>) {
      this.options = { ...opts }
      termInstances.push({ options: this.options as { theme: unknown }, opts })
    }
    // 把 term 回接给 addon，让 fit() mock 能写 cols/rows（真实 xterm 语义）
    loadAddon(addon: { term?: unknown }) {
      addon.term = this
    }
    open() {}
    attachCustomKeyEventHandler() {}
    focus() {}
    onData() {}
    dispose() {}
    write() {}
  }
}))

// fit 后的尺寸可控，测试里改这里即可模拟窗口尺寸变化
const mockFitDims = { cols: 80, rows: 24 }
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    term: { cols: number; rows: number } | null = null
    fit() {
      if (this.term) {
        this.term.cols = mockFitDims.cols
        this.term.rows = mockFitDims.rows
      }
    }
    proposeDimensions() {
      return { cols: mockFitDims.cols, rows: mockFitDims.rows }
    }
  }
}))

// Stub ResizeObserver (jsdom doesn't ship it)；捕获实例供测试手动触发回调
const roInstances: Array<{ callback: ResizeObserverCallback }> = []
class MockResizeObserver {
  callback: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.callback = cb
    roInstances.push(this)
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeAll(() => {
  ;(globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver
})

const baseSession = {
  id: 's1',
  title: 's1',
  cwd: '/tmp',
  shellCommand: '/bin/zsh',
  createdAt: '',
  alive: true
}

describe('TerminalPane themeMode', () => {
  beforeEach(() => {
    termInstances.length = 0
  })

  it('初始渲染使用 themeMode=light 的 xterm 主题', () => {
    render(<TerminalPane session={baseSession} active themeMode="light" />)
    expect(termInstances).toHaveLength(1)
    expect(termInstances[0].options.theme).toBeDefined()
  })

  it('rerender themeMode=light→dark 时更新 terminal.options.theme', () => {
    const { rerender } = render(
      <TerminalPane session={baseSession} active themeMode="light" />
    )
    const themeBefore = termInstances[0].options.theme
    rerender(<TerminalPane session={baseSession} active themeMode="dark" />)
    expect(termInstances[0].options.theme).not.toBe(themeBefore)
  })
})

// 等 jsdom 下一帧 rAF 跑完（pretendToBeVisual 下 rAF 由定时器驱动）
const flushRaf = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

describe('syncSize resize 去重 (#15)', () => {
  beforeEach(() => {
    roInstances.length = 0
    mockFitDims.cols = 80
    mockFitDims.rows = 24
    mockApi.sessions.resize.mockClear()
  })

  // jsdom 无布局引擎：offsetParent 恒为 null，会命中组件里的可见性 guard；
  // 手动在 host 上放开，让 RO 回调走到 scheduleSync。
  // 用 active=false 挂载：「激活时 refit」effect 有自己独立的直接 resize 路径
  // （不在 #15 改造范围内），不隔离它会污染 resize 计数断言。
  const renderWithVisibleHost = () => {
    const { container } = render(
      <TerminalPane session={baseSession} active={false} themeMode="light" />
    )
    const host = container.firstElementChild as HTMLElement
    Object.defineProperty(host, 'offsetParent', { value: document.body })
    return host
  }

  it('RO 连续触发但尺寸未变 → sessions.resize 只调一次', async () => {
    renderWithVisibleHost()
    await flushRaf() // 挂载期初始 fit 落定
    // 证明 rAF→syncSize 管线真实跑过（防环境退化成 0 调用的假绿）
    expect(mockApi.sessions.resize).toHaveBeenCalledWith('s1', 80, 24)
    // 基线取绝对值之外的相对计数：其他挂载点的独立 resize 路径（如激活 refit）
    // 不在 #15 范围内，其噪声不应影响「尺寸未变 → 零新增 IPC」这一断言
    const baseline = mockApi.sessions.resize.mock.calls.length

    const ro = roInstances[0]
    expect(ro).toBeDefined()
    ro.callback([], ro as unknown as ResizeObserver) // 第一次 RO 触发
    await flushRaf() // flush rAF 合帧
    ro.callback([], ro as unknown as ResizeObserver) // 第二次 RO 触发，尺寸未变
    await flushRaf()

    expect(mockApi.sessions.resize.mock.calls.length).toBe(baseline)
  })

  it('尺寸变化后 → resize 再次调用', async () => {
    renderWithVisibleHost()
    await flushRaf()
    const baseline = mockApi.sessions.resize.mock.calls.length

    const ro = roInstances[0]
    mockFitDims.cols = 100 // 模拟窗口尺寸变化
    mockFitDims.rows = 30
    ro.callback([], ro as unknown as ResizeObserver)
    await flushRaf()

    expect(mockApi.sessions.resize.mock.calls.length).toBe(baseline + 1)
    expect(mockApi.sessions.resize).toHaveBeenLastCalledWith('s1', 100, 30)
  })
})