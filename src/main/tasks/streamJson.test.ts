import { describe, it, expect } from 'vitest'
import { parseStreamLine, extractResultText, toTranscriptItems } from './streamJson'

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
  })
})

describe('extractResultText', () => {
  it('优先取最后一条 assistant 的全部 text 块（拼接）', () => {
    const events = LINES.map((l) => parseStreamLine(l)!).filter(Boolean)
    expect(extractResultText(events)).toBe('最终答案 A\n续')
  })
  it('无 assistant 文本时回退 result.result', () => {
    const events = [parseStreamLine(LINES[0])!, parseStreamLine(LINES[5])!]
    expect(extractResultText(events)).toBe('最终答案 A\n续')
  })
  it('两者皆无 → undefined', () => {
    expect(extractResultText([parseStreamLine(LINES[0])!])).toBeUndefined()
  })
})

describe('toTranscriptItems', () => {
  it('text/tool/result 三种条目；tool_result/system 跳过', () => {
    const events = LINES.map((l) => parseStreamLine(l)!).filter(Boolean)
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
    const ev = parseStreamLine('{"type":"result","subtype":"error_during_execution","result":"boom","is_error":true}')!
    expect(toTranscriptItems([ev])[0]).toMatchObject({ kind: 'result', isError: true })
  })
})
