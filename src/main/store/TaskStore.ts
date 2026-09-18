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
  const tasksR = readJson<ScheduledTask[]>(join(storeDir, 'tasks.json'))
  if (!tasksR.ok && tasksR.reason === 'corrupt') {
    const bak = backupCorrupt(join(storeDir, 'tasks.json'))
    console.warn(`[store] tasks.json corrupted, backed up to ${bak}`)
  }
  const historyR = readJson<RunRecord[]>(join(storeDir, 'history.json'))
  if (!historyR.ok && historyR.reason === 'corrupt') {
    const bak = backupCorrupt(join(storeDir, 'history.json'))
    console.warn(`[store] history.json corrupted, backed up to ${bak}`)
  }
  return {
    tasks: tasksR.ok && Array.isArray(tasksR.data) ? tasksR.data : [],
    history: historyR.ok && Array.isArray(historyR.data) ? trimHistory(historyR.data) : []
  }
}

export function saveTasks(storeDir: string, tasks: ScheduledTask[]): void {
  writeAtomic(join(storeDir, 'tasks.json'), tasks)
}

export function saveHistory(storeDir: string, history: RunRecord[]): void {
  writeAtomic(join(storeDir, 'history.json'), trimHistory(history))
}

export function trimHistory(history: RunRecord[], cap = HISTORY_CAP): RunRecord[] {
  return [...history].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, cap)
}

export function newId(): string {
  return randomUUID()
}
