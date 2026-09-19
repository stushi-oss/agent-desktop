import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render } from '@testing-library/react'
import { TerminalPane } from './TerminalPane'

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

// mock xterm：捕获 options.theme
const termInstances: Array<{ options: { theme: unknown }; opts: unknown }> = []
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, unknown> = {}
    constructor(opts: Record<string, unknown>) {
      this.options = { ...opts }
      termInstances.push({ options: this.options as { theme: unknown }, opts })
    }
    loadAddon() {}
    open() {}
    attachCustomKeyEventHandler() {}
    focus() {}
    onData() {}
    dispose() {}
    write() {}
  }
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
    proposeDimensions() {
      return { cols: 80, rows: 24 }
    }
  }
}))

// Stub ResizeObserver (jsdom doesn't ship it)
beforeAll(() => {
  ;(globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
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