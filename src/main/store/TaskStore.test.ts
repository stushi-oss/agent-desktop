import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, existsSync, readdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeAtomic, readJson, backupCorrupt } from './fileStore'
import { loadStore, saveTasks, saveHistory, trimHistory, HISTORY_CAP } from './TaskStore'
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
  it('trimHistory 保留最新 HISTORY_CAP 条（按 startedAt 倒序）', () => {
    const many: RunRecord[] = Array.from({ length: HISTORY_CAP + 30 }, (_, i) =>
      run(`r${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString())
    )
    const trimmed = trimHistory(many)
    expect(trimmed).toHaveLength(HISTORY_CAP)
    expect(trimmed[0].id).toBe(`r${HISTORY_CAP + 29}`)
    expect(trimmed.at(-1)!.id).toBe('r30')
  })
})
