import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, existsSync, readdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeAtomic, readJson, backupCorrupt } from './fileStore'
import { loadStore, saveTasks, saveHistory, trimHistory, sortHistoryDesc, HISTORY_CAP } from './TaskStore'
import type { RunRecord, ScheduledTask } from '@shared/types'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ad-store-')) })

const task = (over: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id: 't1', name: 'n', prompt: 'p', cwd: '/tmp', schedule: { type: 'interval', minutes: 5 },
  enabled: true, permissionMode: 'default', timeoutMinutes: 30,
  notify: { onComplete: true, onFailure: true }, createdAt: '2026-01-01T00:00:00.000Z', ...over
})

const run = (id: string, startedAt: string, over: Partial<RunRecord> = {}): RunRecord => ({
  id, taskId: 't1', startedAt, status: 'success', ...over
})

describe('fileStore', () => {
  it('writeAtomic 写入可解析 JSON 且不残留 tmp 文件', () => {
    const p = join(dir, 'a.json')
    writeAtomic(p, { x: 1 })
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual({ x: 1 })
    expect(readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([])
  })
  it('writeAtomic 自动建父目录', () => {
    const p = join(dir, 'sub', 'b.json')
    writeAtomic(p, [1, 2])
    expect(existsSync(p)).toBe(true)
  })
  it('readJson：缺失 → missing；损坏 → corrupt；正常 → ok', () => {
    expect(readJson(join(dir, 'nope.json'))).toEqual({ ok: false, reason: 'missing' })
    const p = join(dir, 'bad.json')
    writeFileSync(p, '{not json', 'utf8')
    expect(readJson(p)).toEqual({ ok: false, reason: 'corrupt' })
    writeAtomic(p, { ok: true })
    expect(readJson<{ ok: boolean }>(p)).toEqual({ ok: true, data: { ok: true } })
  })
  it('backupCorrupt 生成 .corrupt- 副本', () => {
    const p = join(dir, 'bad.json')
    writeFileSync(p, 'xxx', 'utf8')
    const bak = backupCorrupt(p)
    expect(bak && existsSync(bak)).toBe(true)
  })
})

describe('TaskStore', () => {
  it('空目录 loadStore 返回空结构', () => {
    expect(loadStore(dir)).toEqual({ tasks: [], history: [] })
  })
  it('saveTasks/loadStore 往返一致', () => {
    const tasks = [task()]
    saveTasks(dir, tasks)
    expect(loadStore(dir).tasks).toEqual(tasks)
  })
  it('saveHistory/loadStore 往返一致', () => {
    const history = [run('r1', '2026-01-02T00:00:00.000Z'), run('r2', '2026-01-01T00:00:00.000Z')]
    saveHistory(dir, history)
    expect(loadStore(dir).history).toHaveLength(2)
  })
  it('损坏的 tasks.json 被备份并返回空', () => {
    writeFileSync(join(dir, 'tasks.json'), '{{{', 'utf8')
    const st = loadStore(dir)
    expect(st.tasks).toEqual([])
    expect(readdirSync(dir).some((f) => f.startsWith('tasks.json.corrupt-'))).toBe(true)
  })
  it('形状错误的 tasks.json（合法 JSON 非数组）被备份并返回空', () => {
    writeFileSync(join(dir, 'tasks.json'), '{"tasks": []}', 'utf8')
    const st = loadStore(dir)
    expect(st.tasks).toEqual([])
    expect(readdirSync(dir).some((f) => f.startsWith('tasks.json.corrupt-'))).toBe(true)
  })
  it('形状错误的 history.json（合法 JSON 非数组）被备份并返回空', () => {
    writeFileSync(join(dir, 'history.json'), '{"history": []}', 'utf8')
    const st = loadStore(dir)
    expect(st.history).toEqual([])
    expect(readdirSync(dir).some((f) => f.startsWith('history.json.corrupt-'))).toBe(true)
  })
  it('trimHistory slice 保留前 HISTORY_CAP 条（调用方保证降序输入）', () => {
    // 降序构造（fire prepend 的运行时形状）：r0 最新，r229 最旧
    const many: RunRecord[] = Array.from({ length: HISTORY_CAP + 30 }, (_, i) =>
      run(`r${i}`, new Date(Date.UTC(2026, 0, 1, 0, HISTORY_CAP + 29 - i)).toISOString())
    )
    const trimmed = trimHistory(many)
    expect(trimmed).toHaveLength(HISTORY_CAP)
    expect(trimmed[0].id).toBe('r0')
    expect(trimmed.at(-1)!.id).toBe(`r${HISTORY_CAP - 1}`)
  })
})

describe('trimHistory / sortHistoryDesc (#13)', () => {
  const rec = (id: string, at: string) => ({ id, taskId: 't', startedAt: at, status: 'success' as const })

  it('trimHistory 尊重 cap（slice 语义）', () => {
    const hist = [1, 2, 3, 4, 5].map((i) => rec(`r${i}`, `2026-01-0${i}T10:00:00`))
    const out = trimHistory(hist, 3)
    expect(out.map((r) => r.id)).toEqual(['r1', 'r2', 'r3'])
  })

  it('trimHistory 不排序（slice-only，乱序输入原样保留）', () => {
    const hist = [
      rec('new', '2026-01-05T10:00:00'),
      rec('old', '2026-01-01T10:00:00'),
      rec('mid', '2026-01-03T10:00:00')
    ]
    const out = trimHistory(hist, 3)
    expect(out.map((r) => r.id)).toEqual(['new', 'old', 'mid'])  // 原样，证明无 sort
  })

  it('sortHistoryDesc 降序排序', () => {
    const hist = [rec('a', '2026-01-02T10:00:00'), rec('b', '2026-01-03T10:00:00'), rec('c', '2026-01-01T10:00:00')]
    expect(sortHistoryDesc(hist).map((r) => r.id)).toEqual(['b', 'a', 'c'])
  })

  it('sortHistoryDesc 不修改原数组', () => {
    const hist = [rec('a', '2026-01-02T10:00:00'), rec('b', '2026-01-03T10:00:00')]
    sortHistoryDesc(hist)
    expect(hist.map((r) => r.id)).toEqual(['a', 'b'])
  })
})
