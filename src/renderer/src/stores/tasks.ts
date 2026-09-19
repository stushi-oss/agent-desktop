import { create } from 'zustand'
import type { RunRecord, ScheduledTask } from '@shared/types'

interface TaskState {
  tasks: ScheduledTask[]
  history: RunRecord[]
  _pendingMutations: number
  hydrate: () => Promise<void>
  refreshFromPush: (tasks: ScheduledTask[], history: RunRecord[]) => void
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  runNow: (id: string) => Promise<void>
  create: (input: Parameters<Window['api']['tasks']['create']>[0]) => Promise<ScheduledTask | null>
  update: (id: string, patch: Partial<Parameters<Window['api']['tasks']['update']>[1]>) => Promise<void>
  remove: (id: string) => Promise<void>
}

/**
 * Wraps a mutation in a guard that blocks incoming `refreshFromPush` broadcasts
 * while the mutation is in-flight. Prevents main process pushes (which may
 * reflect pre-mutation state) from clobbering the local optimistic update.
 */
async function withMutationGuard<T>(set: (fn: (s: TaskState) => Partial<TaskState>) => void, fn: () => Promise<T>): Promise<T> {
  set((s) => ({ _pendingMutations: s._pendingMutations + 1 }))
  try {
    return await fn()
  } finally {
    set((s) => ({ _pendingMutations: Math.max(0, s._pendingMutations - 1) }))
  }
}

export const useTaskStore = create<TaskState>()((set) => ({
  tasks: [],
  history: [],
  _pendingMutations: 0,
  hydrate: async () => {
    const [tasks, history] = await Promise.all([window.api.tasks.list(), window.api.tasks.history()])
    set({ tasks, history })
  },
  refreshFromPush: (tasks, history) =>
    // Drop the push if a local mutation is in-flight; the next non-guarded push will land the latest state.
    set((s) => (s._pendingMutations > 0 ? s : { tasks, history })),
  setEnabled: async (id, enabled) => {
    await withMutationGuard(set, async () => {
      try { await window.api.tasks.setEnabled(id, enabled) }
      catch (e) { console.error('set task enabled failed', e) }
    })
  },
  runNow: async (id) => {
    await withMutationGuard(set, async () => {
      try { await window.api.tasks.runNow(id) }
      catch (e) { console.error('run task now failed', e) }
    })
  },
  create: async (input) => {
    return withMutationGuard(set, async () => {
      try { return await window.api.tasks.create(input) }
      catch (e) { console.error('create task failed', e); return null }
    })
  },
  update: async (id, patch) => {
    await withMutationGuard(set, async () => {
      try { await window.api.tasks.update(id, patch) }
      catch (e) { console.error('update task failed', e) }
    })
  },
  remove: async (id) => {
    await withMutationGuard(set, async () => {
      try { await window.api.tasks.remove(id) }
      catch (e) { console.error('remove task failed', e) }
    })
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
