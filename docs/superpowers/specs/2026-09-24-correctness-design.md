# Correctness & Lifecycle 设计

**日期**：2026-09-24
**状态**：设计阶段，待用户审阅
**Baseline**：tag `0.1.3`（commit `1097a34`）
**关联**：deep review 报告 finding #4, #5, #6, #9

## 1. 目标

修复 deep review 中 4 个 correctness/lifecycle finding，统一错误反馈体系 + 任务生命周期管理：

- **#4**：saveSettings 直接 `writeFileSync` → 断电丢全部设置
- **#5**：remove(id) 不取消 in-flight runner → 孤儿任务触发通知
- **#6**：bootstrap session pty data 首屏丢（renderer 还没 listener）
- **#9**：TranscriptView 错误被吞（IPC 失败显示"No output"）

## 2. 范围与非目标

### 本 spec 涉及
- 4 个 correctness finding
- 新增 `@shared/errors.ts`（错误分类 + 信息映射）
- 新增 `src/main/lifecycle/taskLifecycle.ts`（cancel + handshake）
- `src/main/store/settings.ts` 改 atomic 写
- `src/main/tasks/TaskService.ts` cancel 逻辑
- `src/main/index.ts` bootstrap handshake
- `src/main/ipc.ts` 加 `'sessions:ready'` handler
- `src/renderer/src/components/tasks/TranscriptView.tsx` 错误状态区分

### 不在本 spec
- 安全/性能/UX 类的 15 个 finding（Spec A/C/D 跟进）
- IPC 协议 surface 变更（#1 #2 已在 Spec A 改）

## 3. 关键决策

| 决策点 | 结论 | 备选与否决理由 |
|--------|------|----------------|
| 抽象中心 | `@shared/errors.ts` + `main/lifecycle.ts` | errors 跨 main+renderer 共享；lifecycle main 端专用 |
| #4 原子写 | `writeAtomic` from `fileStore.ts` 替换裸 `writeFileSync` | 已有 helper；不引入新抽象 |
| #5 cancel | `remove(id)` 调 `handle.kill()` + `active.delete(id)` + 'cancelled' 标记；finishRun 检测 cancelled 后不 notify | 历史保留 + 不误报 |
| #6 bootstrap | IPC handshake：renderer 发 `'sessions:ready'` 后 main 才创建 bootstrap session | 简单；IPC 协议加一个新 invoke |
| #9 错误区分 | TranscriptView 区分 `loaded`/`empty`/`error` 三态 | 不再 swallow error |
| IPC 协议 surface | 加 1 个新 invoke channel `'sessions:ready'` | 已有 channels.ts 模式 |

## 4. 文件结构

```
src/shared/
├── errors.ts           # 新：ErrorKind enum + userMessage map

src/main/
├── lifecycle/
│   └── taskLifecycle.ts # 新：cancelTask / isCancelled
├── store/
│   └── settings.ts     # 改：用 writeAtomic
├── tasks/
│   └── TaskService.ts  # 改：remove() cancel runner；finishRun 检查 cancelled
├── ipc.ts              # 改：sessions:ready handler
└── index.ts            # 改：defer bootstrap session to handshake

src/renderer/src/components/tasks/
└── TranscriptView.tsx  # 改：error vs empty state
```

## 5. 详细设计

### `@shared/errors.ts`

```ts
export const ErrorKind = {
  SettingsIoFailure: 'settings.io_failure',
  TranscriptLoadFailed: 'transcript.load_failed',
  TaskCancelled: 'task.cancelled'
} as const
export type ErrorKind = typeof ErrorKind[keyof typeof ErrorKind]

/** renderer 端 i18n key 映射（en/zh-CN keys） */
export const ERROR_MESSAGES: Record<ErrorKind, { en: string; zh: string }> = {
  'settings.io_failure': { en: 'Failed to save settings', zh: '保存设置失败' },
  'transcript.load_failed': { en: 'Failed to load transcript', zh: '加载 transcript 失败' },
  'task.cancelled': { en: 'Task cancelled', zh: '任务已取消' }
}
```

### `src/main/store/settings.ts` 改 atomic

```ts
import { writeAtomic } from './fileStore'

export function saveSettings(path: string, patch: Partial<AppSettings>): void {
  const merged = { ...loadSettings(path), ...patch }
  writeAtomic(path, merged)
}
```

### `src/main/lifecycle/taskLifecycle.ts`

```ts
const cancelledTasks = new Set<string>()

export function isCancelled(taskId: string): boolean {
  return cancelledTasks.has(taskId)
}

export function cancelTask(taskId: string): boolean {
  if (cancelledTasks.has(taskId)) return false
  cancelledTasks.add(taskId)
  return true
}

export function clearCancelled(taskId: string): void {
  cancelledTasks.delete(taskId)
}
```

### `src/main/tasks/TaskService.ts` remove() + finishRun 改

```ts
import { cancelTask, clearCancelled, isCancelled } from '../lifecycle/taskLifecycle'

remove(id: string): boolean {
  const before = this.tasks.length
  const t = this.tasks.find(x => x.id === id)
  if (!t) return false
  // 修复 #5：取消 in-flight runner
  cancelTask(id)
  const handle = this.active.get(id)
  if (handle) {
    handle.kill()
    this.active.delete(id)
  }
  this.tasks = this.tasks.filter(x => x.id !== id)
  this.persist()  // 或 safePersist（已有）
  this.emit()
  return true
}

private finishRun(t, running, final) {
  const merged: RunRecord = { ...running, ...final, id: running.id, taskId: t.id }
  this.history = trimHistory(...)
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

> 注意：`finishRun` 被 `handle.promise.catch` 回调（在 `fire()` 内注册）。`cancelTask` 标记 set 后，`fire()` 完成时 `finishRun` 检查 `isCancelled(t.id)` 跳过 notify。

### `src/main/ipc.ts` 加 `sessions:ready` handler

```ts
import { INVOKE_CHANNELS, PUSH_CHANNELS } from '@shared/channels'

let bootstrapReady = false

ipcMain.handle(INVOKE_CHANNELS.app.sessionsReady, () => {
  if (bootstrapReady) return false  // already done
  bootstrapReady = true
  const initialCwd = homedir()
  const initial = sessions.create(initialCwd, 80, 24, deps.shellFor(initialCwd), false)
  activeSessionId = initial.id
  deps.onSessionCreated?.(initialCwd, initial.id)
  push(deps.getWindow(), PUSH_CHANNELS.sessionsChanged, undefined)
  push(deps.getWindow(), PUSH_CHANNELS.sessionCreated, initial)  // 新 push channel for new session
  return true
})
```

### `src/main/index.ts` 移除自动 bootstrap

读现有 `index.ts` L176-204 块，删除初始 `sessions.create(initialCwd, ...)`。改为：在 `app.whenReady` 末尾注册 `bootstrapReady` 标志（默认 false），不创建 session 直到 renderer 准备好。

### TranscriptView 错误状态

```ts
const [viewState, setViewState] = useState<'loading' | 'loaded' | 'empty' | 'error'>('loading')
const [errorMsg, setErrorMsg] = useState<string>('')

useEffect(() => {
  setViewState('loading')
  window.api.tasks.transcript({ taskId: run.taskId, runId: run.id })
    .then(items => {
      setItems(items)
      setViewState(items.length === 0 ? 'empty' : 'loaded')
    })
    .catch(err => {
      setErrorMsg(err.message)
      setViewState('error')
    })
}, [run.taskId, run.id])
```

UI：
- `loading`: 转圈
- `empty`: "No output"
- `error`: 红色 banner 显示错误信息（来自 `@shared/errors`）

### preload 暴露 sessionsReady

```ts
sessionsReady: (): Promise<boolean> => ipcRenderer.invoke(INVOKE_CHANNELS.app.sessionsReady, ...)
```

需要把 `app:sessionsReady` 加到 `INVOKE_CHANNELS.app`。同时 `sessionCreated` 加到 `PUSH_CHANNELS`（用于推新 session 详情）。

## 6. 测试策略

### 新增测试

`@shared/errors.test.ts`:
- ErrorKind enum 值稳定
- ERROR_MESSAGES 双语映射完整

`src/main/store/settings.test.ts`（新建）:
- saveSettings 写入文件后 read 回来内容一致
- saveSettings 写后文件存在、不存在 .tmp
- atomic: writeAtomic 中途进程被 kill 不应损坏 settings.json（用临时脚本模拟）

`src/main/lifecycle/taskLifecycle.test.ts`（新建）:
- cancelTask 标记 taskId
- isCancelled 检查正确
- clearCancelled 清除标记

`src/main/ipc.test.ts` 新增：
- sessions:ready 第一次调用创建 session 并返回 true
- sessions:ready 第二次调用返回 false（已 bootstrap）
- sessions:ready 在创建后 broadcast sessionsChanged

### TranscriptView 测试

需要 vitest + jsdom + react-testing-library（已配）:
- transcript fetch 成功 → viewState=loaded
- transcript fetch 返回 [] → viewState=empty
- transcript fetch 抛错 → viewState=error

## 7. 错误处理与边缘情况

| 场景 | 行为 |
|------|------|
| settings atomic 写中途崩溃 | tmp 残留，下次启动 safeLoad 读到 corrupt 备份；下次写入覆盖 |
| remove 已 finished 的 task | active 已无 handle，no-op；cancelTask 标记无副作用 |
| finishRun 在 cancelled 状态下不通知，但写 history | cancelled RunRecord 进 history，status='cancelled' |
| bootstrap session handshake 失败 | 用户不打开 app 到 ready 状态就没 session；不影响其他功能 |
| TranscriptView IPC 抛错 | 错误信息显示给用户，不显示 empty |

## 8. 风险与回滚

- **风险 1**：atomic 写与既有 saveSettings 不兼容（已用 schema 校验，但 writeAtomic JSON.stringify 可能有转义差异）
  - 缓解：既有 settings 持久化测试保留；只换 IO 实现
  - 回滚：saveSettings 还原裸 writeFileSync
- **风险 2**：bootstrap session 延迟导致首屏空白
  - 缓解：renderer hydrate() 后立即调 sessionsReady
  - 回滚：恢复 main 自动创建 + bootstrap handshake 移除
- **风险 3**：cancelled 状态影响历史统计
  - 缓解：cancelled RunRecord status='cancelled'，history filter 可区分
  - 回滚：cancelTask 移除

## 9. 实施完成定义（DoD）

- [ ] `@shared/errors.ts` + test 新文件
- [ ] `src/main/lifecycle/taskLifecycle.ts` + test 新文件
- [ ] saveSettings 用 writeAtomic
- [ ] remove() 取消 in-flight runner
- [ ] finishRun 检查 cancelled 后跳过 notify
- [ ] IPC `sessions:ready` handler + bootstrap handshake
- [ ] preload 暴露 sessionsReady
- [ ] TranscriptView 三态区分
- [ ] 全量测试通过（177 + 至少 12 新 = 189+）
- [ ] typecheck clean
- [ ] 没有发现新的 correctness regression

## 10. 调度

Phase 1（串行）：Task 1 — `@shared/errors.ts` + lifecycle.ts（无依赖）
Phase 2（并行）：Task 2 — saveSettings atomic + Task 3 — TaskService cancel + Task 4 — bootstrap handshake + Task 5 — TranscriptView 三态

## 11. 用户手动验证（merge 前可选）

1. 启动 → 立即看到 home terminal 首屏（不丢 zsh banner）
2. 改 settings 后立即 kill app → 重启 → settings 保留（断电保护）
3. 删除正在运行的任务 → 系统通知**不**显示完成
4. 点击 transcript 失败的任务 → 显示错误信息（不再是"No output"）