import { describe, it, expect } from 'vitest'
import { parseStreamLine, parseEvents, extractResultText, toTranscriptItems, createResultExtractor } from './streamJson'

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
  it('result,result → 最后一个 result 胜出（硬编码期望）', () => {
    // 硬编码期望值而非与 extractResultText 自身对照（同义反复测不出回归）
    const events = parseEvents([
      '{"type":"result","subtype":"success","result":"FIRST","is_error":false}',
      '{"type":"result","subtype":"success","result":"SECOND","is_error":false}'
    ].join('\n'))
    expect(extractResultText(events)).toBe('SECOND')
  })
  it('text,result,text → trailing text 胜出（硬编码期望）', () => {
    // result 之后又来一段 assistant 文本：最后一段连续 text 优先于更早的 result
    const events = parseEvents([
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"EARLIER"}]}}',
      '{"type":"result","subtype":"success","result":"FROM_RESULT","is_error":false}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"TRAILING"}]}}'
    ].join('\n'))
    expect(extractResultText(events)).toBe('TRAILING')
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

describe('createResultExtractor 流式等价 (#14)', () => {
  const fixtures: string[] = [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }),
    [JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'a' }] } }),
     JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'b' }] } }),
     JSON.stringify({ type: 'result', result: 'r' })].join('\n'),
    JSON.stringify({ type: 'result', result: 'only-result' }),
    [JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'pre' }] } }),
     JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }] } }),
     JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'post' }] } })].join('\n'),
    'not-json\n' + JSON.stringify({ type: 'result', result: 'x' }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'tail-no-result' }] } })
  ]

  it.each(fixtures)('流式 feed 与批量 extract 输出一致', (raw) => {
    const events = parseEvents(raw)
    const ex = createResultExtractor()
    for (const e of events) ex.feed(e)
    expect(ex.finish()).toBe(extractResultText(events))
  })

  it('空输入 finish 返回 undefined', () => {
    expect(createResultExtractor().finish()).toBeUndefined()
  })

  it('finish 幂等：连续两次调用结果一致（含 curRun 未冲刷场景）', () => {
    // 场景 1：末尾 text run 尚未冲刷，首个 finish 完成提升，二次调用不得改变结果
    const ex1 = createResultExtractor()
    ex1.feed({ kind: 'text', text: 'a' })
    ex1.feed({ kind: 'text', text: 'b' })
    expect(ex1.finish()).toBe('a\nb')
    expect(ex1.finish()).toBe('a\nb')

    // 场景 2：result 回退路径同样幂等
    const ex2 = createResultExtractor()
    ex2.feed({ kind: 'result', text: 'only-result' })
    expect(ex2.finish()).toBe('only-result')
    expect(ex2.finish()).toBe('only-result')
  })

  it('feed 期间随时 finish 与批量语义一致（中途快照）', () => {
    const events = parseEvents(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'first' }] } }) + '\n' +
      JSON.stringify({ type: 'result', result: 'final' })
    )
    const ex = createResultExtractor()
    ex.feed(events[0])
    expect(ex.finish()).toBe('first')  // 中途：最后 text run
    ex.feed(events[1])
    expect(ex.finish()).toBe('first')  // result 后仍优先 text run（与批量语义一致）
  })
})
