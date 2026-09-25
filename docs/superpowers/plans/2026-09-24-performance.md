# Performance 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 deep review 4 个 performance finding（#12 pty fanout / #13 trimHistory 冗余 sort / #14 events 无界累积 / #15 resize thrash），各自独立最小修复。

**Architecture:** Round 1 三路并行（Task 1 #12 / Task 2 #13 / Task 3 #14，不同文件）；Round 2 串行（Task 4 #15，与 Task 1 同改 TerminalPane）。IPC 协议 surface 不变。

**Tech Stack:** Electron 44 · TypeScript 5.9 · vitest 5 · @testing-library/react（既有）。

**Baseline:** tag `0.1.4` (commit `1f4e660`)。
Spec: `docs/superpowers/specs/2026-09-24-performance-design.md` (commit `05393dd`)。

---

## 全局约定

1. **工作目录**：所有命令都在 worktree `/Users/cramer/Documents/tools/agent-desktop/.worktrees/performance` 执行。
2. **TDD**：先写测试，看到失败再实现，看到通过再提交。
3. **提交**：每个 finding 一个 commit，消息 `fix(review): #N — 描述`，结尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
4. **并行纪律（强制）**：只 `git add <自己任务明确列出的文件>`；**禁止 `git add .` / `git add -A`**。commit 前 `git status` 确认没有并行 agent 的未提交文件混入——如有，只提交自己的路径。
5. **既有测试不删除/不弱化**：199 baseline 必须保留。
6. **Branch 纪律**：所有改动在 `performance` 分支，不动 main。

---

## 文件结构总览

| 文件 | 状态 | finding | 任务 |
|------|------|---------|------|
| `src/renderer/src/sessionDataBus.ts` | 新建 | #12 | Task 1 |
| `src/renderer/src/sessionDataBus.test.ts` | 新建 | #12 | Task 1 |
| `src/renderer/src/components/TerminalPane.tsx` | 改（订阅改 bus） | #12 | Task 1 |
| `src/main/store/TaskStore.ts` | 改 | #13 | Task 2 |
| `src/main/store/TaskStore.test.ts` | 改 | #13 | Task 2 |
| `src/main/tasks/TaskService.ts` | 改（load 排序） | #13 | Task 2 |
| `src/main/tasks/TaskService.test.ts` | 改（load 乱序 fixture） | #13 | Task 2 |
| `src/main/tasks/streamJson.ts` | 改 | #14 | Task 3 |
| `src/main/tasks/streamJson.test.ts` | 改（等价测试） | #14 | Task 3 |
| `src/main/tasks/TaskRunner.ts` | 改（数组→extractor） | #14 | Task 3 |
| `src/renderer/src/components/TerminalPane.tsx` | 改（rAF debounce） | #15 | Task 4（串行在 Task 1 后） |
| `src/renderer/src/components/TerminalPane.test.tsx` | 改（resize 去重测试） | #15 | Task 4 |

---

## 调度

```
Round 1（三路并行，文件互不相交）:
  Task 1 (#12): sessionDataBus + TerminalPane 订阅改造
  Task 2 (#13): TaskStore trimHistory + TaskService.load
  Task 3 (#14): streamJson extractor + TaskRunner

Round 2（串行，Task 1 完成后）:
  Task 4 (#15): TerminalPane syncSize rAF debounce
```

---

# Round 1

## Task 1: #12 — renderer 单订阅分发器

**Files（只 add 这些）:**
- Create: `src/renderer/src/sessionDataBus.ts`
- Create: `src/renderer/src/sessionDataBus.test.ts`
- Modify: `src/renderer/src/components/TerminalPane.tsx`

### Step 1: 读现有 TerminalPane 订阅代码

```bash
grep -n "onSessionData\|offData" src/renderer/src/components/TerminalPane.tsx
```

记录现有订阅形态（每个 pane 各自 `window.api.onSessionData` + JS filter id）与**隐藏 pane 时是否仍写入**的语义——分发器必须保持一致。

### Step 2: 写 `src/renderer/src/sessionDataBus.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerTerminal } from './sessionDataBus'

let listener: ((ev: { id: string; data: string }) => void) | null = null
const onSessionData = vi.fn((cb: (ev: { id: string; data: string }) => void) => {
  listener = cb
  return () => { listener = null }
})

beforeEach(() => {
  listener = null
  vi.clearAllMocks()
  ;(globalThis as unknown as { window: unknown }).window = {
    api: { onSessionData }
  }
})

describe('sessionDataBus', () => {
  it('首个注册建立唯一一次 onSessionData 订阅', () => {
    const off = registerTerminal('a', vi.fn())
    expect(onSessionData).toHaveBeenCalledTimes(1)
    off()
  })

  it('事件按 id 路由到对应 write，其他 write 不收到', () => {
    const writeA = vi.fn()
    const writeB = vi.fn()
    registerTerminal('a', writeA)
    registerTerminal('b', writeB)
    listener!({ id: 'a', data: 'hello' })
    expect(writeA).toHaveBeenCalledWith('hello')
    expect(writeB).not.toHaveBeenCalled()
  })

  it('注销后不再收到事件', () => {
    const write = vi.fn()
    const off = registerTerminal('a', write)
    off()
    listener!({ id: 'a', data: 'x' })
    expect(write).not.toHaveBeenCalled()
  })

  it('重复注册同 id 覆盖旧 write', () => {
    const w1 = vi.fn()
    const w2 = vi.fn()
    registerTerminal('a', w1)
    registerTerminal('a', w2)
    listener!({ id: 'a', data: 'x' })
    expect(w1).not.toHaveBeenCalled()
    expect(w2).toHaveBeenCalledWith('x')
  })
})
```

> **测试注意**：bus 是模块级单例（writers Map + off 变量），测试间状态会残留。若跨用例污染，把可重置内部状态导出 `_resetForTests()`（参照 `src/main/ipc.ts` 的既有做法）并在 beforeEach 调用。

### Step 3: 跑测试，确认失败

```bash
npx vitest run src/renderer/src/sessionDataBus.test.ts
```

### Step 4: 创建 `src/renderer/src/sessionDataBus.ts`

```ts
type WriteFn = (data: string) => void

const writers = new Map<string, WriteFn>()
let off: (() => void) | null = null

/**
 * 注册一个 terminal 的 write 回调。首个注册时建立全局唯一的
 * onSessionData 订阅，之后所有 pty chunk 只走这一次 listener，
 * 按 id 路由到对应 terminal（修复 N 个 pane = N 倍分发开销）。
 */
export function registerTerminal(id: string, write: WriteFn): () => void {
  if (!off) {
    off = window.api.onSessionData((ev) => {
      writers.get(ev.id)?.(ev.data)
    })
  }
  writers.set(id, write)
  return () => { writers.delete(id) }
}
```

### Step 5: 跑测试，确认通过

### Step 6: 改 `src/renderer/src/components/TerminalPane.tsx`

删除现有的每-pane 订阅（`window.api.onSessionData((ev) => { if (ev.id === session.id) term.write(ev.data) })` 形态，具体以 Step 1 读到的为准），替换为：

```ts
import { registerTerminal } from '@/sessionDataBus'

// mount effect 内，term 创建后：
const offBus = registerTerminal(session.id, (d) => term.write(d))

// cleanup 替换原 offData()：
return () => {
  offBus()
  // ...其余既有清理保留
}
```

**保持既有语义**：原代码对隐藏 pane 也写入 scrollback（无 offsetParent 判断）则分发器一致；若原有判断，保留等价判断。

### Step 7: 跑全量 + typecheck

```bash
npx vitest run
npm run typecheck
```

### Step 8: 提交（只 add 上面 3 个文件）

```bash
git add src/renderer/src/sessionDataBus.ts src/renderer/src/sessionDataBus.test.ts src/renderer/src/components/TerminalPane.tsx
git commit -m "fix(review): #12 — pty 数据单订阅分发器替代 N pane 广播

原每个 TerminalPane 各自订阅 session:data 并用 JS filter id，
N 个 pane 时每个 pty chunk 触发 N 次 listener 调用（N-1 次白跑）。
高吞吐输出（编译日志）下 renderer 开销随 pane 数线性放大。

新增 sessionDataBus：全局唯一一次 onSessionData 订阅 +
Map<id, write> 按 id 直达路由。IPC 协议 surface 不变。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 2: #13 — trimHistory 去 sort

**Files（只 add 这些）:**
- Modify: `src/main/store/TaskStore.ts`
- Modify: `src/main/store/TaskStore.test.ts`
- Modify: `src/main/tasks/TaskService.ts`
- Modify: `src/main/tasks/TaskService.test.ts`

### Step 1: grep trimHistory 全部调用点

```bash
grep -rn "trimHistory" src/
```

确认每个调用点的不变式状态（fire=prepend ✓、finishRun=原位替换 ✓、load=missed push 破坏降序 ✗、TaskStore.saveHistory=持久化时调用）。**注意 `saveHistory` 内部也调 trimHistory**——saveHistory 的调用方都是 TaskService 已维持降序的路径，slice-only 安全；但 load 路径的 missed push 在 saveHistory 之前必须已排序。

### Step 2: 写测试

`src/main/store/TaskStore.test.ts` 追加（先读现有结构）：

```ts
import { trimHistory, sortHistoryDesc } from './TaskStore'

describe('trimHistory / sortHistoryDesc (#13)', () => {
  const rec = (id: string, at: string) => ({ id, taskId: 't', startedAt: at, status: 'success' as const })

  it('trimHistory 尊重 cap（slice 语义，假定降序输入）', () => {
    const hist = [1, 2, 3, 4, 5].map((i) => rec(`r${i}`, `2026-01-0${i}T10:00:00`))
    const out = trimHistory(hist, 3)
    expect(out.map((r) => r.id)).toEqual(['r1', 'r2', 'r3'])
  })

  it('sortHistoryDesc 降序排序', () => {
    const hist = [rec('a', '2026-01-02T10:00:00'), rec('b', '2026-01-03T10:00:00'), rec('c', '2026-01-01T10:00:00')]
    const out = sortHistoryDesc(hist)
    expect(out.map((r) => r.id)).toEqual(['b', 'a', 'c'])
  })

  it('sortHistoryDesc 不修改原数组', () => {
    const hist = [rec('a', '2026-01-02T10:00:00'), rec('b', '2026-01-03T10:00:00')]
    sortHistoryDesc(hist)
    expect(hist.map((r) => r.id)).toEqual(['a', 'b'])
  })
})
```

`src/main/tasks/TaskService.test.ts` 在 load describe 追加乱序磁盘 fixture 测试：

```ts
it('load：磁盘尾部更早记录 + missed push 后仍降序（missed 排到正确位置）', () => {
  const { svc: seed } = makeService()
  seed.create(input(), new Date('2026-01-15T10:00:00'))
  const { svc } = makeService()
  // 直接构造乱序磁盘状态：头部最新，尾部混入更早的 missed 时刻
  svc.tasks = JSON.parse(JSON.stringify(seed.tasks)) as ScheduledTask[]
  ;(svc.tasks[0] as ScheduledTask).nextRunAt = '2026-01-15T09:30:00'
  svc.persist()
  const rebooted = new TaskService({ storeDir, runsDir, claudePath: '/fake/claude', env: {} })
  rebooted.load(new Date('2026-01-15T10:00:00'))
  const times = rebooted.history.map((r) => r.startedAt)
  const sorted = [...times].sort().reverse()
  expect(times).toEqual(sorted)  // 严格降序
})
```

### Step 3: 跑测试，确认失败（trimHistory 现在是 sort 版本，slice 断言会因输入已降序而碰巧过——用**乱序输入**到 trimHistory 才能证明 slice-only：补一个"乱序输入保持原样不排序"的断言）

```ts
it('trimHistory 不排序（slice-only，乱序输入原样保留）', () => {
  const hist = [rec('new', '2026-01-05T10:00:00'), rec('old', '2026-01-01T10:00:00'), rec('mid', '2026-01-03T10:00:00')]
  const out = trimHistory(hist, 3)
  expect(out.map((r) => r.id)).toEqual(['new', 'old', 'mid'])  // 原样
})
```

### Step 4: 改 `src/main/store/TaskStore.ts`

```ts
/** 运行时 trim：调用方保证降序不变式（fire prepend / finishRun 原位替换） */
export function trimHistory(history: RunRecord[], cap = HISTORY_CAP): RunRecord[] {
  return history.slice(0, cap)
}

/** load 路径专用：磁盘数据 + missed push 不保证有序，先排降序再 trim */
export function sortHistoryDesc(history: RunRecord[]): RunRecord[] {
  return [...history].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}
```

### Step 5: 改 `src/main/tasks/TaskService.ts` load()

在 missed push 循环之后、`this.history = trimHistory(this.history)` 之前插入：

```ts
import { sortHistoryDesc } from '../store/TaskStore'  // 加到既有 import

// missed 记录 push 到尾部破坏降序：一次性排序恢复不变式
this.history = sortHistoryDesc(this.history)
this.history = trimHistory(this.history)
```

### Step 6: 跑全量 + typecheck

### Step 7: 提交（只 add 4 个文件）

```bash
git add src/main/store/TaskStore.ts src/main/store/TaskStore.test.ts src/main/tasks/TaskService.ts src/main/tasks/TaskService.test.ts
git commit -m "fix(review): #13 — trimHistory 运行时去 sort，load 路径一次性排序

原 trimHistory 每次 [..].sort().slice() O(n log n)，fire/finishRun
每次 run 调 3+ 次，而运行时 history 由新到旧 prepend 天然降序，sort 冗余。

修复：
- trimHistory 改 slice-only（调用方保证降序不变式）
- 新增 sortHistoryDesc；TaskService.load 在 missed push 破坏降序后
  一次性排序恢复（磁盘尾记录早于 missed 时刻的场景）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 3: #14 — 流式 result extractor

**Files（只 add 这些）:**
- Modify: `src/main/tasks/streamJson.ts`
- Modify: `src/main/tasks/streamJson.test.ts`
- Modify: `src/main/tasks/TaskRunner.ts`

### Step 1: 写等价测试（streamJson.test.ts 追加）

```ts
import { createResultExtractor, extractResultText, parseEvents } from './streamJson'

describe('createResultExtractor 流式等价 (#14)', () => {
  const fixtures: string[] = [
    // 现有 extractResultText 测试的全部事件序列搬过来作为 raw 输入
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }),
    [JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'a' }] } }),
     JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'b' }] } }),
     JSON.stringify({ type: 'result', result: 'r' })].join('\n'),
    JSON.stringify({ type: 'result', result: 'only-result' }),
    [JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'pre' }] } }),
     JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }] } }),
     JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'post' }] } })].join('\n'),
    'not-json\n' + JSON.stringify({ type: 'result', result: 'x' })
  ]

  it.each(fixtures)('流式 feed 与批量 extract 输出一致: %s', (raw) => {
    const events = parseEvents(raw)
    const ex = createResultExtractor()
    for (const e of events) ex.feed(e)
    expect(ex.finish()).toBe(extractResultText(events))
  })

  it('空输入 finish 返回 undefined', () => {
    expect(createResultExtractor().finish()).toBeUndefined()
  })
})
```

### Step 2: 跑测试，确认失败（createResultExtractor 不存在）

### Step 3: 改 `src/main/tasks/streamJson.ts`

新增（紧邻 extractResultText），并把 extractResultText 重写为复用：

```ts
export interface ResultExtractor {
  feed(event: NormalizedEvent): void
  finish(): string | undefined
}

/**
 * 流式版 result 提取：与 extractResultText 同一语义（最后一段连续
 * text 优先，回退最后 result），O(1) 滚动状态，供 TaskRunner 逐事件
 * 消费，替代全程累积 events 数组。
 */
export function createResultExtractor(): ResultExtractor {
  let lastTextRun: string[] = []
  let curRun: string[] = []
  let resultText: string | undefined
  return {
    feed(e) {
      if (e.kind === 'text') {
        curRun.push(e.text)
      } else {
        if (curRun.length > 0) { lastTextRun = curRun; curRun = [] }
        if (e.kind === 'result') resultText = e.text
      }
    },
    finish() {
      if (curRun.length > 0) lastTextRun = curRun
      return lastTextRun.length > 0 ? lastTextRun.join('\n') : resultText
    }
  }
}

export function extractResultText(events: NormalizedEvent[]): string | undefined {
  const ex = createResultExtractor()
  for (const e of events) ex.feed(e)
  return ex.finish()
}
```

（保留 extractResultText 上方的既有 JSDoc 语义注释。）

### Step 4: 改 `src/main/tasks/TaskRunner.ts`

```bash
grep -n "events" src/main/tasks/TaskRunner.ts
```

- 删 `const events: NormalizedEvent[] = []`，换 `const extractor = createResultExtractor()`
- `events.push(...parseEvents(line))` 两处 → `for (const e of parseEvents(line)) extractor.feed(e)`
- `resultText: extractResultText(events)` → `resultText: extractor.finish()`
- import 改为 `createResultExtractor`（若 NormalizedEvent 类型不再使用则从 import 清除）

### Step 5: 跑全量 + typecheck

### Step 6: 提交（只 add 3 个文件）

```bash
git add src/main/tasks/streamJson.ts src/main/tasks/streamJson.test.ts src/main/tasks/TaskRunner.ts
git commit -m "fix(review): #14 — TaskRunner 流式 result 提取替代 events 无界累积

原 events: NormalizedEvent[] 全程累积整 run 的解析事件（与磁盘
transcript 重复），小时级 agent run 内存随事件数线性增长。

修复：
- streamJson 新增 createResultExtractor（feed/finish，O(1) 滚动状态）
- extractResultText 重写为复用同一 reducer，单一事实来源
- TaskRunner 逐事件 feed，close 时 finish，不再持有数组

等价性由对照测试守护（同 fixtures 流式 vs 批量输出相等）。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

# Round 2（Task 1 完成后串行）

## Task 4: #15 — resize rAF 合帧 + 相等检查

**Files（只 add 这些）:**
- Modify: `src/renderer/src/components/TerminalPane.tsx`
- Modify: `src/renderer/src/components/TerminalPane.test.tsx`

### Step 1: 读现有 syncSize / ResizeObserver 代码

```bash
sed -n '50,80p' src/renderer/src/components/TerminalPane.tsx
```

### Step 2: 写测试（TerminalPane.test.tsx 追加；先读现有 mock 结构——xterm mock / ResizeObserver stub / window.api mock 均已存在）

```tsx
describe('syncSize resize 去重 (#15)', () => {
  it('RO 连续触发但尺寸未变 → sessions.resize 只调一次', async () => {
    // 复用现有 mock 捕获 ResizeObserver 实例与 sessions.resize vi.fn
    // fit mock 保持 cols/rows 不变
    // 触发 ro callback 两次（中间 flush rAF）
    // expect(window.api.sessions.resize).toHaveBeenCalledTimes(1)
  })

  it('尺寸变化后 → resize 再次调用', async () => {
    // fit mock 第一次 80x24，第二次 100x30
    // 触发两次 ro callback，各 flush rAF
    // expect(resize).toHaveBeenNthCalledWith(1, ..., 80, 24)
    // expect(resize).toHaveBeenNthCalledWith(2, ..., 100, 30)
  })
})
```

> 具体写法按现有 mock 能力适配：若 ResizeObserver 实例未被捕获，把现有 stub 改为可捕获（class + 静态数组记录实例）；rAF 用真实（jsdom 有），断言前 `await new Promise(r => requestAnimationFrame(r))` flush。

### Step 3: 跑测试，确认失败（现状每次 RO 回调都发 IPC，第一次断言 1 次会失败——触发 2 次得 2 次）

### Step 4: 改 `src/renderer/src/components/TerminalPane.tsx` syncSize 块

```ts
let lastCols = -1
let lastRows = -1
let rafId: number | null = null

const syncSize = () => {
  rafId = null
  try { fit.fit() } catch { return }  // host 不可见时 fit 抛错，忽略
  if (term.cols !== lastCols || term.rows !== lastRows) {
    lastCols = term.cols
    lastRows = term.rows
    void window.api.sessions.resize(session.id, term.cols, term.rows)
  }
}

// rAF 合帧：同一帧内多次 RO 回调只触发一次 syncSize
const scheduleSync = () => {
  if (rafId !== null) return
  rafId = requestAnimationFrame(syncSize)
}

// 原三处初始 fit（rAF/t100/t500）与 ResizeObserver 回调全部改调 scheduleSync
// cleanup 增加：if (rafId !== null) cancelAnimationFrame(rafId)
```

保留现有的 `offsetParent !== null` 可见性判断（在 RO 回调处）。

### Step 5: 跑全量 + typecheck

### Step 6: 提交（只 add 2 个文件）

```bash
git add src/renderer/src/components/TerminalPane.tsx src/renderer/src/components/TerminalPane.test.tsx
git commit -m "fix(review): #15 — resize rAF 合帧 + cols/rows 相等检查

原 ResizeObserver 每次回调直接 fit() + IPC resize，无 debounce、
无尺寸相等检查；窗口拖动每秒触发几十次 fit + IPC。

修复：
- rAF 合帧：同一帧内多次回调只跑一次 syncSize
- cols/rows 相等检查：尺寸未变（布局微动）不发 IPC

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## 收尾

- [ ] **Task 5: 全量测试 + typecheck**

```bash
npx vitest run   # 期望 199 + ≥8 = 207+
npm run typecheck
```

- [ ] **Task 6: 结果报告** `docs/superpowers/plans/2026-09-24-performance-result.md`（commit hash / 测试数 / spec 偏离）

- [ ] **Task 7: merge to main + tag 0.1.5**

```bash
git checkout main
git merge --no-ff performance
git tag -a 0.1.5 -m "v0.1.5 — Performance (4 finding)"
git branch -d performance
git worktree remove /Users/cramer/Documents/tools/agent-desktop/.worktrees/performance
```

---

## DoD

- [ ] 4 finding 各一个 commit（`fix(review): #N`）
- [ ] 207+ tests PASS；typecheck clean
- [ ] 既有测试未删除/未弱化
- [ ] IPC 协议 surface 未变
- [ ] 结果报告落档
- [ ] tag 0.1.5
