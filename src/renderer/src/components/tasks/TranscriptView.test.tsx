import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { TranscriptView } from './TranscriptView'

// Mock react-i18next so the component can render without the i18n module being
// initialized. Returns a tiny translation map covering only the keys this
// component uses; missing keys fall back to the key itself.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'transcript.title': 'Transcript',
        'transcript.prompt': 'Prompt',
        'transcript.empty': 'No output for this run',
        'transcript.tool': 'Tool Call',
        'transcript.result': 'Result'
      }
      return map[key] ?? key
    }
  })
}))

let mockItems: unknown[] = []
let mockError: Error | null = null

const transcriptMock = vi.fn(async () => {
  if (mockError) throw mockError
  return mockItems
})

;(window as unknown as { api: { tasks: { transcript: typeof transcriptMock } } }).api = {
  tasks: {
    transcript: transcriptMock
  }
}

describe('TranscriptView 三态', () => {
  beforeEach(() => {
    mockItems = []
    mockError = null
    transcriptMock.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('加载中显示 loading', () => {
    mockItems = []
    render(<TranscriptView run={{ taskId: 't1', id: 'r1' } as any} onClose={() => {}} />)
    expect(screen.getByText(/loading/i)).toBeTruthy()
  })

  it('fetch 成功返回 [] → 显示 empty', async () => {
    mockItems = []
    render(<TranscriptView run={{ taskId: 't1', id: 'r1' } as any} onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.queryByText(/no output/i)).toBeTruthy()
    })
  })

  it('fetch 成功返回 items → 显示 loaded', async () => {
    mockItems = [{ kind: 'text', text: 'hello' }]
    render(<TranscriptView run={{ taskId: 't1', id: 'r1' } as any} onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.queryByText(/no output/i)).toBeNull()
    })
  })

  it('fetch 抛错 → 显示 error 状态', async () => {
    mockError = new Error('IPC failed')
    render(<TranscriptView run={{ taskId: 't1', id: 'r1' } as any} onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText(/failed to load transcript/i)).toBeTruthy()
    })
  })
})