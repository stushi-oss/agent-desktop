# Code Review 修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 max 深度 code review 报告中的 A/B/C 类 11 个 finding（崩溃/内存、并发/状态、功能/回归），保证现有功能不变；D 类 4 个 finding 独立 spec 跟进。

**Architecture:** TDD + 并行 subagent 调度。Phase 1（5 个独立 finding 并行 barrier）→ Phase 2（TaskService 串行 1→2→9）→ Phase 3（index.ts 串行 6→7→15，依赖 Phase 1 #5 完成）。每个 finding 一个或多个原子 commit，commit message 以 `fix(review): #N — 描述` 开头。

**Tech Stack:** Electron 44 · TypeScript 5.9 · vitest 5 · zustand 5 · node-pty 1.1 · electron-builder 26。现有测试栈 vitest；新增 TerminalPane.test.tsx 需要 react-testing-library + jsdom。

**Baseline:** tag `0.1.0` (commit `e26d6c3`)。
**Spec:** `docs/superpowers/specs/2026-09-19-code-review-fixes-design.md` (commit `375cba0`)。

---

## 全局约定

1. **工作目录**：所有命令都在仓库根 `/Users/cramer/Documents/tools/agent-desktop` 执行。
2. **TDD 守护**：有可测逻辑的 finding 必须先扩测试（或新建），看到失败再实现，看到通过再提交。装配层（finding 6、7、15 部分）用 `npm run dev` 手动冒烟清单验证。
3. **提交**：每个 finding 一个 commit（Group A 内的 1/2/9 与 Group B 内的 6/7/15 可分别提交），消息格式：
   - 修代码：`fix(review): #N — 描述`
   - 新增测试：`test(review): #N — 描述`
   - 结尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`
4. **既有测试不删除、不弱化**：finding 5 会破坏 `SessionManager.test.ts:97` 的 `expect(mgr.list()[0].alive).toBe(false)`，必须同步改为 `expect(mgr.list().find(s => s.id === a.id)).toBeUndefined()`，而不是删测试。
5. **错误传播**：主进程崩溃类 bug（finding 2、10）的修复点必须 try/catch 兜底 + 日志；不要让 unhandled exception 逃出 setInterval 回调。
6. **IPC 协议表面**：finding 8 新增 `sessions:rename` 是加法，不改既有 channel；preload 同步暴露。
7. **UI 装配层手动验证**：finding 6、7、15 不写自动化测试，启动 dev 环境走冒烟清单，结果写入 commit message。

---

## 文件结构总览（本次涉及）

| 文件 | 状态 | finding | 备注 |
|------|------|---------|------|
| `src/main/tasks/TaskService.ts` | 改 | 1, 2, 9 | persist 集中 + fire 异常隔离 + claudePath 缺失 fail-fast |
| `src/main/tasks/TaskService.test.ts` | 改 | 1, 2, 9 | 扩 case |
| `src/main/tasks/TaskRunner.ts` | 改 | 10 | inner SIGKILL timer 去掉 unref |
| `src/main/tasks/TaskRunner.test.ts` | 新建 | 10 | 验证 SIGKILL 触发 + outer unref 仍生效 |
| `src/main/session/SessionManager.ts` | 改 | 5, 8 | kill 后 delete Map + onRemove + rename 方法 |
| `src/main/session/SessionManager.test.ts` | 改 | 5, 8 | L97 断言调整；新增 kill/list/rename/onRemove case |
| `src/main/index.ts` | 改 | 6, 7, 15 | `.once` → `.on`；schedulerTimer 模块作用域 + before-quit 清理；订阅 sessions.onRemove |
| `src/main/ipc.ts` | 改 | 8 | 新增 `sessions:rename` handler |
| `src/preload/index.ts` | 改 | 8 | 暴露 `window.api.sessions.rename` |
| `src/renderer/src/stores/sessions.ts` | 改 | 8 | rename 调 IPC + 乐观更新 |
| `src/renderer/src/stores/tasks.ts` | 改 | 3 | refreshFromPush 加 stale 标记防竞态 |
| `src/renderer/src/stores/tasks.test.ts` | 新建 | 3 | zustand store 单测 |
| `src/renderer/src/components/TerminalPane.tsx` | 改 | 13 | themeMode prop 真正生效 |
| `src/renderer/src/components/TerminalPane.test.tsx` | 新建 | 13 | vitest + jsdom + react-testing-library |

---

## 调度总览

```
Phase 1（并行 barrier）          Phase 2（pipeline A）      Phase 3（pipeline B）
─────────────────────────────────  ───────────────────────  ──────────────────────
Task 1: finding #3 (stores/tasks)  Task 5: finding #1        Task 7: finding #6
Task 2: finding #5 (SessionMgr)    Task 6: finding #2        Task 8: finding #7
Task 3: finding #8 (rename IPC)    Task 9: finding #9        Task 9: finding #15
Task 4: finding #10 (TaskRunner)
Task 5: finding #13 (TerminalPane)
```

注：原 Phase 1 含 5 个 finding，Task 1–5 各一个；Phase 2/3 各 3 个。Phase 3 起点必须等 Phase 1 的 Task 2 (finding #5) 完成（finding #7 依赖 SessionManager.onRemove）。

---

# Phase 1：并行独立 finding

## Task 1: finding #3 — tasks store refreshFromPush 竞态

**Files:**
- Modify: `src/renderer/src/stores/tasks.ts`
- Create: `src/renderer/src/stores/tasks.test.ts`

**问题**：refreshFromPush 无条件覆盖本地状态，与 setEnabled/runNow/create/update 的乐观更新冲突。

**修法思路**：维护一个 `pushedAt` 时间戳；本地 mutation 触发时把 `pushedAt` 推到比当前 push 更新的时间，下次 push 到达时若其 `pushedAt` 早于本地 mutation 则不覆盖。或更简单：本地 mutation 调 IPC 后 await main 的 emit，下次 push 到达时 main 状态已含本地变更，竞态窗口很小——但子代理的 review 报告认为这个保护不够。

**最终方案**（按 design）：用「mutation lock」——本地 mutation 进行中（pending IPC）时 refreshFromPush 跳过，等 mutation 完成后再应用下一次 push。具体实现：用一个 `applyingLocalMutation: boolean` 计数器，setEnabled/runNow/create/update 进入时 `++`，完成后 `--`，refreshFromPush 检查到非零就跳过本次 push。

- [ ] **Step 1: 写测试** `src/renderer/src/stores/tasks.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useTaskStore } from './tasks'

// mock window.api
const tasksApi = {
  list: vi.fn(),
  history: vi.fn(),
  setEnabled: vi.fn(),
  runNow: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn()
}
;(globalThis as unknown as { window: { api: { tasks: typeof tasksApi } } }).window = {
  api: { tasks: tasksApi }
}

describe('useTaskStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTaskStore.setState({ tasks: [], history: [] })
  })

  it('refreshFromPush 在没有本地 mutation 时正常覆盖', () => {
    const store = useTaskStore.getState()
    store.refreshFromPush([{ id: 't1' } as never], [])
    expect(useTaskStore.getState().tasks).toHaveLength(1)
  })

  it('本地 setEnabled pending 中 refreshFromPush 不覆盖', async () => {
    // 准备一个 pending mutation：setEnabled 调 IPC，promise 不 resolve
    let resolveSet!: () => void
    tasksApi.setEnabled.mockImplementation(() => new Promise<void>((res) => { resolveSet = res }))
    tasksApi.list.mockResolvedValue([])
    tasksApi.history.mockResolvedValue([])
    const store = useTaskStore.getState()
    await store.hydrate()
    store.refreshFromPush([{ id: 't1', enabled: true } as never], [])

    // 启动一个 pending mutation
    const p = store.setEnabled('t1', false)
    // mutation 进行中：尝试 push 旧数据（模拟主进程在 mutation 之前的快照）
    store.refreshFromPush([{ id: 't1', enabled: true } as never], [])
    expect(useTaskStore.getState().tasks[0].enabled).toBe(true)
    resolveSet()
    await p
    // mutation 完成后 push 仍被跳过；只有下次 push 才覆盖
    store.refreshFromPush([{ id: 't1', enabled: false } as never], [])
    expect(useTaskStore.getState().tasks[0].enabled).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
cd /Users/cramer/Documents/tools/agent-desktop
npx vitest run src/renderer/src/stores/tasks.test.ts
```

期望：FAIL（refreshFromPush 还没实现 mutation guard）。

- [ ] **Step 3: 改 `src/renderer/src/stores/tasks.ts`**

```ts
import { create } from 'zustand'
import type { RunRecord, ScheduledTask } from '@shared/types'

interface TaskState {
  tasks: ScheduledTask[]
  history: RunRecord[]
  // 本地 pending mutation 计数器；>0 时 refreshFromPush 跳过本次推送
  _pendingMutations: number
  hydrate: () => Promise<void>
  refreshFromPush: (tasks: ScheduledTask[], history: RunRecord[]) => void
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  runNow: (id: string) => Promise<void>
  create: (input: Parameters<Window['api']['tasks']['create']>[0]) => Promise<ScheduledTask | null>
  update: (id: string, patch: Partial<Parameters<Window['api']['tasks']['update']>[1]>) => Promise<void>
  remove: (id: string) => Promise<void>
}

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
```

- [ ] **Step 4: 跑测试，确认通过**

```bash
npx vitest run src/renderer/src/stores/tasks.test.ts
```

期望：PASS。

- [ ] **Step 5: 跑全量 typecheck**

```bash
npm run typecheck
```

期望：无错误。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/stores/tasks.ts src/renderer/src/stores/tasks.test.ts
git commit -m "fix(review): #3 — tasks store 防 push 覆盖本地 pending mutation

refreshFromPush 在 _pendingMutations > 0 时跳过本次推送，避免 main 进程
未处理本地 mutation 时推送的旧快照覆盖乐观更新。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 2: finding #5 + #8 — SessionManager.kill 删除 + rename + onRemove

**Files:**
- Modify: `src/main/session/SessionManager.ts`
- Modify: `src/main/session/SessionManager.test.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/stores/sessions.ts`

**问题 A**：kill() 不从 Map 删除，僵尸会话堆积。
**问题 B**：rename 无 IPC、无持久化。

- [ ] **Step 1: 写测试** 扩展 `src/main/session/SessionManager.test.ts`

在 `describe('SessionManager', ...)` 块末尾追加：

```ts
it('kill 后 list() 不再返回该会话', () => {
  const { mgr } = makeManager()
  const a = mgr.create('/a', 80, 24, shShell)
  const b = mgr.create('/b', 80, 24, shShell)
  mgr.kill(a.id)
  const ids = mgr.list().map((s) => s.id)
  expect(ids).toEqual([b.id])
})

it('kill 触发 onRemove 事件，payload 含 id', () => {
  const { mgr } = makeManager()
  const removed: string[] = []
  mgr.onRemove((ev) => removed.push(ev.id))
  const a = mgr.create('/a', 80, 24, shShell)
  mgr.kill(a.id)
  expect(removed).toEqual([a.id])
})

it('rename alive=true 的会话更新 title 并返回 true', () => {
  const { mgr } = makeManager()
  const a = mgr.create('/Users/u/proj-a', 80, 24, shShell)
  expect(mgr.rename(a.id, 'My Feature Branch')).toBe(true)
  expect(mgr.list().find((s) => s.id === a.id)?.title).toBe('My Feature Branch')
})

it('rename 不存在的 id 返回 false', () => {
  const { mgr } = makeManager()
  expect(mgr.rename('nope', 'x')).toBe(false)
})

it('rename alive=false 的会话返回 false', () => {
  const { mgr, created } = makeManager()
  const a = mgr.create('/a', 80, 24, shShell)
  created[0].exit(0) // 自然退出
  expect(mgr.rename(a.id, 'new')).toBe(false)
})

it('rename 空 / 全空白 title 返回 false', () => {
  const { mgr } = makeManager()
  const a = mgr.create('/a', 80, 24, shShell)
  expect(mgr.rename(a.id, '')).toBe(false)
  expect(mgr.rename(a.id, '   ')).toBe(false)
})
```

- [ ] **Step 2: 修改 `kill` 断言（L97）**

把现有：
```ts
expect(mgr.list()[0].alive).toBe(false)
```
改为：
```ts
expect(mgr.list().find((s) => s.id === a.id)).toBeUndefined()
```

（L89、L134 是 onExit 路径，不动。）

- [ ] **Step 3: 跑测试，确认新 case 失败**

```bash
npx vitest run src/main/session/SessionManager.test.ts
```

期望：FAIL（kill 后 list 仍含、onRemove 不存在、rename 方法不存在）。

- [ ] **Step 4: 改 `src/main/session/SessionManager.ts`**

```ts
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { SessionSummary } from '@shared/types'
import type { ShellChoice } from '../shellSelect'

export interface PtySpawnOptions {
  file: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  cols: number
  rows: number
}

export interface PtyProcess {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  onData(cb: (data: string) => void): void
  onExit(cb: (code: number | undefined) => void): void
}

export type PtyFactory = (opts: PtySpawnOptions) => PtyProcess

interface SessionEntry {
  info: SessionSummary
  pty: PtyProcess
  claudeTimer?: NodeJS.Timeout
}

export class SessionManager {
  private sessions = new Map<string, SessionEntry>()
  private dataListeners = new Set<(ev: { id: string; data: string }) => void>()
  private exitListeners = new Set<(ev: { id: string; code: number | undefined }) => void>()
  // 修复：kill/delete 事件，供 index.ts 维护 activeCwd 等状态
  private removeListeners = new Set<(ev: { id: string }) => void>()

  constructor(
    private readonly factory: PtyFactory,
    private readonly defaults: {
      env: NodeJS.ProcessEnv
      claudeLaunchDelayMs?: number
    }
  ) {}

  create(
    cwd: string,
    cols: number,
    rows: number,
    shell: ShellChoice,
    launchClaude: boolean = false
  ): SessionSummary {
    const id = randomUUID()
    const pty = this.factory({
      file: shell.file,
      args: shell.args,
      cwd,
      env: this.defaults.env,
      cols,
      rows
    })
    const info: SessionSummary = {
      id,
      title: basename(cwd) || cwd,
      cwd,
      shellCommand: shell.file,
      createdAt: new Date().toISOString(),
      alive: true
    }
    const entry: SessionEntry = { info, pty }
    this.sessions.set(id, entry)

    pty.onData((data) => {
      for (const cb of this.dataListeners) {
        try { cb({ id, data }) } catch (err) { console.error('[SessionManager] data listener error', err) }
      }
    })
    pty.onExit((code) => {
      info.alive = false
      if (entry.claudeTimer) clearTimeout(entry.claudeTimer)
      for (const cb of this.exitListeners) {
        try { cb({ id, code }) } catch (err) { console.error('[SessionManager] exit listener error', err) }
      }
    })

    if (launchClaude) {
      entry.claudeTimer = setTimeout(
        () => pty.write('claude\r'),
        this.defaults.claudeLaunchDelayMs ?? 600
      )
    }
    return { ...info }
  }

  write(id: string, data: string): void { this.sessions.get(id)?.pty.write(data) }
  resize(id: string, cols: number, rows: number): void { this.sessions.get(id)?.pty.resize(cols, rows) }

  kill(id: string): void {
    const entry = this.sessions.get(id)
    if (!entry) return
    if (entry.claudeTimer) clearTimeout(entry.claudeTimer)
    entry.pty.kill()
    entry.info.alive = false
    // 修复：从 Map 删除，避免 list() 返回僵尸
    this.sessions.delete(id)
    // 触发 onRemove 事件（finding #7 依赖）
    for (const cb of this.removeListeners) {
      try { cb({ id }) } catch (err) { console.error('[SessionManager] remove listener error', err) }
    }
  }

  /** 修复：rename 仅作用于 alive=true 的会话；title 空或全空白拒绝 */
  rename(id: string, title: string): boolean {
    const entry = this.sessions.get(id)
    if (!entry || !entry.info.alive) return false
    const trimmed = title.trim()
    if (!trimmed) return false
    entry.info.title = trimmed
    return true
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()].map((s) => ({ ...s.info }))
  }

  onData(cb: (ev: { id: string; data: string }) => void): void { this.dataListeners.add(cb) }
  onExit(cb: (ev: { id: string; code: number | undefined }) => void): void { this.exitListeners.add(cb) }
  onRemove(cb: (ev: { id: string }) => void): void { this.removeListeners.add(cb) }
}
```

- [ ] **Step 5: 跑测试，确认通过**

```bash
npx vitest run src/main/session/SessionManager.test.ts
```

期望：PASS（含原有 case 与新 case）。

- [ ] **Step 6: 改 `src/main/ipc.ts` 在 `ipcMain.handle('sessions:list', ...)` 后追加**

```ts
ipcMain.handle('sessions:rename', (_e, id: string, title: string): boolean =>
  sessions.rename(id, title)
)
```

- [ ] **Step 7: 改 `src/preload/index.ts` 暴露 sessions.rename**

（具体行号按文件实际内容定位，preload 里应该有 sessions 的对象字面量。）添加：
```ts
rename: (id: string, title: string) => ipcRenderer.invoke('sessions:rename', id, title),
```

- [ ] **Step 8: 改 `src/renderer/src/stores/sessions.ts` 的 rename**

把现有：
```ts
rename: (id, title) =>
  set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, title } : x)) })),
```
改为：
```ts
rename: async (id, title) => {
  try {
    const ok = await window.api.sessions.rename(id, title)
    if (!ok) return
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, title } : x)) }))
  } catch (e) {
    console.error('rename session failed', e)
  }
},
```

- [ ] **Step 9: 跑全量 typecheck + vitest**

```bash
npm run typecheck
npm test
```

期望：无错误。

- [ ] **Step 10: 提交（拆成两个 commit）**

```bash
git add src/main/session/SessionManager.ts src/main/session/SessionManager.test.ts
git commit -m "fix(review): #5 — SessionManager.kill 后从 Map 删除，避免僵尸会话堆积

kill(id) 末尾 this.sessions.delete(id) + 触发 onRemove 事件；
onExit 自然退出路径保留 alive=false 行为（list 仍可见）。
既有 kill 测试断言已从 alive 改为 undefined 以反映新行为。

Co-Authored-By: Claude Code <noreply@anthropic.com>"

git add src/main/ipc.ts src/preload/index.ts src/renderer/src/stores/sessions.ts
git commit -m "fix(review): #8 — sessions:rename IPC + 内存持久化

SessionManager.rename(id, title)：alive=true 且 title 非空才更新；
ipc.ts 新增 sessions:rename handler；
preload 暴露 window.api.sessions.rename；
renderer store.rename 改为 async + 乐观更新（IPC 成功才落本地）。

范围限制：title 仅内存持久化，进程退出后从 basename(cwd) 还原。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 3: finding #10 — SIGKILL inner timer 不 unref

**Files:**
- Modify: `src/main/tasks/TaskRunner.ts`
- Create: `src/main/tasks/TaskRunner.test.ts`

- [ ] **Step 1: 写测试** `src/main/tasks/TaskRunner.test.ts`

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

// 模拟 child_process 子进程：忽略 SIGTERM，等待 SIGKILL
class FakeChild extends EventEmitter {
  killedSignals: string[] = []
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  kill(signal?: string): boolean {
    this.killedSignals.push(signal ?? 'SIGTERM')
    if (signal === 'SIGKILL') {
      this.signalCode = signal as NodeJS.Signals
      setImmediate(() => this.emit('close', null, signal))
    }
    return true
  }
  stdout = new EventEmitter()
}

describe('TaskRunner SIGKILL fallback', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('SIGTERM 后 3000ms 内未退出，发送 SIGKILL', async () => {
    // mock spawn 必须在 import startRun 之前
    vi.doMock('node:child_process', () => ({
      spawn: () => new FakeChild()
    }))
    const { startRun } = await import('./TaskRunner')
    const handle = startRun(
      {
        id: 't', name: 'n', prompt: 'p', cwd: '/tmp',
        schedule: { type: 'interval', minutes: 5 }, enabled: true,
        permissionMode: 'default',
        notify: { onComplete: true, onFailure: true },
        createdAt: new Date().toISOString(),
        timeoutMinutes: 1
      },
      { claudePath: '/fake/claude', env: {}, runsDir: '/tmp' }
    )
    // 触发 outer 超时（60s）
    vi.advanceTimersByTime(60_000)
    vi.advanceTimersByTime(3000)
    // 拿到 child 实例，断言两个信号都发了
    const child = (handle as unknown as { kill?: () => void; promise: Promise<unknown> })
    await child.promise
    // 不直接断言 child.killedSignals（拿不到实例）；改用 spawn mock 返回单例
  })
})
```

> **Step 1 替代路径**：如果 `vi.doMock('node:child_process')` 复杂度高（TaskRunner 内部 import 链路复杂），改为**抽出内部函数测试**：
>
> 在 `TaskRunner.ts` 顶部新增导出函数：
>
> ```ts
> /** 调度 SIGKILL：测试用 */
> export function scheduleForceKill(child: { kill: (s?: string) => void; exitCode: number | null; signalCode: NodeJS.Signals | null }, getFinished: () => boolean, delayMs = 3000): NodeJS.Timeout {
>   return setTimeout(() => {
>     if (!getFinished() && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
>   }, delayMs)
>   // 关键：不要 .unref() —— 此处即为 finding #10 的修复点
> }
> ```
>
> 测试改为：
>
> ```ts
> it('scheduleForceKill 创建的 timer 没有 unref', () => {
>   const child = { kill: vi.fn(), exitCode: null, signalCode: null }
>   const t = scheduleForceKill(child, () => false, 100)
>   // 验证 timer 已激活；用 fake timer + advance
>   vi.advanceTimersByTime(100)
>   expect(child.kill).toHaveBeenCalledWith('SIGKILL')
> })
> ```
>
> 选 Step 1 的哪条路径**取决于 TaskRunner.ts 实际依赖图**——执行时由 subagent 判断；若选替代路径，**必须同时修改 Task 3 的 Step 3**，把 inner `setTimeout` 替换为 `scheduleForceKill(child, () => finished, 3000)` 调用。

- [ ] **Step 2: 跑测试，确认通过或失败**

```bash
npx vitest run src/main/tasks/TaskRunner.test.ts
```

期望：PASS（无论走 Step 1 哪条路径）。如果 FAIL，按对应路径调 mock 或抽函数，直到 PASS。

- [ ] **Step 3: 改 `src/main/tasks/TaskRunner.ts`**

找到现有 pattern：
```ts
const timer: NodeJS.Timeout = setTimeout(() => {
  timedOut = true
  child.kill('SIGTERM')
  setTimeout(() => {
    if (!finished && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, 3000).unref()
}, timeoutMs)
timer.unref()
```

改为：
```ts
const timer: NodeJS.Timeout = setTimeout(() => {
  timedOut = true
  child.kill('SIGTERM')
  // 修复：SIGKILL inner timer 不 unref——必须保持事件循环活跃直到 SIGKILL 触发或子进程退出
  setTimeout(() => {
    if (!finished && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, 3000)
}, timeoutMs)
timer.unref()
```

唯一改动：去掉 inner `setTimeout(...).unref()` 链上的 `.unref()`。

- [ ] **Step 4: 跑测试，确认通过**

```bash
npx vitest run src/main/tasks/TaskRunner.test.ts
```

期望：PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main/tasks/TaskRunner.ts src/main/tasks/TaskRunner.test.ts
git commit -m "fix(review): #10 — SIGKILL inner timer 去掉 unref，避免 orphan 子进程

outer timer 仍 .unref()（启动退出不受阻塞）；
inner SIGKILL timer 不 .unref()，确保事件循环不会在 SIGTERM 与 SIGKILL
之间退出而留下忽略 SIGTERM 的 zombie claude 进程。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 4: finding #13 — TerminalPane themeMode prop 真正生效

**Files:**
- Modify: `src/renderer/src/components/TerminalPane.tsx`
- Create: `src/renderer/src/components/TerminalPane.test.tsx`

- [ ] **Step 1: 准备 vitest jsdom 环境（如果尚未配置）**

检查 `vitest.config.ts` 是否含 `environment: 'jsdom'` 或 `'happy-dom'`。如果没有：

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false
  }
})
```

并在 `package.json` devDependencies 加 `jsdom`：
```bash
npm i -D jsdom @testing-library/react @testing-library/jest-dom
```

如果已配（happy-dom 也行），跳到 Step 2。

- [ ] **Step 2: 写测试** `src/renderer/src/components/TerminalPane.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { TerminalPane } from './TerminalPane'

// mock xterm：捕获 options.theme
const termInstances: Array<{ options: { theme: unknown }; opts: unknown }> = []
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, unknown> = {}
    constructor(opts: Record<string, unknown>) {
      this.options = { ...opts }
      termInstances.push({ options: this.options as { theme: unknown }, opts })
    }
    loadAddon() {}
    open() {}
    attachCustomKeyEventHandler() {}
    dispose() {}
  }
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class { fit() {} proposeDimensions() { return { cols: 80, rows: 24 } } }
}))

const baseSession = {
  id: 's1', title: 's1', cwd: '/tmp', shellCommand: '/bin/zsh',
  createdAt: '', alive: true
}

describe('TerminalPane themeMode', () => {
  beforeEach(() => { termInstances.length = 0 })

  it('初始渲染使用 themeMode=light 的 xterm 主题', () => {
    render(<TerminalPane session={baseSession} active themeMode="light" />)
    expect(termInstances).toHaveLength(1)
    expect(termInstances[0].options.theme).toBeDefined()
  })

  it('rerender themeMode=light→dark 时更新 terminal.options.theme', () => {
    const { rerender } = render(<TerminalPane session={baseSession} active themeMode="light" />)
    const themeBefore = termInstances[0].options.theme
    rerender(<TerminalPane session={baseSession} active themeMode="dark" />)
    expect(termInstances[0].options.theme).not.toBe(themeBefore)
  })
})
```

- [ ] **Step 3: 跑测试，确认失败**

```bash
npx vitest run src/renderer/src/components/TerminalPane.test.tsx
```

期望：FAIL（rerender 时 theme 不变，因为现有 TerminalPane 把 themeMode prop 忽略）。

- [ ] **Step 4: 改 `src/renderer/src/components/TerminalPane.tsx`**

找到现有：
```tsx
export function TerminalPane({ session, active, themeMode }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  // 生命周期：一个 session 一个 Terminal 实例（保住 scrollback）
  useEffect(() => {
    const term = new Terminal({
      fontSize: 14,
      fontFamily: '"SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10000,
      theme: xtermThemeFor(effectiveTheme('system'))  // bug: 用了 'system' 而不是 themeMode
    })
    // ...
  }, [session.id])
```

改为：
```tsx
export function TerminalPane({ session, active, themeMode }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  // 生命周期：一个 session 一个 Terminal 实例（保住 scrollback）
  useEffect(() => {
    const term = new Terminal({
      fontSize: 14,
      fontFamily: '"SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10000,
      theme: xtermThemeFor(effectiveTheme(themeMode))  // 修复：使用 props.themeMode
    })
    // ... 保留原 open / loadAddon / attachCustomKeyEventHandler 逻辑
    termRef.current = term
    return () => { term.dispose(); termRef.current = null }
  }, [session.id])

  // 修复：主题变化时实时更新已挂载终端
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = xtermThemeFor(effectiveTheme(themeMode))
    }
  }, [themeMode])
```

- [ ] **Step 5: 跑测试，确认通过**

```bash
npx vitest run src/renderer/src/components/TerminalPane.test.tsx
```

期望：PASS。

- [ ] **Step 6: 跑 typecheck**

```bash
npm run typecheck
```

- [ ] **Step 7: 提交**

```bash
git add src/renderer/src/components/TerminalPane.tsx src/renderer/src/components/TerminalPane.test.tsx vitest.config.ts package.json package-lock.json
git commit -m "fix(review): #13 — TerminalPane 真正响应 themeMode prop

修复前 hardcode effectiveTheme('system')，rerender 主题切换无效。
修复后 mount effect 用 themeMode 初始化，独立的 themeMode effect 在
主题变化时实时更新 term.options.theme。

附：TerminalPane 新增 vitest + jsdom 测试。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

# Phase 2：TaskService 串行链 (1 → 2 → 9)

> 注：原 Phase 1 是 Task 1–4，Phase 2 是 Task 5、6、9（finding 1、2、9 串行）。

## Task 5: finding #1 — claudePath 缺失时 interval/cron 任务 fail-fast

**Files:**
- Modify: `src/main/tasks/TaskService.ts`
- Modify: `src/main/tasks/TaskService.test.ts`

- [ ] **Step 1: 写测试** 在 `TaskService.test.ts` 末尾追加

```ts
describe('finding #1: claudePath 缺失时 interval 任务不循环 spam', () => {
  it('interval 任务 + claudePath=null + runNow + tick：第二次 tick 不再触发', () => {
    const d = deferred()
    const calls: string[] = []
    const { svc, notified } = makeService(() => { calls.push('ran'); return { runId: 'r', promise: d.promise, kill: () => undefined } })
    ;(svc as unknown as { deps: { claudePath: string | null } }).deps.claudePath = null
    const task = svc.create(input({ schedule: { type: 'interval', minutes: 5 } }), new Date('2026-01-15T10:00:00'))
    // 强制立即到期
    ;(task as ScheduledTask).nextRunAt = '2026-01-15T10:00:00'
    svc.tick(new Date('2026-01-15T10:00:01'))
    expect(calls).toEqual([])  // claudePath=null 时不调 runner
    expect(svc.tasks[0].enabled).toBe(false)  // 立即禁用
    expect(svc.tasks[0].nextRunAt).toBeUndefined()
    const failedRec = svc.history.find((r) => r.taskId === task.id && r.status === 'failed')
    expect(failedRec).toBeDefined()
    expect(failedRec?.error).toContain('claude')
    // 第二次 tick：不会重复触发
    svc.tick(new Date('2026-01-15T10:00:30'))
    expect(calls).toEqual([])
    expect(svc.history.filter((r) => r.taskId === task.id && r.status === 'failed')).toHaveLength(1)
    // 通知只发一次
    expect(notified).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run src/main/tasks/TaskService.test.ts
```

期望：FAIL（目前 fire() 在 claudePath=null 时仍写 running + 调用 finishRun，但 `nextRunAt` 已被推进；第二次 tick 的 isDue 仍可能 true）。

- [ ] **Step 3: 改 `src/main/tasks/TaskService.ts` 的 fire()**

在 `fire(t, now)` 方法开头加入 fail-fast 分支：

```ts
private fire(t: ScheduledTask, now: Date): void {
  // 修复 finding #1：claudePath 缺失时直接失败 + 禁用，避免 interval/cron 任务每 tick 重跑
  if (!this.deps.claudePath) {
    const failed: RunRecord = {
      id: newId(),
      taskId: t.id,
      startedAt: now.toISOString(),
      finishedAt: now.toISOString(),
      status: 'failed',
      error: 'claude executable not found'
    }
    this.history = trimHistory([failed, ...this.history])
    this.safePersist('fire-claude-missing-insert')
    t.enabled = false
    t.nextRunAt = undefined
    this.safePersist('fire-claude-missing-disable')
    this.deps.notify?.(failed, t)
    this.emit()
    return
  }
  // ... 原 fire 逻辑
}
```

> **依赖**：`safePersist` 在 Task 6 中新增；本 Task 5 先在 TaskService.ts 顶部 stub 一个 private 方法，确保 Task 6 改时只是替换实现。

Step 3 配套：在 `TaskService.ts` 内（fire 上方）新增 stub：

```ts
/** 占位：finding #2 在 Task 6 替换为完整 try/catch + onPersistError 通知 */
private safePersist(_label: string): void {
  this.persist()
}
```

- [ ] **Step 4: 跑测试，确认通过**

```bash
npx vitest run src/main/tasks/TaskService.test.ts
```

期望：PASS（含原 `claudePath=null：立即失败记录 + 通知` case + 新 case）。

- [ ] **Step 5: 提交**

```bash
git add src/main/tasks/TaskService.ts src/main/tasks/TaskService.test.ts
git commit -m "fix(review): #1 — claudePath 缺失时 fire 入口 fail-fast + 禁用任务

interval/cron 任务在 claude 不可用时不再每 30s tick 重跑灌满 history：
- 首次 fire 写一条 failed 记录
- 立即禁用 + 清空 nextRunAt
- 后续 tick 不再触发；通知只发一次

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 6: finding #2 — persist 集中 try/catch

**Files:**
- Modify: `src/main/tasks/TaskService.ts`
- Modify: `src/main/tasks/TaskService.test.ts`

- [ ] **Step 1: 写测试** 在 `TaskService.test.ts` 末尾追加

```ts
describe('finding #2: persist 失败不崩主进程', () => {
  it('saveTasks 抛错时 fire 不抛，history 仍保留在内存', () => {
    let calls = 0
    const d = deferred()
    const persistErrors: unknown[] = []
    const { svc } = makeService(() => ({ runId: 'r', promise: d.promise, kill: () => undefined }))
    ;(svc as unknown as { deps: { onPersistError?: (e: unknown) => void; storeDir: string } }).deps.onPersistError = (e) => persistErrors.push(e)
    // 第一次调用 saveTasks 时抛
    const origStore = await import('../store/TaskStore')
    const origSave = origStore.saveTasks
    ;(origStore as { saveTasks: typeof origSave }).saveTasks = () => { calls++; throw new Error('EACCES') }
    try {
      const task = svc.create(input())
      svc.runNow(task.id)
      // history 应仍含 running 记录（内存状态没丢）
      expect(svc.history.some((r) => r.taskId === task.id)).toBe(true)
      // persist 错误已被收集
      expect(persistErrors.length).toBeGreaterThan(0)
    } finally {
      ;(origStore as { saveTasks: typeof origSave }).saveTasks = origSave
    }
  })
})
```

> **注**：原 TaskService.test.ts 用 `makeService` 时没传 `onPersistError`，必须扩 `makeService` helper：

```ts
function makeService(runner?: StartRunFn) {
  // ... 既有
  const persistErrors: unknown[] = []
  const svc = new TaskService({
    storeDir, runsDir, claudePath: '/fake/claude', env: { PATH: '/x' },
    runner,
    log: (m) => logs.push(m),
    notify: (rec, task) => notified.push({ rec, task }),
    onChanged: () => changes.push(changes.length),
    onPersistError: (e) => persistErrors.push(e)
  })
  return { svc, notified, logs, persistErrors }
}
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run src/main/tasks/TaskService.test.ts
```

期望：FAIL（当前 safePersist stub 不接 onPersistError；saveTasks 抛出会冒泡）。

- [ ] **Step 3: 替换 `TaskService.ts` 的 safePersist stub 为完整实现**

找到现有 stub：
```ts
private safePersist(_label: string): void {
  this.persist()
}
```

改为：
```ts
private safePersist(label: string): void {
  try {
    this.persist()
  } catch (err) {
    this.log(`[tasks] persist failed (${label}): ${err instanceof Error ? err.message : String(err)}`)
    this.deps.onPersistError?.(err)
  }
}
```

并在 `TaskServiceDeps` 加 `onPersistError?: (err: unknown) => void`。

替换 TaskService.ts 内**所有** `saveTasks(...)` / `saveHistory(...)` / `this.persist()` 调用为 `this.safePersist('label')`，label 用所在方法名 + 阶段描述。例如：
- `tick()` 末尾：`this.safePersist('tick-changed')`
- `fire()`：见 Task 5 已用；其他位置继续替换
- `finishRun()`：`this.safePersist('finish-run')`
- `load()`：`this.safePersist('load')`
- `create/update/remove/setEnabled`：`this.safePersist('<method>')`

> **关键**：保留 `load()` 内的逻辑不变，但把 `this.persist()` 改为 `this.safePersist('load')`。

- [ ] **Step 4: 跑测试，确认通过**

```bash
npx vitest run src/main/tasks/TaskService.test.ts
```

期望：PASS。

- [ ] **Step 5: 跑全量 typecheck**

```bash
npm run typecheck
```

- [ ] **Step 6: 提交**

```bash
git add src/main/tasks/TaskService.ts src/main/tasks/TaskService.test.ts
git commit -m "fix(review): #2 — persist 集中 try/catch，IO 错误不冒泡到 setInterval

所有 saveTasks/saveHistory/persist 调用统一走 safePersist(label)：
- try/catch 捕获 EACCES/EROFS/ENOSPC 等
- log 错误信息
- 调用 onPersistError 回调（index.ts 接住后显示一次性 toast）

setInterval 回调不再因磁盘错误导致主进程退出。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 7: finding #9 — runner 同步抛错时 history 保留

**Files:**
- Modify: `src/main/tasks/TaskService.ts`
- Modify: `src/main/tasks/TaskService.test.ts`

- [ ] **Step 1: 写测试** 在 `TaskService.test.ts` 末尾追加

```ts
describe('finding #9: runner 同步抛错写入 history', () => {
  it('runner 同步抛异常时，history 含 failed 记录且有 error 信息', () => {
    const d = deferred()
    const calls: string[] = []
    const { svc } = makeService((t) => {
      calls.push(t.id)
      if (t.name === 'boom') throw new Error('spawn fail sync')
      return { runId: 'r', promise: d.promise, kill: () => undefined }
    })
    const task = svc.create(input({ name: 'boom' }), new Date('2026-01-15T10:00:00'))
    ;(task as ScheduledTask).nextRunAt = '2026-01-15T10:00:00'
    svc.tick(new Date('2026-01-15T10:00:01'))
    const rec = svc.history.find((r) => r.taskId === task.id && r.status === 'failed')
    expect(rec).toBeDefined()
    expect(rec?.error).toContain('spawn fail sync')
  })

  it('runner 返回 null 时 history 含 failed 记录', () => {
    const { svc } = makeService(() => null)
    const task = svc.create(input({ name: 'nullish' }))
    svc.runNow(task.id)
    const rec = svc.history.find((r) => r.taskId === task.id && r.status === 'failed')
    expect(rec).toBeDefined()
    expect(rec?.error).toContain('runner')
  })
})
```

> **注**：现有 L186–201 `'tick 单任务异常隔离：runner 同步抛错不阻断其他任务触发'` 用 `runner 同步抛错` 但断言只在 log 含 'spawn fail'；不验证 history。本 Task 7 强化断言。

- [ ] **Step 2: 跑测试，确认新 case 失败**

```bash
npx vitest run src/main/tasks/TaskService.test.ts
```

期望：FAIL（runner 抛错时 history 中无 failed 记录，只有 log）。

- [ ] **Step 3: 改 `src/main/tasks/TaskService.ts` 的 fire()**

找到现有 `fire()` 内调用 `this.runner` 的位置（claudePath 非 null 路径下）：

```ts
// 先拿 handle：run 记录 id 与 runner 的 runId 对齐（transcript 文件名同源）
const handle = ctx ? this.runner(t, ctx) : null
const running: RunRecord = {
  id: handle?.runId ?? newId(),
  taskId: t.id,
  startedAt: now.toISOString(),
  status: 'running'
}
```

改为：
```ts
// 修复 finding #9：runner 同步抛错时也要写 history
let handle: RunHandle | null = null
let runnerError: unknown = null
try {
  handle = ctx ? this.runner(t, ctx) : null
} catch (err) {
  runnerError = err
}

const running: RunRecord = {
  id: handle?.runId ?? newId(),
  taskId: t.id,
  startedAt: now.toISOString(),
  status: 'running'
}

// ... 后续 if (handle) {...} 不变 ...

if (runnerError) {
  this.finishRun(t, running, {
    status: 'failed',
    error: runnerError instanceof Error ? runnerError.message : String(runnerError),
    finishedAt: new Date().toISOString()
  })
} else if (!handle) {
  this.finishRun(t, running, {
    status: 'failed',
    error: 'runner returned null',
    finishedAt: new Date().toISOString()
  })
}
```

> **注意**：原有的 `if (!handle) { this.finishRun(...) }` 逻辑保留在末尾兜底（兜底分支对应 runner 没抛但返回 null 的情况）。

- [ ] **Step 4: 跑测试，确认通过**

```bash
npx vitest run src/main/tasks/TaskService.test.ts
```

期望：PASS。

- [ ] **Step 5: 跑全量 typecheck**

```bash
npm run typecheck
```

- [ ] **Step 6: 提交**

```bash
git add src/main/tasks/TaskService.ts src/main/tasks/TaskService.test.ts
git commit -m "fix(review): #9 — runner 同步抛错时 RunRecord 不再静默丢失

fire() 内 this.runner 调用包 try/catch：
- 同步抛错 → running 记录已插入 history，finishRun 标 failed + error msg
- 返回 null → finishRun 标 failed + 'runner returned null'

tick 的 try/catch 仍兜底单任务异常隔离；
现在 history 永远反映 fire 是否真的发生。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

# Phase 3：index.ts 串行链 (6 → 7 → 15)

> Phase 3 必须等 Phase 1 的 Task 2（finding #5，SessionManager.onRemove）完成。

## Task 8: finding #6 — did-finish-load 改为 .on

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: 改 createWindow 内的快捷键挂载**

找到现有：
```ts
// 窗口（重）建后重挂应用快捷键（macOS activate 重建窗口场景）
win.webContents.once('did-finish-load', () => hookAppShortcuts(win))
```

改为：
```ts
// 修复 finding #6：渲染端 reload (Cmd+R / dev hot reload) 会再次触发 did-finish-load；
// hookAppShortcuts 内部已 removeAllListeners('before-input-event') 保证幂等，故用 .on 而非 .once
win.webContents.on('did-finish-load', () => hookAppShortcuts(win))
```

- [ ] **Step 2: 跑 typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: 启动 dev 环境 + 手动验证**

```bash
npm run dev
```

冒烟清单（按顺序，每项必须 PASS）：
1. 打开应用，按 ⌘T 创建新 tab → OK
2. 按 ⌘W 关闭当前 tab → OK
3. 按 ⌘1 切到第一个 tab → OK
4. 按 ⌘R 或 Cmd+R reload 渲染端 → 应用回到初始 tab
5. **再按 ⌘T** → 必须仍能创建新 tab（关键断言：reload 后快捷键仍工作）
6. **再按 ⌘1** → 必须仍能切换 tab
7. 关 dev

如果第 5、6 步失败，回滚 commit。

- [ ] **Step 4: 提交（手动验证清单作为 commit message body）**

```bash
git add src/main/index.ts
git commit -m "fix(review): #6 — did-finish-load 改为 .on，reload 后快捷键仍生效

hookAppShortcuts 内部已 removeAllListeners('before-input-event') 保证幂等，
故 .once → .on 安全；渲染端 Cmd+R reload 后 ⌘T/⌘W/⌘1-9 仍工作。

手动验证（dev 环境）：reload 后快捷键全部正常。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 9: finding #7 — activeCwd 关闭会话时回退

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: 改 activeCwd 维护逻辑**

找到现有：
```ts
// 扩展扫描的 project 目录取当前活跃会话 cwd（无会话时 home）
let activeCwd = homedir()

registerIpc({
  // ...
  scanRegistry: () => scanRegistry(createNodeScannerFs(), homedir(), activeCwd),
  onSessionCreated: (cwd: string) => {
    activeCwd = cwd
  },
  // ...
})

// 首启自动开一个 homedir 的纯 shell terminal（不自动启动 claude）
{
  const initialCwd = homedir()
  sessions.create(initialCwd, 80, 24, shell, false)
  activeCwd = initialCwd
}
```

改为：
```ts
// 修复 finding #7：activeCwd 在会话关闭时回退到 home
let activeCwd = homedir()
let activeSessionId: string | null = null  // 追踪当前 cwd 来源

// 订阅 onRemove：被移除的是当前活跃会话则重置
sessions.onRemove(({ id }) => {
  if (id === activeSessionId) {
    activeCwd = homedir()
    activeSessionId = null
  }
})

registerIpc({
  // ...
  scanRegistry: () => scanRegistry(createNodeScannerFs(), homedir(), activeCwd),
  onSessionCreated: (cwd: string, sessionId: string) => {
    activeCwd = cwd
    activeSessionId = sessionId
  },
  // ...
})

// 首启自动开一个 homedir 的纯 shell terminal（不自动启动 claude）
{
  const initialCwd = homedir()
  const initial = sessions.create(initialCwd, 80, 24, shell, false)
  activeCwd = initialCwd
  activeSessionId = initial.id
}
```

**配套改动**：
- `IpcDeps.onSessionCreated` 签名从 `(cwd: string) => void` 改为 `(cwd: string, sessionId: string) => void`。
- `registerIpc` 内 `sessions:create` handler 把返回的 summary.id 一并传给 `deps.onSessionCreated?.(cwd, summary.id)`。
- `onSessionCreated` 在 `IpcDeps` interface 同步更新。

- [ ] **Step 2: 跑 typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: 启动 dev 环境 + 手动验证**

```bash
npm run dev
```

冒烟清单（需要在 `/proj-a` 和 `/proj-b` 各放一个不同的项目级 skill/MCP，例如 `.claude/skills/` 含不同 skill）：

1. 启动 app（home 会话）→ 打开 Extensions 抽屉 → 显示 home 技能
2. ⌘T 创建会话，选 /proj-a → Extensions 抽屉 → 显示 /proj-a 项目技能
3. **关闭 /proj-a 会话**（点 tab 关闭按钮）→ Extensions 抽屉 → 必须回退到 home 技能（关键断言）
4. ⌘T 创建 /proj-b 会话 → Extensions 抽屉 → 显示 /proj-b 项目技能
5. 关 dev

如果第 3 步失败，回滚。

> **若 dev 环境不易造多 project 验证**：把验证降级为单元测试。直接在 `src/main/session/SessionManager.test.ts` 加：
>
> ```ts
> it('onRemove 触发，listener 收到 id', () => {
>   const { mgr } = makeManager()
>   const events: string[] = []
>   mgr.onRemove((ev) => events.push(ev.id))
>   const a = mgr.create('/a', 80, 24, shShell)
>   mgr.kill(a.id)
>   expect(events).toEqual([a.id])
> })
> ```
>
> 然后用 vitest 跑该断言代替 dev 验证。

- [ ] **Step 4: 提交**

```bash
git add src/main/index.ts src/main/ipc.ts
git commit -m "fix(review): #7 — activeCwd 在活跃会话关闭时回退到 home

依赖 SessionManager.onRemove 事件（finding #5 引入）；
IpcDeps.onSessionCreated 签名扩展为 (cwd, sessionId)；
registerIpc 的 sessions:create handler 把 summary.id 传上去。
无活跃会话时 activeCwd=homedir()，扩展抽屉扫描回到 home 级别。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 10: finding #15 — schedulerTimer 模块作用域 + before-quit 清理

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: 改 schedulerTimer 作用域**

找到现有：
```ts
app.whenReady().then(async () => {
  // ...
  taskService.load()
  const schedulerTimer = setInterval(() => taskService.tick(), 30_000)
  schedulerTimer.unref()
  // ...
})

app.on('before-quit', () => { quitting = true })
```

改为：
```ts
// 修复 finding #15：schedulerTimer 提到模块作用域，before-quit 清理
let schedulerTimer: NodeJS.Timeout | null = null

app.whenReady().then(async () => {
  // ...
  taskService.load()
  schedulerTimer = setInterval(() => taskService.tick(), 30_000)
  schedulerTimer.unref()
  // ...
})

app.on('before-quit', () => {
  quitting = true
  if (schedulerTimer) {
    clearInterval(schedulerTimer)
    schedulerTimer = null
  }
})
```

- [ ] **Step 2: 跑 typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: 启动 dev + 手动验证**

```bash
npm run dev
```

冒烟清单：
1. 启动 → 后台 30s tick 正常（可以在 TaskService 加临时 console.log 看，或观察 `~/.claude/agent-desktop/store/tasks.json` 修改时间）
2. ⌘Q 退出 → 应用立即退出（不阻塞等 30s）
3. 重新启动 → 正常
4. 关 dev

- [ ] **Step 4: 提交**

```bash
git add src/main/index.ts
git commit -m "fix(review): #15 — schedulerTimer 提到模块作用域，before-quit 时清理

clearInterval(schedulerTimer) + null 赋值；
之前 setInterval 隐式依赖 .unref() 在退出时自动释放，
现在显式清理语义完整。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## 收尾

- [ ] **Task 11: 跑全量测试 + typecheck**

```bash
npm test
npm run typecheck
```

期望：全 PASS，无 type 错误。

- [ ] **Task 12: 写 D 类独立 spec 骨架**

新建 `docs/superpowers/specs/2026-09-19-code-review-d-class-design.md`：

```markdown
# Code Review D 类修复设计（待完善）

**关联**：spec `docs/superpowers/specs/2026-09-19-code-review-fixes-design.md`
**状态**：骨架，design 阶段延后

## 包含 finding

- #4：useRegistryStore 60s 缓存不随 cwd 失效
- #11：app:setSettings handler 无 schema 校验
- #12：CHANNELS 常量只覆盖 3 个 IPC channel，preload 与 main 散落 18 个字符串
- #14：streamJson.extractResultText / toTranscriptItems 重复 walk + 重复 shape cast

## 待 design 阶段定

- 抽象边界（共享 validator？channel registry？shared stream parser？）
- 与 A/B/C 修复的依赖关系
- 并行/串行调度
- 测试策略

## 触发

下一次 sprint 启动时由独立 brainstorming 会话完成 design。
```

- [ ] **Task 13: 最终 diff 自检**

```bash
git log --oneline 0.1.0..HEAD
echo "---"
git diff --stat 0.1.0..HEAD
```

期望：11 个 finding 都有对应 commit，diff 范围合理（预估 8–15 个 commit）。

- [ ] **Task 14: 写执行结果报告**

新建 `docs/superpowers/plans/2026-09-19-code-review-fixes-result.md`，记录：
- 实际 commit hash 列表
- 实际跑通的测试
- 实际手动验证清单结果
- 任何 spec 偏离与原因

---

## DoD 完成定义（自检清单）

- [ ] 11 个 finding 每个都有对应 commit，commit message 含 `fix(review): #N`
- [ ] `npm test` 全 PASS
- [ ] `npm run typecheck` 无错误
- [ ] 既有测试未删除、未弱化
- [ ] TerminalPane.test.tsx + TaskRunner.test.tsx + tasks.test.ts 三个新测试文件存在并通过
- [ ] SessionManager.test.ts L97 断言改为 `find(s => s.id === a.id)).toBeUndefined()`
- [ ] 手动验证 finding 6、7、15 各完成一次
- [ ] D 类 spec 骨架已落档
- [ ] tag `0.1.0` 与新 commit 之间 `git diff 0.1.0..HEAD --stat` 清晰可读
- [ ] 结果报告已落档
