import type { StreamEvent, TranscriptItem } from '@shared/types'
import type { NormalizedEvent } from '@shared/streamEvents'

/**
 * 兼容 export：单行 raw JSON → 原始 StreamEvent 或 null。
 * 保留给旧 caller（如 TaskRunner 增量流式解析）。新代码应使用 {@link parseEvents}。
 */
export function parseStreamLine(line: string): StreamEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const value: unknown = JSON.parse(trimmed)
    if (typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string') {
      return value as StreamEvent
    }
    return null
  } catch {
    return null
  }
}

/**
 * stream-json raw（可能多行） → {@link NormalizedEvent}[]。
 * 单一入口：所有需要消费 stream-json 的调用方（extractResultText、
 * toTranscriptItems 等）从此函数取得 normalized events，不再各自 walk + cast。
 *
 * 行为约定：
 * - 空行 / 非法 JSON 行 → 跳过
 * - 非对象 / 缺 type → push `{ kind: 'unknown', raw }`
 * - `type: 'assistant'` → 展开 message.content：text 块 → `kind: 'text'`，
 *   tool_use 块 → `kind: 'tool_use'`；其他块（tool_result 等）跳过
 * - `type: 'result'` → `kind: 'result'`（含 is_error 透传）
 * - `type: 'system'` → `kind: 'system'`（保留 subtype + 原始 data）
 * - 其他 type → `kind: 'unknown'`
 */
export function parseEvents(raw: string): NormalizedEvent[] {
  const events: NormalizedEvent[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    const obj = parsed as {
      type?: unknown
      message?: { content?: unknown }
      result?: unknown
      is_error?: unknown
      subtype?: unknown
    }
    if (typeof obj.type !== 'string') {
      events.push({ kind: 'unknown', raw: parsed })
      continue
    }
    switch (obj.type) {
      case 'assistant': {
        const content = obj.message?.content
        if (!Array.isArray(content)) {
          events.push({ kind: 'unknown', raw: parsed })
          break
        }
        for (const item of content) {
          if (typeof item !== 'object' || item === null) continue
          const i = item as {
            type?: unknown
            text?: unknown
            id?: unknown
            name?: unknown
            input?: unknown
          }
          if (i.type === 'text' && typeof i.text === 'string') {
            events.push({ kind: 'text', text: i.text })
          } else if (
            i.type === 'tool_use' &&
            typeof i.id === 'string' &&
            typeof i.name === 'string'
          ) {
            events.push({ kind: 'tool_use', id: i.id, name: i.name, input: i.input })
          }
        }
        break
      }
      case 'result':
        events.push({
          kind: 'result',
          text: typeof obj.result === 'string' ? obj.result : '',
          isError: typeof obj.is_error === 'boolean' ? obj.is_error : undefined
        })
        break
      case 'system':
        events.push({
          kind: 'system',
          subtype: typeof obj.subtype === 'string' ? obj.subtype : '',
          data: parsed
        })
        break
      default:
        events.push({ kind: 'unknown', raw: parsed })
    }
  }
  return events
}

export interface ResultExtractor {
  feed(event: NormalizedEvent): void
  finish(): string | undefined
}

/**
 * 流式版 result 提取：与 extractResultText 同一语义（最后一段连续
 * text 优先，回退最后 result），O(1) 滚动状态。供 TaskRunner 逐事件
 * 消费，替代全程累积 events 数组（修复 #14）。
 *
 * 语义（与批量版共享）：
 * - 优先取最后一段连续 text 事件（多块用 '\n' 拼接，对应最后一条 assistant
 *   的所有 text 块）
 * - 回退到最后一个 result 事件的 text
 * - 都没有 → undefined
 */
export function createResultExtractor(): ResultExtractor {
  let lastTextRun: string[] = []
  let curRun: string[] = []
  let resultText: string | undefined
  return {
    feed(e) {
      if (e.kind === 'text') {
        curRun.push(e.text)
      } else {
        if (curRun.length > 0) {
          lastTextRun = curRun
          curRun = []
        }
        if (e.kind === 'result') {
          resultText = e.text
        }
      }
    },
    finish() {
      if (curRun.length > 0) lastTextRun = curRun
      return lastTextRun.length > 0 ? lastTextRun.join('\n') : resultText
    }
  }
}

/**
 * 提取任务结果文本（批量版）：复用流式 reducer，单一事实来源。
 */
export function extractResultText(events: NormalizedEvent[]): string | undefined {
  const ex = createResultExtractor()
  for (const e of events) ex.feed(e)
  return ex.finish()
}

export type { TranscriptItem }

/** normalized events → 回放用条目（TranscriptView 消费） */
export function toTranscriptItems(events: NormalizedEvent[]): TranscriptItem[] {
  return events.flatMap<TranscriptItem>((e) => {
    switch (e.kind) {
      case 'text':
        return [{ kind: 'text', text: e.text }]
      case 'tool_use':
        return [
          {
            kind: 'tool',
            name: e.name,
            input:
              e.input === undefined ? undefined : JSON.stringify(e.input).slice(0, 200)
          }
        ]
      case 'result':
        return [{ kind: 'result', text: e.text, isError: e.isError === true }]
      default:
        return []
    }
  })
}