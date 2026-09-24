// src/main/lifecycle/taskLifecycle.ts
const cancelledTasks = new Set<string>()

export function cancelTask(taskId: string): boolean {
  if (cancelledTasks.has(taskId)) return false
  cancelledTasks.add(taskId)
  return true
}

export function isCancelled(taskId: string): boolean {
  return cancelledTasks.has(taskId)
}

export function clearCancelled(taskId: string): void {
  cancelledTasks.delete(taskId)
}