# Performance 设计

**日期**：2026-09-24
**状态**：设计阶段，待用户审阅
**Baseline**：tag `0.1.4`（commit `1f4e660`）
**关联**：deep review 报告 finding #12, #13, #14, #15

## 1. 目标

修复 deep review 中 4 个 performance finding，各自独立最小修复：

- **#12**：pty 每个 chunk 广播到所有 TerminalPane listener，N 个 pane = N 倍 renderer 开销
- **#13**：`trimHistory` 每次持久化都 O(n log n) sort，但 history 已有降序不变式
- **#14**：TaskRunner `events[]` 全程无界累积（与磁盘 transcript 重复），多小时的 run 内存翻倍
- **#15**：ResizeObserver 每次回调直接 `fit()` + IPC resize，窗口拖动时每秒几十次

## 2. 范围与非目标

### 本 spec 涉及
- 4 个局部性能修复
- 新增 `src/renderer/src/sessionDataBus.ts`（#12 的单订阅分发器）
- `streamJson.ts` 新增流式 `createResultExtractor`（#14）
- `TerminalPane.tsx` 两处修改（#12 注册 write 回调 + #15 rAF debounce）——**串行执行避免冲突**

### 不在本 spec
- UX / 测试覆盖 / 架构类 7 个 finding（Spec D 跟进）
- IPC 协议 surface 变更（#12 明确不改：仍用单一 `session:data` push channel）

## 3. 关键决策

| 决策点 | 结论 | 备选与否决理由 |
|--------|------|----------------|
| 总体策略 | 独立最小修复 | 性能修复分散在不同层，无共同抽象；跨层抽象收益不成比例 |
| #12 修法 | renderer 单订阅分发器 | IPC surface 不变；channel-per-session 破坏静态 CHANNELS 常量模式 |
| #13 修法 | 运行时 trim 去 sort；load 路径一次性 sort | 纯 slice-only 不安全：load 时 missed 记录 push 到尾部会破坏降序（详见 §5） |
| #14 修法 | 流式 reducer | 尾部截断会丢早期 text run，extractResultText 语义受损 |
| #15 修法 | rAF 合帧 + cols/rows 相等检查 | 只在尺寸真变时才发 IPC |
| 调度 | Task 1/2/3 并行（不同文件）；Task 4 串行在 Task 1 后（同改 TerminalPane） | 遵循"不涉同文件才并行" |

## 4. 文件结构

```
src/renderer/src/
├── sessionDataBus.ts                 # 新（#12）：单订阅 + Map<id, write> 路由
├── sessionDataBus.test.ts            # 新（#12）
├── components/TerminalPane.tsx       # 改（#12 注册回调 + #15 debounce）
└── components/TerminalPane.test.tsx  # 改（#15 加 resize 去重测试）

src/main/store/
└── TaskStore.ts                      # 改（#13）：trimHistory slice-only + loadStore 排序
   TaskStore.test.ts                  # 改（#13）

src/main/tasks/
├── TaskService.ts                    # 改（#13）：load() missed 记录排序修正
│  TaskService.test.ts                # 改（#13）：load 路径测试
├── streamJson.ts                     # 改（#14）：createResultExtractor + extractResultText 复用
│  streamJson.test.ts                 # 改（#14）：流式等价测试
└── TaskRunner.ts                     # 改（#14）：events[] → extractor
```

## 5. 详细设计

### #12 — renderer 单订阅分发器

新 `src/renderer/src/sessionDataBus.ts`：

```ts
import type { SessionSummary } from '@shared/types'

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

`TerminalPane.tsx` 改动：删掉自己的 `window.api.onSessionData(...)` 订阅（现在每个 pane 各自订阅 + JS filter id），替换为：

```ts
const offBus = registerTerminal(session.id, (d) => term.write(d))
// cleanup: offBus() 替代原 offData()
```

**语义注意**：原代码 pane 隐藏时是否仍写入 scrollback？读现有实现确认——现有 `if (ev.id === session.id)` 无隐藏判断，语义为"始终写入"，分发器保持一致。

### #13 — trimHistory 去 sort

**不变式分析**（为什么不能纯 slice-only）：

- `fire()`：`trimHistory([running, ...history])` — prepend 当前时刻，降序保持 ✓
- `finishRun()`：`history.map(...)` 原位替换，顺序不变 ✓
- **`load()` 破坏点**：磁盘读出的 history 降序，但 missed 记录（`startedAt = 过去时刻的 nextRunAt`）用 `push()` 追加到**尾部**。若磁盘尾部存在比 missed 更早的记录（如磁盘 `[10:00, 09:00]` + missed `09:30` → `[10:00, 09:00, 09:30]`），数组不是降序。当前 sort-based trim 会把它排回正确位置；slice-only 会把 09:30 错误截掉（cap 边界时）或留下乱序数组。

**修法**：

```ts
// TaskStore.ts
/** 运行时 trim：调用方保证降序不变式（fire prepend / finishRun 原位替换） */
export function trimHistory(history: RunRecord[], cap = HISTORY_CAP): RunRecord[] {
  return history.slice(0, cap)
}

/** load 路径专用：先排降序再 trim（磁盘数据 + missed push 不保证有序） */
export function sortHistoryDesc(history: RunRecord[]): RunRecord[] {
  return [...history].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}
```

`TaskService.load()`：`this.history.push(missed...)` 之后、`trimHistory` 之前加 `this.history = sortHistoryDesc(this.history)`（一次性 O(n log n)，仅启动时）。

`loadStore`（TaskStore 读盘处）直接返回原数组，排序交给 TaskService.load（只有它知道 missed 追加）。

### #14 — 流式 reducer

`streamJson.ts` 新增（与 extractResultText 共享同一段逻辑，DRY）：

```ts
export interface ResultExtractor {
  feed(event: NormalizedEvent): void
  finish(): string | undefined
}

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

// extractResultText 重写为复用（单一事实来源）：
export function extractResultText(events: NormalizedEvent[]): string | undefined {
  const ex = createResultExtractor()
  for (const e of events) ex.feed(e)
  return ex.finish()
}
```

`TaskRunner.ts`：

```ts
// 删：const events: NormalizedEvent[] = []
const extractor = createResultExtractor()

// 行 97/113 处：
for (const e of parseEvents(line)) extractor.feed(e)

// 行 120 处：
resultText: extractor.finish(),
```

**等价性测试**：现有 `extractResultText` 全部测试用例 + 新增"流式 feed 与批量 extract 输出一致"的对照测试（同一 fixtures 两种方式跑，断言相等）。

### #15 — resize rAF + 相等检查

`TerminalPane.tsx` syncSize 改造：

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

// rAF 合帧：同一帧内多次 ResizeObserver 回调只触发一次 syncSize
const scheduleSync = () => {
  if (rafId !== null) return
  rafId = requestAnimationFrame(syncSize)
}

// 原 requestAnimationFrame(syncSize) / t100 / t500 / ResizeObserver 回调全部改走 scheduleSync
// cleanup: if (rafId !== null) cancelAnimationFrame(rafId)
```

**效果**：窗口拖动时几十次/秒的 RO 回调 → 每帧最多 1 次 fit；尺寸未变（如布局微动）不发 IPC。

## 6. 测试策略

| finding | 测试 |
|---------|------|
| #12 | `sessionDataBus.test.ts`：注册 A/B 两个 write → 推 A 的事件只有 A 收到；注销后不再收到；重复注册同 id 覆盖 |
| #13 | `TaskStore.test.ts`：`trimHistory` cap 截断（slice 语义）；`sortHistoryDesc` 排序。`TaskService.test.ts`：load 时 missed 记录排到正确位置（现有 missed 测试保留 + 加乱序磁盘 fixture） |
| #14 | `streamJson.test.ts`：现有 extractResultText 用例全保留（验证批量路径仍对）；新增流式对照测试（同 fixtures 逐条 feed vs 批量，断言 finish() === extractResultText(events)） |
| #15 | `TerminalPane.test.tsx`：mock ResizeObserver 捕获实例，连续触发 2 次回调 + mock 的 fit 返回同尺寸 → `sessions.resize` 只调 1 次；尺寸变化后 → 再调 1 次 |

## 7. 错误处理与边缘情况

| 场景 | 行为 |
|------|------|
| #12 最后一个 terminal 注销 | 订阅保留（单次 listener 开销可忽略；重建 pane 免重复订阅） |
| #12 pane remount（StrictMode 双挂载） | register 覆盖同 id 的旧 write；旧 cleanup 的 unregister 先执行 → 需确认顺序：mount1 → unmount1 → mount2，unregister 删 id 后 mount2 重新 set，安全 |
| #13 磁盘 history 为空 + missed 记录多条 | sortHistoryDesc 排序后 trim，行为与现状一致 |
| #14 run 无任何事件 | extractor.finish() 返回 undefined（与现状一致） |
| #14 text run 跨行累积 | feed 逐条处理，curRun 语义与批量一致 |
| #15 host 不可见（offsetParent null） | 现有判断保留在 scheduleSync 调用点之前，fit 抛错 return，不发 IPC |

## 8. 风险与回滚

- **风险 1**：#12 分发器改变 pane 数据到达时序（原来 N 个 listener 顺序调用，现在 Map.get 直达）——语义等价，无用户可见差异
  - 回滚：TerminalPane 恢复各自订阅
- **风险 2**：#13 若存在未识别的 trimHistory 调用点依赖 sort 副作用（排序修序）——grep 全部调用点逐一确认（fire/finishRun/load/runNow 等），只有 load 路径需要 sort
  - 回滚：trimHistory 恢复 sort 版本
- **风险 3**：#14 流式与批量提取在极端事件序列下不等价——等价对照测试覆盖现有全部 fixtures
  - 回滚：TaskRunner 恢复数组累积
- **风险 4**：#15 rAF 合帧在 jsdom 测试环境需 mock requestAnimationFrame——测试环境已有 jsdom，rAF 存在
  - 回滚：恢复直调 syncSize

## 9. 实施完成定义（DoD）

- [ ] `sessionDataBus.ts` + 测试新文件；TerminalPane 改用 registerTerminal
- [ ] `trimHistory` slice-only + `sortHistoryDesc` + load 排序 + 测试
- [ ] `createResultExtractor` + extractResultText 复用 + 等价测试；TaskRunner 去数组
- [ ] syncSize rAF + 相等检查 + 测试
- [ ] 全量测试通过（199 baseline + 至少 8 新 = 207+）
- [ ] typecheck clean

## 10. 调度

```
Round 1（三路并行，不同文件）:
  Task 1 (#12): sessionDataBus + TerminalPane 订阅改造
  Task 2 (#13): TaskStore trimHistory + TaskService.load
  Task 3 (#14): streamJson extractor + TaskRunner

Round 2（串行，与 Task 1 同文件 TerminalPane）:
  Task 4 (#15): syncSize rAF debounce
```

**并行纪律**（吸取本会话多次 commit 抢占教训）：每个 implementer 只 `git add <自己明确列出的文件>`，禁止 `git add .` / `git add -A`；commit 前用 `git status` 确认没有别人的未提交文件混入。

## 11. 用户手动验证（merge 前可选）

1. 开 5+ 个 terminal tab，在其中一个跑 `yes` 或编译输出 → 观察 UI 不卡顿、其他 tab 无异常（#12）
2. 长任务（几分钟）跑完 → 主进程内存稳定不随 run 时长线性涨（#14，可用 Activity Monitor 观察）
3. 拖动窗口边缘 resize → 终端尺寸跟随但无卡顿（#15）
4. 重启 app → history 顺序正确（最新在前）（#13）
