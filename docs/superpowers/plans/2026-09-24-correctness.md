# Correctness & Lifecycle 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 deep review 4 个 correctness/lifecycle finding，统一错误反馈 + 任务生命周期。

**Architecture:** Phase 1 串行（@shared/errors + lifecycle.ts）+ Phase 2 四路并行（saveSettings atomic / TaskService cancel / bootstrap handshake / TranscriptView 三态）。

**Tech Stack:** Electron 44 · TypeScript 5.9 · vitest 5 · zod 4.6.5 (既有) · @testing-library/react (既有)。

**Baseline:** tag `0.1.3` (commit `1097a34`)。
Spec: `docs/superpowers/specs/2026-09-24-correctness-design.md` (commit `cecac5c`)。

---

## 全局约定

1. **工作目录**：所有命令都在 worktree `/Users/cramer/Documents/tools/agent-desktop/.worktrees/correctness` 执行。
2. **TDD**：先扩/写测试，看到失败再实现，看到通过再提交。
4. **既有测试不删除/不弱化**：177 baseline 必须保留。
5. **Branch 纪律**：所有改动在 `correctness` 分支，不动 main。

---

## 文件结构总览

| 文件 | 状态 | finding | 备注 |
|------|------|---------|------|
| `src/shared/errors.ts` | 新建 | (#9 主) | ErrorKind + ERROR_MESSAGES |
| `src/shared/errors.test.ts` | 新建 | #9 | enum + messages 测试 |
| `src/main/lifecycle/taskLifecycle.ts` | 新建 | #5 | cancelTask / isCancelled |
| `src/main/lifecycle/taskLifecycle.test.ts` | 新建 | #5 | cancel 状态机测试 |
| `src/main/store/settings.ts` | 改 | #4 | 用 writeAtomic |
| `src/main/store/settings.test.ts` | 新建 | #4 | atomic 写测试 |
| `src/main/tasks/TaskService.ts` | 改 | #5 | remove() + finishRun 跳过 notify |
| `src/shared/channels.ts` | 改 | #6 | 加 sessionsReady + sessionCreated |
| `src/main/ipc.ts` | 改 | #6 | sessions:ready handler |
| `src/main/ipc.test.ts` | 改 | #6 | handshake 测试 |
| `src/main/index.ts` | 改 | #6 | 移除自动 bootstrap |
| `src/preload/index.ts` | 改 | #6 | 暴露 sessionsReady |
| `src/renderer/src/components/tasks/TranscriptView.tsx` | 改 | #9 | 三态区分 |

---

## 调度

```
Phase 1（串行）          Phase 2（四路并行）
──────────────          ──────────────────────────────────────
Task 1: @shared/errors  Task 2: #4 saveSettings atomic
   + taskLifecycle      Task 3: #5 TaskService cancel
                        Task 4: #6 bootstrap handshake
                        Task 5: #9 TranscriptView 三态
```

---

# Phase 1：Task 1 — `@shared/errors.ts` + `main/lifecycle/taskLifecycle.ts`

## Task 1: 新建抽象层

**Files:**
- Create: `src/shared/errors.ts`
- Create: `src/shared/errors.test.ts`
- Create: `src/main/lifecycle/taskLifecycle.ts`
- Create: `src/main/lifecycle/taskLifecycle.test.ts`

### Step 1: 写 `src/shared/errors.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { ErrorKind, ERROR_MESSAGES } from './errors'

describe('@shared/errors', () => {
  it('ErrorKind enum 值稳定', () => {
    expect(ErrorKind.SettingsIoFailure).toBe('settings.io_failure')
    expect(ErrorKind.TranscriptLoadFailed).toBe('transcript.load_failed')
    expect(ErrorKind.TaskCancelled).toBe('task.cancelled')
  })

  it('ERROR_MESSAGES 双语映射完整', () => {
    for (const kind of Object.values(ErrorKind)) {
      expect(ERROR_MESSAGES[kind]).toBeDefined()
      expect(ERROR_MESSAGES[kind].en).toBeTypeOf('string')
      expect(ERROR_MESSAGES[kind].zh).toBeTypeOf('string')
    }
  })
})
```

### Step 2: 跑测试，确认失败

```bash
cd /Users/cramer/Documents/tools/agent-desktop/.worktrees/correctness
npx vitest run src/shared/errors.test.ts
```

### Step 3: 创建 `src/shared/errors.ts`

```ts
// src/shared/errors.ts

export const ErrorKind = {
  SettingsIoFailure: 'settings.io_failure',
  TranscriptLoadFailed: 'transcript.load_failed',
  TaskCancelled: 'task.cancelled'
} as const
export type ErrorKind = typeof ErrorKind[keyof typeof ErrorKind]

/** renderer 端 i18n key 映射（en/zh-CN） */
export const ERROR_MESSAGES: Record<ErrorKind, { en: string; zh: string }> = {
  'settings.io_failure': { en: 'Failed to save settings', zh: '保存设置失败' },
  'transcript.load_failed': { en: 'Failed to load transcript', zh: '加载 transcript 失败' },
  'task.cancelled': { en: 'Task cancelled', zh: '任务已取消' }
}
```

### Step 4: 跑测试，确认通过

```bash
npx vitest run src/shared/errors.test.ts
```

### Step 5: 写 `src/main/lifecycle/taskLifecycle.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { cancelTask, isCancelled, clearCancelled } from './taskLifecycle'

describe('taskLifecycle', () => {
  beforeEach(() => clearCancelled('t1'))

  it('cancelTask 标记 taskId', () => {
    expect(cancelTask('t1')).toBe(true)
    expect(isCancelled('t1')).toBe(true)
  })

  it('cancelTask 重复调用返回 false', () => {
    cancelTask('t1')
    expect(cancelTask('t1')).toBe(false)
  })

  it('clearCancelled 清除标记', () => {
    cancelTask('t1')
    clearCancelled('t1')
    expect(isCancelled('t1')).toBe(false)
  })

  it('isCancelled 默认 false', () => {
    expect(isCancelled('never-cancelled')).toBe(false)
  })
})
```

### Step 6: 跑测试，确认失败

```bash
npx vitest run src/main/lifecycle/taskLifecycle.test.ts
```

### Step 7: 创建 `src/main/lifecycle/taskLifecycle.ts`

```ts
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
```

### Step 8: 跑测试，确认通过

```bash
npx vitest run src/main/lifecycle/taskLifecycle.test.ts
```

### Step 9: 提交

```bash
git add src/shared/errors.ts src/shared/errors.test.ts \
        src/main/lifecycle/taskLifecycle.ts src/main/lifecycle/taskLifecycle.test.ts
git commit -m "fix(review): correctness — @shared/errors 抽象 + taskLifecycle

@shared/errors.ts：
- ErrorKind 枚举（SettingsIoFailure / TranscriptLoadFailed / TaskCancelled）
- ERROR_MESSAGES 双语映射（renderer i18n 用）

src/main/lifecycle/taskLifecycle.ts：
- cancelTask：标记 taskId 已取消，返回是否新标记
- isCancelled：检查 taskId 是否被取消
- clearCancelled：清除标记

后续 Task 5 finishRun 检查 cancelled 跳过 notify 依赖本模块。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

# Phase 2：四路并行

## Task 2: #4 — saveSettings atomic 写

**Files:**
- Modify: `src/main/store/settings.ts`
- Create: `src/main/store/settings.test.ts`

### Step 1: 写 `src/main/store/settings.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSettings, saveSettings, SETTINGS_DEFAULT } from './settings'

describe('saveSettings atomic', () => {
  let dir: string
  let path: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'settings-'))
    path = join(dir, 'settings.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('保存后 load 回来内容一致', () => {
    saveSettings(path, { theme: 'dark', closeToTray: true })
    const loaded = loadSettings(path)
    expect(loaded.theme).toBe('dark')
    expect(loaded.closeToTray).toBe(true)
  })

  it('保存后无 .tmp 残留文件', () => {
    saveSettings(path, { theme: 'light' })
    const files = require('node:fs').readdirSync(dir)
    expect(files.filter(f => f.includes('.tmp-')).length).toBe(0)
  })

  it('部分 patch 与既有 field 合并', () => {
    saveSettings(path, { theme: 'dark' })
    saveSettings(path, { closeToTray: true })  // 只 patch closeToTray
    const loaded = loadSettings(path)
    expect(loaded.theme).toBe('dark')  // theme 保留
    expect(loaded.closeToTray).toBe(true)
  })
})
```

### Step 2: 跑测试

```bash
npx vitest run src/main/store/settings.test.ts
```

期望：新建文件但 settings.ts 还没改 atomic，3 测试可能过也可能因为现有实现巧合过。

### Step 3: 改 `src/main/store/settings.ts`

```ts
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { writeAtomic } from './fileStore'
import type { AppSettings } from '@shared/types'

export const SETTINGS_DEFAULT: AppSettings = { theme: 'system', locale: 'system', closeToTray: false }

export function loadSettings(path: string): AppSettings {
  // 既有
}

export function saveSettings(path: string, patch: Partial<AppSettings>): void {
  const merged = { ...loadSettings(path), ...patch }
  writeAtomic(path, merged)  // ← 改：替换裸 writeFileSync
}

// resolveLocale 不变
```

### Step 4: 跑测试

```bash
npx vitest run src/main/store/settings.test.ts
```

### Step 5: 提交

```bash
git add src/main/store/settings.ts src/main/store/settings.test.ts
git commit -m "fix(review): #4 — saveSettings 用 writeAtomic 防断电丢设置

原 saveSettings 直接 writeFileSync，进程中断会截断 settings.json，
下次启动 loadSettings catch 静默返回 SETTINGS_DEFAULT，所有设置丢失。

修复：用 fileStore.writeAtomic（tmp + rename），writeFileSync 到
.tmp-<pid>-<ts> 然后 renameSync 到目标。原子性由 POSIX rename 保证，
进程 kill 不会损坏目标文件。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 3: #5 — TaskService remove() cancel

**Files:**
- Modify: `src/main/tasks/TaskService.ts`

### Step 1: 写测试

在 `src/main/tasks/TaskService.test.ts` 末尾追加：

```ts
describe('finding #5: remove() cancels in-flight runner', () => {
  it('remove 取消 active handle 不 notify', async () => {
    const d = deferred()
    const calls: string[] = []
    const { svc, notified } = makeService((t) => {
      calls.push(t.id)
      return { runId: 'r', promise: d.promise, kill: () => { calls.push('kill') } }
    })
    const task = svc.create(input())
    svc.runNow(task.id)
    expect(svc.isRunning(task.id)).toBe(true)
    
    // 用户删除任务
    expect(svc.remove(task.id)).toBe(true)
    expect(calls).toContain('kill')  // handle.kill 被调
    
    // 模拟 runner 完成（finishRun 应该被调）
    d.resolve({ id: 'r', status: 'success' })
    await settle()
    
    // 没有通知（cancelled）
    expect(notified).toHaveLength(0)
    // 但 history 仍有记录
    expect(svc.history.some(r => r.taskId === task.id)).toBe(true)
  })
})
```

### Step 2: 跑测试，确认失败

### Step 3: 改 `TaskService.ts`

```ts
import { cancelTask, clearCancelled, isCancelled } from '../lifecycle/taskLifecycle'

// 在 remove()：
remove(id: string): boolean {
  const before = this.tasks.length
  const t = this.tasks.find(x => x.id === id)
  if (!t) return false
  // 修复 #5：标记 cancelled + 取消 active runner
  cancelTask(id)
  const handle = this.active.get(id)
  if (handle) {
    handle.kill()
    this.active.delete(id)
  }
  this.tasks = this.tasks.filter(x => x.id !== id)
  this.safePersist('remove')
  this.emit()
  return true
}

// 在 finishRun()：
private finishRun(t: ScheduledTask, running: RunRecord, final: Partial<RunRecord>): void {
  const merged: RunRecord = { ...running, ...final, id: running.id, taskId: t.id }
  this.history = trimHistory(this.history.map((r) => (r.id === running.id ? merged : r)))
  this.safePersist('finish-run-history')
  // 修复 #5：cancelled 任务不通知
  if (!isCancelled(t.id)) {
    if (t.schedule.type === 'once') {
      t.enabled = false
      t.nextRunAt = undefined
    }
    this.safePersist('finish-run-tasks')
    this.deps.notify?.(merged, t)
  }
  clearCancelled(t.id)
  this.emit()
}
```

### Step 4: 跑测试

```bash
npx vitest run src/main/tasks/TaskService.test.ts
npx vitest run
npm run typecheck
```

### Step 5: 提交

```bash
git add src/main/tasks/TaskService.ts src/main/tasks/TaskService.test.ts
git commit -m "fix(review): #5 — remove(id) 取消 in-flight runner

原 remove(id) 仅从 this.tasks filter 掉任务，fire() 注册的 .then/.catch
链仍会触发 finishRun() → 用户删除后还看到\"任务完成\"通知。

修复：
- remove() 调 cancelTask(id) 标记 + handle.kill() + this.active.delete()
- finishRun 检查 isCancelled(t.id) 后跳过 notify + once schedule disable
- clearCancelled 清理标记

历史保留（孤儿 RunRecord），通知不触发。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 4: #6 — bootstrap handshake

**Files:**
- Modify: `src/shared/channels.ts`
- Modify: `src/shared/channels.test.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/main/ipc.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

### Step 1: 改 channels.ts 加 2 个 channel

```ts
export const INVOKE_CHANNELS = {
  // ... 既有
  app: {
    // ... 既有
    sessionsReady: 'app:sessionsReady'  // 新
  }
} as const

export const PUSH_CHANNELS = {
  // ... 既有
  sessionCreated: 'session:created'  // 新
} as const
```

### Step 2: 改 channels.test.ts

加 2 个断言。

### Step 3: 改 ipc.ts：sessions:ready handler

```ts
let bootstrapDone = false

ipcMain.handle(INVOKE_CHANNELS.app.sessionsReady, (): boolean => {
  if (bootstrapDone) return false
  bootstrapDone = true
  const initialCwd = homedir()
  const initial = sessions.create(initialCwd, 80, 24, deps.shellFor(initialCwd), false)
  deps.onSessionCreated?.(initialCwd, initial.id)
  push(deps.getWindow(), PUSH_CHANNELS.sessionsChanged, undefined)
  push(deps.getWindow(), PUSH_CHANNELS.sessionCreated, initial)
  return true
})
```

### Step 4: 改 ipc.test.ts

加 handshake 测试。

### Step 5: 改 index.ts：删除自动 bootstrap

读现有 `index.ts` L176-204 块（initial sessions.create 调用），删除：

```ts
// 删除：
{
  const initialCwd = homedir()
  const initial = sessions.create(initialCwd, 80, 24, shell, false)
  activeCwd = initialCwd
  activeSessionId = initial.id
}
```

替换为注释：bootstrap session 由 renderer 触发 `app:sessionsReady` 后由 ipc.ts 创建。

### Step 6: 改 preload/index.ts

```ts
sessionsReady: (): Promise<boolean> => ipcRenderer.invoke(INVOKE_CHANNELS.app.sessionsReady, ...)
```

### Step 7: 跑测试

```bash
npx vitest run
npm run typecheck
```

### Step 8: 提交

```bash
git add src/shared/channels.ts src/shared/channels.test.ts \
        src/main/ipc.ts src/main/ipc.test.ts src/main/index.ts src/preload/index.ts
git commit -m "fix(review): #6 — bootstrap session 改 IPC handshake

原 main 启动时立即创建 home session 并 spawn pty。renderer 在 hydrate()
前无 listener，Chromium IPC 无 replay — 首屏 zsh banner/prompt 丢。

修复：
- INVOKE_CHANNELS.app.sessionsReady 新 invoke
- PUSH_CHANNELS.sessionCreated 新 push
- main 删除自动 bootstrap session 创建块
- renderer hydrate() 后调 sessionsReady 触发 main 创建 + push session detail
- 第二次调用返回 false（已 bootstrap）

新增 2 channels + handler + preload 暴露。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 5: #9 — TranscriptView 三态

**Files:**
- Modify: `src/renderer/src/components/tasks/TranscriptView.tsx`

### Step 1: 写测试

`src/renderer/src/components/tasks/TranscriptView.test.tsx` (新)：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TranscriptView } from './TranscriptView'

let mockItems: any[] = []
let mockError: Error | null = null
const transcriptsApi = {
  transcript: vi.fn(async () => {
    if (mockError) throw mockError
    return mockItems
  })
}
const listeners: Array<() => void> = []
;(globalThis as unknown as { window: { api: { tasks: typeof transcriptsApi; onSessionsChanged: (cb: () => void) => () => void } } }).window = {
  api: {
    tasks: transcriptsApi,
    onSessionsChanged: (cb) => { listeners.push(cb); return () => {} }
  }
}

describe('TranscriptView 三态', () => {
  beforeEach(() => {
    mockItems = []
    mockError = null
    vi.clearAllMocks()
  })

  it('加载中显示 loading', () => {
    mockItems = []
    render(<TranscriptView run={{ taskId: 't1', id: 'r1' } as any} />)
    expect(screen.getByText(/loading/i)).toBeTruthy()
  })

  it('fetch 成功返回 [] → 显示 empty', async () => {
    mockItems = []
    render(<TranscriptView run={{ taskId: 't1', id: 'r1' } as any} />)
    await new Promise(r => setTimeout(r, 50))
    expect(screen.getByText(/no output/i)).toBeTruthy()
  })

  it('fetch 成功返回 items → 不显示 empty', async () => {
    mockItems = [{ kind: 'text', text: 'hello' }]
    render(<TranscriptView run={{ taskId: 't1', id: 'r1' } as any} />)
    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByText(/no output/i)).toBeNull()
  })

  it('fetch 抛错 → 显示 error 状态', async () => {
    mockError = new Error('failed')
    render(<TranscriptView run={{ taskId: 't1', id: 'r1' } as any} />)
    await new Promise(r => setTimeout(r, 50))
    expect(screen.getByText(/failed to load transcript/i)).toBeTruthy()
  })
})
```

### Step 2: 跑测试，确认失败

### Step 3: 改 `TranscriptView.tsx`

读现有实现，加 viewState state + 错误分支。

### Step 4: 跑测试

### Step 5: 提交

```bash
git commit -m "fix(review): #9 — TranscriptView 区分 error vs empty

原 fetch 失败时 .catch(() => setItems([])) swallow error，显示
\"No output\" 让用户误以为 model 没输出。

修复：三态 (loading/loaded/empty/error)；fetch 抛错时显示错误信息
（来自 @shared/errors ERROR_MESSAGES）。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## 收尾

- [ ] **Task 6: 全量测试**

```bash
npm test
npm run typecheck
```

期望：177 + 至少 12 = 189+ PASS；typecheck clean。

- [ ] **Task 7: 结果报告**

新建 `docs/superpowers/plans/2026-09-24-correctness-result.md`。

- [ ] **Task 8: merge to main + tag 0.1.4**

```bash
git checkout main
git merge --no-ff correctness
git tag -a 0.1.4 -m "v0.1.4 — Correctness & Lifecycle (4 finding)"
git branch -d correctness
git worktree remove ...
```

---

## DoD

- [ ] 4 finding 每个都有 commit
- [ ] 177+12 = 189+ PASS
- [ ] typecheck clean
- [ ] 既有测试保留
- [ ] tag 0.1.4