import { create } from 'zustand'
import type { RunRecord, ScheduledTask } from '@shared/types'

interface TaskState {
  tasks: ScheduledTask[]
  history: RunRecord[]
  hydrate: () => Promise<void>
  refreshFromPush: (tasks: ScheduledTask[], history: RunRecord[]) => void
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  runNow: (id: string) => Promise<void>
  create: (input: Parameters<Window['api']['tasks']['create']>[0]) => Promise<ScheduledTask | null>
  update: (id: string, patch: Partial<Parameters<Window['api']['tasks']['update']>[1]>) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useTaskStore = create<TaskState>()((set) => ({
  tasks: [],
  history: [],
  hydrate: async () => {
    const [tasks, history] = await Promise.all([window.api.tasks.list(), window.api.tasks.history()])
    set({ tasks, history })
  },
  refreshFromPush: (tasks, history) => set({ tasks, history }),
  setEnabled: async (id, enabled) => {
    await window.api.tasks.setEnabled(id, enabled)
  },
  runNow: async (id) => {
    await window.api.tasks.runNow(id)
  },
  create: async (input) => {
    try {
      return await window.api.tasks.create(input)
    } catch (e) {
      console.error('create task failed', e)
      return null
    }
  },
  update: async (id, patch) => {
    await window.api.tasks.update(id, patch)
  },
  remove: async (id) => {
    await window.api.tasks.remove(id)
  }
}))

export const selectRunningCount = (s: TaskState): number =>
  s.history.filter((r) => r.status === 'running').length

export const selectNextTask = (s: TaskState): ScheduledTask | null => {
  const due = s.tasks
    .filter((t) => t.enabled && t.nextRunAt)
    .sort((a, b) => a.nextRunAt!.localeCompare(b.nextRunAt!))
  return due[0] ?? null
}
