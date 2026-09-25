import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { RunRecord, ScheduledTask } from '@shared/types'
import { backupCorrupt, readJson, writeAtomic } from './fileStore'

export interface StoreData {
  tasks: ScheduledTask[]
  history: RunRecord[]
}

export const HISTORY_CAP = 200

export function loadStore(storeDir: string): StoreData {
  // 损坏或形状错误（合法 JSON 非数组）均备份后返回空，避免下次保存覆盖原始数据
  const loadArray = <T>(file: string): T[] => {
    const r = readJson<T[]>(join(storeDir, file))
    if (r.ok && Array.isArray(r.data)) return r.data
    if (!r.ok && r.reason === 'missing') return []
    const bak = backupCorrupt(join(storeDir, file))
    console.warn(`[store] ${file} corrupted or invalid shape, backed up to ${bak}`)
    return []
  }
  return {
    tasks: loadArray<ScheduledTask>('tasks.json'),
    // 磁盘数据不保证有序（旧版本写入/外部改动）：先排降序再 trim，
    // 否则乱序超 cap 时 slice 会按位置截掉真正最新的记录
    history: trimHistory(sortHistoryDesc(loadArray<RunRecord>('history.json')))
  }
}

export function saveTasks(storeDir: string, tasks: ScheduledTask[]): void {
  writeAtomic(join(storeDir, 'tasks.json'), tasks)
}

export function saveHistory(storeDir: string, history: RunRecord[]): void {
  writeAtomic(join(storeDir, 'history.json'), trimHistory(history))
}

/**
 * 运行时 trim：调用方保证降序不变式（fire prepend / finishRun 原位替换）。
 *
 * 失败模式：该不变式以单调时钟为前提——若 startedAt 出现时钟回拨/非单调
 * 写入，这里只按位置截断，不保证留下的恰好是时间上最新的 cap 条
 * （load 路径用 sortHistoryDesc 兜底；运行时不排序是 #13 的性能取舍）。
 */
export function trimHistory(history: RunRecord[], cap = HISTORY_CAP): RunRecord[] {
  return history.slice(0, cap)
}

/** load 路径专用：磁盘数据 + missed push 不保证有序，先排降序再 trim */
export function sortHistoryDesc(history: RunRecord[]): RunRecord[] {
  return [...history].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

export function newId(): string {
  return randomUUID()
}
