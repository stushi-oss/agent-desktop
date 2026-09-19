# Code Review 修复设计

**日期**：2026-09-19
**状态**：设计阶段，待用户审阅
**Baseline**：tag `0.1.0`（commit `e26d6c3`）
**关联 review**：max 深度 review 报告（15 个 finding）

## 1. 目标

修复 max 深度 review 中标注为 **A（崩溃/内存）、B（并发/状态正确性）、C（功能缺失/回归）** 三类的 11 个 finding，**D 类（重构/质量债）的 4 个 finding（4、11、12、14）独立 spec 跟进，本次不动**。

核心约束：

- **不破坏现有功能**：所有改动由 TDD 守护；无测试模块先写 characterization test 锁定现状。
- **并行 subagent 修复**：11 个 finding 分成 3 个串行链（同文件）+ 5 个独立 finding，串行链内部 pipeline，独立 finding 并行 barrier。
- **现有功能完全保留**：UI 行为、IPC 协议表面、磁盘格式不变。

## 2. 范围与非目标

### 2.1 本 spec 修复的 11 个 finding

| # | finding | 类别 | 文件 | 修复路径 |
|---|---------|------|------|---------|
| 1 | claudePath 缺失时 interval/cron 任务无限重跑 | A | `src/main/tasks/TaskService.ts:172` | fire 入口 fail-fast + 禁用 |
| 2 | persist/saveTasks 同步 IO 无 try/catch，主进程崩 | A | `src/main/tasks/TaskService.ts:58` | persist 集中 try/catch + 错误广播 |
| 5 | SessionManager.kill() 不删 Map，僵尸堆积 | A | `src/main/session/SessionManager.ts:115` | kill 末尾 `this.sessions.delete(id)` |
| 6 | `did-finish-load.once` 重载后快捷键失效 | C | `src/main/index.ts:66` | `.once` → `.on`（hookAppShortcuts 已幂等） |
| 7 | activeCwd 关闭会话永不回退 | B | `src/main/index.ts:152` | SessionManager 加 onRemoved 事件 |
| 8 | sessions.rename 无持久化 | C | `src/renderer/src/stores/sessions.ts:33` + IPC + SessionManager | 加 `sessions:rename` IPC |
| 9 | runner 同步抛异常时 RunRecord 静默丢失 | B | `src/main/tasks/TaskService.ts:166` | fire try/catch + 总是 push running |
| 10 | SIGKILL unref 导致 orphan 子进程 | A | `src/main/tasks/TaskRunner.ts:107` | 保留 timer.unref()，SIGKILL inner 不 unref |
| 13 | TerminalPane themeMode prop 被忽略 | C | `src/renderer/src/components/TerminalPane.tsx:12` | useEffect 依赖 themeMode |
| 15 | schedulerTimer 永不 clear | C | `src/main/index.ts:139` | 提到模块作用域 + before-quit 清掉 |

### 2.2 独立 spec 跟进的 D 类

finding 4（registry 缓存 60s 不随 cwd 失效）、11（setSettings 无 schema 校验）、12（CHANNELS 常量只覆盖 3 个）、14（streamJson 两个函数重复 walk）——属于重构/质量债，需要单独设计（影响范围跨多文件，需要单独的"先抽象再实施"过程），不在本 spec 范围。

### 2.3 根因备忘（来自 review notes，不在 15 finding 内但相关）

- `nextRunOf('once', pastDate)` 返回过去 Date 迫使三处补 disable 逻辑——本次不动（D 类之外，触及 schedule.ts 公共契约）。
- `validateInput`（main）和 `validateTaskForm`（renderer）重复——D 类。
- `runsDir = join(app.getPath('userData'), 'runs')` 在外置卷掉线时高概率崩溃——finding 2 的 try/catch 修法已覆盖。

## 3. 关键决策

| 决策点 | 结论 | 备选与否决理由 |
|--------|------|----------------|
| 修复粒度 | 按 finding 一一对应，最小 diff | 一次性大重构风险高、回滚难 |
| 串行 vs 并行 | 同文件 finding 串行；不同文件 finding 并行 | 串行最稳；并行省时间 |
| 测试策略 | TDD：先写 failing test 锁定 bug，再修 | 不加测试的修复会回归 |
| 无测试模块 | 先 characterization test，再修 | 不锁定现状就修 = 盲改 |
| kill 是否 delete Map | **是**（finding 5） | 否（保留 alive=false 给历史查询）违背 IPC list 语义 |
| claudePath 缺失时的任务行为 | fire 失败时 disable interval/cron | 保留循环让用户看到通知——已被 review 批为 spam |
| rename 持久化深度 | 仅内存（SessionManager 持有），重启从 basename(cwd) 还原 | 写盘（持久化 title 到 settings/sessions.json）改 IPC 协议表面，超范围 |
| 重命名 alive=false 会话 | 拒绝 | 死了的 tab 没意义；UX 一致 |
| 并行 subagent 隔离 | 不开 worktree（同文件串行已隔离，跨文件 diff 用 git apply 处理） | worktree 昂贵且本任务无并发写同一文件 |

## 4. 修复策略（按 finding）

### finding 1 — fire 入口 fail-fast

**问题**：interval/cron 任务 `claudePath=null` 时，每 30s tick 触发一次 fire，history 灌满失败记录。

**修法**（`src/main/tasks/TaskService.ts`）：

```ts
private fire(t: ScheduledTask, now: Date): void {
  if (!this.deps.claudePath) {
    // 永远不可能成功跑的任务：写一次失败历史并禁用，避免 interval/cron 循环 spam
    const failed: RunRecord = {
      id: newId(),
      taskId: t.id,
      startedAt: now.toISOString(),
      finishedAt: now.toISOString(),
      status: 'failed',
      error: 'claude executable not found'
    }
    this.history = trimHistory([failed, ...this.history])
    saveHistory(this.deps.storeDir, this.history)
    t.enabled = false
    t.nextRunAt = undefined
    saveTasks(this.deps.storeDir, this.tasks)
    this.deps.notify?.(failed, t)
    this.emit()
    return
  }
  // ... 原逻辑
}
```

**测试**：
- 既有 `TaskService.test.ts` 加 case：`claudePath=null` 启动 interval 任务 → 调用 tick() 一次 → enabled=false，history 含 1 条 failed，**不再有第二次 tick 触发**。
- 不破坏既有 `enabled=true` 走 startRun 的 case。

### finding 2 — persist 集中 try/catch

**问题**：saveTasks/saveHistory 裸调，EACCES/EROFS/ENOSPC 抛入 setInterval 回调 → Node "unhandled exception" → 主进程退出。

**修法**（`src/main/tasks/TaskService.ts`）：

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

替换所有 `saveTasks(...)` / `saveHistory(...)` / `this.persist()` 调用点为 `this.safePersist(label)`。

新增 deps：`onPersistError?: (err: unknown) => void`（index.ts 用它显示一次性通知，不让用户以为任务丢了）。

**测试**：
- mock `saveTasks` 抛 EACCES → fire 后 history 仍保留在内存、tick 继续、不抛。
- 验证 `onPersistError` 被调。

### finding 5 — kill 后 delete

**问题**：`SessionManager.kill` 不删 Map 键，list() 永远返回 alive=false 僵尸。

**修法**（`src/main/session/SessionManager.ts`）：

```ts
kill(id: string): void {
  const entry = this.sessions.get(id)
  if (!entry) return
  if (entry.claudeTimer) clearTimeout(entry.claudeTimer)
  entry.pty.kill()
  entry.info.alive = false
  // 修复：kill 后从 Map 删除，避免 list() 持续返回僵尸
  // onExit 回调可能在 delete 之后触发，但回调只读 info.alive 已经是 false，无副作用
  this.sessions.delete(id)
  // 触发移除事件，让上层（index.ts）更新 activeCwd（finding 7）
  for (const cb of this.removeListeners) {
    try { cb({ id }) } catch (err) { console.error('[SessionManager] remove listener error', err) }
  }
}
```

新增 `removeListeners: Set<(ev: { id: string }) => void>` + `onRemove(cb)` 方法。

**测试**：
- 既有 `SessionManager.test.ts` 加 case：`kill(id)` 后 `list()` 不含该 id；多次 kill 同 id 不抛。
- 验证 onExit 回调（mock pty 触发）后 Map 也清理。

### finding 6 — did-finish-load 改为 .on

**问题**：`.once('did-finish-load')` 被消费后渲染端 reload 失效。

**修法**（`src/main/index.ts:66`）：

```ts
// 修复：渲染端 reload (Cmd+R / dev hot reload) 会再次触发 did-finish-load；
// hookAppShortcuts 内部已 removeAllListeners('before-input-event') 保证幂等，故用 .on
win.webContents.on('did-finish-load', () => hookAppShortcuts(win))
```

**测试**：
- 此 finding 在 main/index.ts 顶层装配，**纯集成测试**——写 e2e 或 smoke test 太重。改为**手工验证 checklist**列入 docs/verification.md。

> **说明**：test plan 中明确：finding 6 的验证通过启动 dev 环境 + Cmd+R reload 后 ⌘T/⌘W/⌘1-9 仍工作来确认。

### finding 7 — activeCwd 在会话移除时回退

**问题**：`activeCwd` 只在 onSessionCreated 更新；关闭活跃会话后扩展抽屉仍显示旧 project 技能。

**修法**（依赖 finding 5 新增的 `onRemove`）：

```ts
// src/main/index.ts
sessions.onRemove(({ id }) => {
  if (activeCwd && /* 被移除的是当前活跃 cwd */) {
    activeCwd = homedir()
  }
})
```

判断"被移除的是当前活跃"：维护 `let activeCwdSource: string | null = null`，在 onSessionCreated 时存对应 sessionId；onRemove 时若 `id === activeCwdSource`，重置。

**测试**：
- SessionManager 新增 `onRemove` 单元测试（同 finding 5 一起加）。
- index.ts 层验证：通过渲染端 `kill` 一个会话 → `registry:scan` 返回 home 的 skills（手工 e2e 或在 task plan 中以 dev server smoke 形式验证）。

### finding 8 — sessions.rename IPC + 持久化到 SessionManager

**问题**：store.rename 只本地 set，重启后 title 丢失。

**修法**：

1. `SessionManager` 加方法：
   ```ts
   rename(id: string, title: string): boolean {
     const entry = this.sessions.get(id)
     if (!entry || !entry.info.alive) return false
     const trimmed = title.trim()
     if (!trimmed) return false
     entry.info.title = trimmed
     return true
   }
   ```

2. `ipc.ts` 加 handler：
   ```ts
   ipcMain.handle('sessions:rename', (_e, id: string, title: string): boolean =>
     sessions.rename(id, title)
   )
   ```

3. `preload/index.ts` 暴露 `sessions.rename(id, title)`。

4. store.rename 改为：
   ```ts
   rename: async (id, title) => {
     try {
       const ok = await window.api.sessions.rename(id, title)
       if (!ok) return
       set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, title } : x)) }))
     } catch (e) {
       console.error('rename session failed', e)
     }
   }
   ```

**测试**：
- SessionManager 新增 `rename` 单测：rename alive=true 的会话返回 true，title 更新；rename alive=false 返回 false；rename 不存在 id 返回 false；空 title 拒绝。
- ipc 集成：`sessions:rename` handler 调用成功。
- store：mock window.api.sessions.rename → set 触发。

> **范围限制**：title 仅内存持久化（进程退出后从 basename(cwd) 还原）。写盘会让 settings/sessions.json 多一个文件，超出"现有功能不变"约束。

### finding 9 — runner 异常也写入 history

**问题**：`this.runner(t, ctx)` 同步抛异常时 `running` 记录未创建、history 静默丢失。

**修法**（`src/main/tasks/TaskService.ts` `fire`）：

```ts
private fire(t: ScheduledTask, now: Date): void {
  // ... claudePath null check (finding 1)
  
  const ctx: RunContext = { claudePath: this.deps.claudePath!, env: this.deps.env, runsDir: this.deps.runsDir }
  
  let handle: RunHandle | null = null
  let runnerError: unknown = null
  try {
    handle = this.runner(t, ctx)
  } catch (err) {
    runnerError = err
  }
  
  const running: RunRecord = {
    id: handle?.runId ?? newId(),
    taskId: t.id,
    startedAt: now.toISOString(),
    status: 'running'
  }
  
  if (handle) {
    // 原 .then/.catch 链
  }
  
  this.history = trimHistory([running, ...this.history])
  this.safePersist('fire-insert')
  this.emit()
  
  t.nextRunAt = this.nextOf(t, now)
  
  if (runnerError) {
    this.finishRun(t, running, {
      status: 'failed',
      error: runnerError instanceof Error ? runnerError.message : String(runnerError),
      finishedAt: new Date().toISOString()
    })
  } else if (!handle) {
    // 兜底：handle 为 null 但 runnerError 为 null —— 理论上不可能，留兜底
    this.finishRun(t, running, { status: 'failed', error: 'runner returned null', finishedAt: new Date().toISOString() })
  }
}
```

**测试**：
- mock runner 同步抛 → fire 后 history 含 1 条 failed with error message。
- mock runner 返回 null → history 含 1 条 failed with 'runner returned null'。

### finding 10 — SIGKILL inner timer 不 unref

**问题**：outer timer unref 后，inner SIGKILL timer 也 unref → 事件循环可能在 SIGTERM 与 SIGKILL 之间退出，claude 变僵尸。

**修法**（`src/main/tasks/TaskRunner.ts:107`）：

```ts
const timer: NodeJS.Timeout = setTimeout(() => {
  timedOut = true
  child.kill('SIGTERM')
  // 修复：SIGKILL inner timer 不要 unref——必须保持事件循环活跃直到 SIGKILL 触发或子进程退出
  setTimeout(() => {
    if (!finished && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, 3000)
}, timeoutMs)
timer.unref()
```

**测试**：
- 现有 TaskRunner 测试覆盖不足，需新增 characterization test：构造一个忽略 SIGTERM 的 mock child（`process.kill` stub），验证 3000ms 后 SIGKILL 触发。
- 验证 outer timer.unref() 仍生效（用 fake timers 或 `setTimeout` spy）。

### finding 13 — TerminalPane 响应 themeMode

**问题**：props.themeMode 接收但 line 28 hardcode `'system'`，已挂载终端不响应主题切换。

**修法**（`src/renderer/src/components/TerminalPane.tsx`）：

```tsx
const { session, active, themeMode } = props  // 解构保留 themeMode

useEffect(() => {
  const term = new Terminal({
    // ...
    theme: xtermThemeFor(effectiveTheme(themeMode))  // 使用 props.themeMode
  })
  // ...
}, [session.id])  // 保持终端实例与 session 绑定

// 新增 effect：主题变化时实时更新
useEffect(() => {
  if (termRef.current) {
    termRef.current.options.theme = xtermThemeFor(effectiveTheme(themeMode))
  }
}, [themeMode])
```

**测试**：
- TerminalPane 当前无测试——加 characterization test：渲染 → 初始 theme = `xtermThemeFor(effectiveTheme('light'))`；rerender with themeMode='dark' → terminal.options.theme 更新。

### finding 15 — schedulerTimer 提到模块作用域 + before-quit 清掉

**问题**：setInterval 在 whenReady 内，永不 clear（虽然 `.unref()` 让退出不受阻，但语义上不完整）。

**修法**（`src/main/index.ts`）：

```ts
let schedulerTimer: NodeJS.Timeout | null = null

app.whenReady().then(async () => {
  // ...
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

**测试**：
- 此 finding 与 finding 6 同为装配层，无单测。**手工验证 checklist**：app.quit() 后 process exit 无残留 timer（看 dev console / lsof）。

## 5. 隔离与并行调度

### 5.1 依赖矩阵

| finding | 文件 | 冲突 | 备注 |
|---------|------|------|------|
| 1 | TaskService.ts | 与 2、9 同行 | fire/persist/finishRun 互嵌 |
| 2 | TaskService.ts | 与 1、9 同行 | persist try/catch 影响 fire 调用方 |
| 9 | TaskService.ts | 与 1、2 同行 | runner try/catch 在 fire 里 |
| 5 | SessionManager.ts | 独立 | |
| 6 | index.ts | 与 7、15 同行 | 都在 index.ts |
| 7 | index.ts | 与 6、15 同行 | 同上 |
| 15 | index.ts | 与 6、7 同行 | 同上 |
| 8 | IPC + SessionManager + store | 与 5 同文件（只加方法，不改 kill） | |
| 10 | TaskRunner.ts | 独立 | |
| 13 | TerminalPane.tsx | 独立 | renderer-only |

### 5.2 并行分组

- **Group A（TaskService 串行链）**：1 → 2 → 9。pipeline 调度。
- **Group B（index.ts 串行链）**：6 → 7 → 15。pipeline 调度。注：7 依赖 finding 5 新增的 `onRemove`，所以 B 必须等 5 完成才能起。**调整**：B 起点放 Group A 完成后开始（5 不属于 A 但完成度约束）。
- **Group C（独立并行）**：3（task store）、5、10、13 共 4 个独立 finding。parallel barrier。

> **修正**：finding 8 与 5 在 SessionManager 同文件，但 5 改 kill 末尾，8 加新方法 rename，**不冲突**——可以并行（同一 subagent 处理两个方法，或分两个 subagent 工作）。

最终调度：

```
          ┌──────────────┐
          │ Group A      │ pipeline(1 → 2 → 9) on TaskService
          └──────────────┘
                                ┌──────────────┐
                                │ Group B      │ pipeline(6 → 7 → 15) on index.ts (after #5 done)
                                └──────────────┘
parallel barrier ─┬─ 5 ─────────────────────────────────┐
                  ├─ 10 ────────────────────────────────┤
                  ├─ 13 ────────────────────────────────┤
                  ├─ 8 ────────────────────────────────┤
                  └─ 3 (renderer store, 独立于上面所有)──┘
```

最终执行顺序：
1. **Phase 1（先并行）**：5、10、13、3、8 — 5 个 subagent，每个 worktree 隔离。
2. **Phase 2（Group A pipeline）**：1 → 2 → 9 — 一个 subagent 顺序修 TaskService。
3. **Phase 3（Group B pipeline）**：6 → 7 → 15 — 一个 subagent 顺序修 index.ts（依赖 #5 onRemove 完成）。

### 5.3 subagent 协议

每个 subagent 收到：
- finding 编号
- 对应文件路径
- 期望的修法（design 第 4 节）
- 必须先写/扩展测试覆盖修法，测试运行通过才能 commit
- 输出：commit hash + 改了哪些行 + 新增/修改了哪些测试

### 5.4 不开 worktree

理由：串行链内部本来就顺序改同文件，开 worktree 反而引入 merge 成本。跨 subagent（5、10、13、3、8）改不同文件，文件锁天然隔离。**例外**：若 subagent 实操中发现冲突，回退到开 worktree。

## 6. 测试策略

### 6.1 现有测试（不动，作为回归基准）

- `src/main/env.test.ts`、`src/main/notifyText.test.ts`、`src/main/shellSelect.test.ts`
- `src/main/session/SessionManager.test.ts` ← 加 finding 5/8 case
- `src/main/tasks/schedule.test.ts`
- `src/main/tasks/streamJson.test.ts`
- `src/main/tasks/TaskService.test.ts` ← 加 finding 1/2/9 case
- `tests/integration/*`

### 6.2 新增 characterization test（按 finding）

| finding | 新测试文件 / 位置 | 覆盖 |
|---------|-------------------|------|
| 1 | `TaskService.test.ts` | claudePath=null 时 interval 任务 tick 一次即 disable |
| 2 | `TaskService.test.ts` | mock saveTasks throw，fire 不抛、history 保留 |
| 5 | `SessionManager.test.ts` | kill 后 list 不含 id；onExit 触发后 Map 清理 |
| 8 | `SessionManager.test.ts` + 新 store test | rename alive / not alive / empty title / 不存在 id |
| 9 | `TaskService.test.ts` | runner throw 同步、runner null |
| 10 | 新增 `TaskRunner.test.ts` | mock child 忽略 SIGTERM，3000ms 后 SIGKILL 触发；outer unref 仍生效 |
| 13 | 新增 `TerminalPane.test.tsx`（vitest + jsdom + react-testing-library） | themeMode 变化触发 term.options.theme 更新 |

### 6.3 手工验证 checklist

不写自动化测试但需手动确认：

- **finding 6**：dev 环境 Cmd+R reload 后 ⌘T/⌘W/⌘1-9 仍工作。
- **finding 7**：开一个 /proj-a 会话 → Extensions 抽屉显示 /proj-a 项目技能 → close → 重新打开 Extensions 抽屉 → 显示 home 技能。
- **finding 15**：app.quit() 后 `lsof` 看无残留 timer 句柄；dev console 无遗留。

## 7. 错误处理与边缘情况

| 场景 | 行为 |
|------|------|
| 任务文件写入失败（find 2） | log + onPersistError 通知，内存状态保留，下次 persist 重试 |
| runner 同步抛（find 9） | 写一条 failed RunRecord，task 保留 enabled（user 可重试） |
| SIGKILL 也无法 kill 的子进程（find 10） | inner timer 不 unref 保证 SIGKILL 触发；进程不响应 SIGKILL 仍会 zombie，但最少尝试过 |
| rename 死了的会话（find 8） | IPC 返回 false，store 不更新本地，console.error |
| kill 同 id 二次（find 5） | `this.sessions.get(id)` 已不存在，提前 return，无 throw |
| 重命名空 title / 全空格（find 8） | trim 后空，return false |

## 8. 风险与回滚

- **风险 1：fire 重构（1+9）影响所有任务触发路径**
  - 缓解：TaskService.test.ts 全量 case 跑过；手动验证创建一个 interval 任务观察一次正常 tick。
  - 回滚：`git revert <commit>`。

- **风险 2：index.ts 三连改（6+7+15）影响主进程装配**
  - 缓解：dev 环境启动 + Cmd+R reload + close+activate 流程跑通。
  - 回滚：`git revert <commits>`。

- **风险 3：subagent 写入同一文件但 git apply 冲突**
  - 缓解：所有同文件 finding 走同一个串行 subagent（pipeline）。
  - 回滚：单独 revert 该 subagent 产物。

## 9. 实施完成定义（DoD）

- [ ] 11 个 finding 每个都有对应 commit，commit message 含 `fix(review): #N`。
- [ ] 全部 vitest 单测通过：`npm test`。
- [ ] TypeScript typecheck 通过：`npm run typecheck`。
- [ ] 既有测试未删除/未弱化。
- [ ] 6.2 表中所有新测试覆盖到位。
- [ ] 6.3 手工 checklist 完成（finding 6、7、15）。
- [ ] D 类 4 个 finding（4、11、12、14）的后续 spec 骨架已起草（issue 清单或 stub spec），便于后续 sprint 接力——本次不要求完整 design，只登记位置。
- [ ] tag `0.1.0` baseline 与新 commit 之间 `git diff 0.1.0..HEAD` 清晰可读。
