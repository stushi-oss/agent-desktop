import { describe, it, expect } from 'vitest'
import { parseStreamLine, parseEvents, extractResultText, toTranscriptItems } from './streamJson'

const LINES = [
  '{"type":"system","subtype":"init","model":"claude-sonnet-5"}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"先看看文件"}]}}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/a"}}]}}',
  '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"file body"}]}}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"最终答案 A"},{"type":"text","text":"续"}]}}',
  '{"type":"result","subtype":"success","result":"最终答案 A\\n续","is_error":false}'
]

describe('parseStreamLine', () => {
  it('合法 JSON 且有 type 字段 → 解析返回', () => {
    const ev = parseStreamLine(LINES[0])
    expect(ev?.type).toBe('system')
  })
  it('空行/非 JSON/非对象/无 type → null', () => {
    expect(parseStreamLine('')).toBeNull()
    expect(parseStreamLine('   ')).toBeNull()
    expect(parseStreamLine('not json')).toBeNull()
    expect(parseStreamLine('[1,2]')).toBeNull()
    expect(parseStreamLine('42')).toBeNull()
    expect(parseStreamLine('{"foo":1}')).toBeNull()
    expect(parseStreamLine('{"type":42}')).toBeNull()
  })
})

describe('parseEvents (normalized)', () => {
  it('assistant text message → NormalizedEvent kind=text', () => {
    const raw = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hello' }] }
    })
    const events = parseEvents(raw)
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('text')
    expect(events[0]).toMatchObject({ kind: 'text', text: 'hello' })
  })

  it('assistant tool_use message → NormalizedEvent kind=tool_use', () => {
    const raw = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { cmd: 'ls' } }] }
    })
    const events = parseEvents(raw)
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('tool_use')
    expect(events[0]).toMatchObject({ kind: 'tool_use', id: 't1', name: 'Bash' })
  })

  it('result event → NormalizedEvent kind=result', () => {
    const raw = JSON.stringify({ type: 'result', result: 'final answer' })
    const events = parseEvents(raw)
    expect(events.some(e => e.kind === 'result')).toBe(true)
  })

  it('多行混合 → 多个 events', () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'a' }] } }),
      JSON.stringify({ type: 'result', result: 'b' })
    ]
    const events = parseEvents(lines.join('\n'))
    expect(events).toHaveLength(3)
    expect(events.map(e => e.kind)).toEqual(['system', 'text', 'result'])
  })

  it('malformed JSON 行跳过', () => {
    const events = parseEvents('not-json\n' + JSON.stringify({ type: 'result', result: 'x' }))
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('result')
  })
})

describe('extractResultText', () => {
  it('优先取最后一条 assistant 的全部 text 块（拼接）', () => {
    const events = parseEvents(LINES.join('\n'))
    expect(extractResultText(events)).toBe('最终答案 A\n续')
  })
  it('无 assistant 文本时回退 result.result', () => {
    const events = parseEvents([LINES[0], LINES[5]].join('\n'))
    expect(extractResultText(events)).toBe('最终答案 A\n续')
  })
  it('两者皆无 → undefined', () => {
    expect(extractResultText(parseEvents(LINES[0]))).toBeUndefined()
  })
  it('assistant 文本与 result.result 同时存在 → 优先 assistant（可区分）', () => {
    const events = parseEvents([
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"FROM_ASSISTANT"}]}}',
      '{"type":"result","subtype":"success","result":"FROM_RESULT","is_error":false}'
    ].join('\n'))
    expect(extractResultText(events)).toBe('FROM_ASSISTANT')
  })
  it('仅含 tool_use 的 assistant 不清除已记录文本', () => {
    const events = parseEvents([
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"A"}]}}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"Bash","input":{}}]}}'
    ].join('\n'))
    expect(extractResultText(events)).toBe('A')
  })
})

describe('toTranscriptItems', () => {
  it('text/tool/result 三种条目；tool_result/system 跳过', () => {
    const events = parseEvents(LINES.join('\n'))
    const items = toTranscriptItems(events)
    expect(items).toEqual([
      { kind: 'text', text: '先看看文件' },
      { kind: 'tool', name: 'Read', input: '{"file_path":"/a"}' },
      { kind: 'text', text: '最终答案 A' },
      { kind: 'text', text: '续' },
      { kind: 'result', text: '最终答案 A\n续', isError: false }
    ])
  })
  it('result is_error=true 标记错误', () => {
    const events = parseEvents('{"type":"result","subtype":"error_during_execution","result":"boom","is_error":true}')
    expect(toTranscriptItems(events)[0]).toMatchObject({ kind: 'result', isError: true })
  })
  it('content 含 null/非对象元素 → 跳过且不抛错', () => {
    const events = parseEvents('{"type":"assistant","message":{"role":"assistant","content":[null,{"type":"text","text":"ok"}]}}')
    const items = toTranscriptItems(events)
    expect(items).toEqual([{ kind: 'text', text: 'ok' }])
  })
})