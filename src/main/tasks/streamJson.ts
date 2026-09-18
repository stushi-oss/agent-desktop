import type { StreamEvent, TranscriptItem } from '@shared/types'

export function parseStreamLine(line: string): StreamEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const value: unknown = JSON.parse(trimmed)
    if (typeof value === 'object' && value !== null && 'type' in value) {
      return value as StreamEvent
    }
    return null
  } catch {
    return null
  }
}

/** 提取任务结果文本：优先最后一条 assistant 的 text 块拼接，回退 result.result */
export function extractResultText(events: StreamEvent[]): string | undefined {
  let lastAssistant: string | undefined
  let resultText: string | undefined
  for (const ev of events) {
    if (ev.type === 'assistant') {
      const content = (ev as { message?: { content?: unknown[] } }).message?.content
      if (Array.isArray(content)) {
        const texts = content
          .filter((c): c is { type: string; text: string } =>
            typeof c === 'object' && c !== null && (c as { type?: string }).type === 'text' && typeof (c as { text?: unknown }).text === 'string')
          .map((c) => c.text)
        if (texts.length > 0) lastAssistant = texts.join('\n')
      }
    } else if (ev.type === 'result') {
      const r = ev as { result?: unknown }
      if (typeof r.result === 'string') resultText = r.result
    }
  }
  return lastAssistant ?? resultText
}

export type { TranscriptItem }

/** stream-json → 回放用条目（TranscriptView 消费） */
export function toTranscriptItems(events: StreamEvent[]): TranscriptItem[] {
  const items: TranscriptItem[] = []
  for (const ev of events) {
    if (ev.type === 'assistant') {
      const content = (ev as { message?: { content?: unknown[] } }).message?.content
      if (Array.isArray(content)) {
        for (const c of content) {
          const block = c as { type?: string; text?: unknown; name?: unknown; input?: unknown }
          if (block.type === 'text' && typeof block.text === 'string') {
            items.push({ kind: 'text', text: block.text })
          } else if (block.type === 'tool_use') {
            items.push({
              kind: 'tool',
              name: String(block.name ?? ''),
              input: block.input === undefined ? undefined : JSON.stringify(block.input).slice(0, 200)
            })
          }
        }
      }
    } else if (ev.type === 'result') {
      const r = ev as { result?: unknown; is_error?: unknown }
      items.push({ kind: 'result', text: typeof r.result === 'string' ? r.result : '', isError: r.is_error === true })
    }
  }
  return items
}
