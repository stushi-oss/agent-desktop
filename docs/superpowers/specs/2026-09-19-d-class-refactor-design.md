# D 类重构设计

**日期**：2026-09-19
**状态**：设计阶段，待用户审阅
**Baseline**：tag `0.1.1`（commit `6a49247`）
**关联**：D 类 spec 骨架 `docs/superpowers/specs/2026-09-19-code-review-d-class-design.md`

## 1. 目标

跨 4 个 D 类 finding 重构到 `@shared/` 抽象中心，统一 schema 校验和 channel 字符串，引入 zod 作为运行时校验：

- **#4** registry 60s 缓存不随 cwd 失效 → 事件订阅 invalidate
- **#11** setSettings handler 无 schema 校验 → zod 校验
- **#12** 18 个 IPC channel 字符串散落 → `@shared/channels.ts` 单一来源
- **#14** streamJson 两个函数重复 walk + cast → normalized events list + zod 中间表示

核心约束：

- **不破坏 IPC 协议表面**：channel 名、handler 名、参数、返回类型都不变
- **不破坏现有功能**：所有改动由 TDD 守护
- **不破坏磁盘格式**：settings.json、transcript 文件、tasks.json 都不变

## 2. 范围与非目标

### 本 spec 涉及
- 4 个 D 类 finding 的抽象重构
- 新增 `@shared/channels.ts`、`@shared/schemas.ts`、`@shared/streamEvents.ts`
- 引入 zod 依赖

### 不在本 spec
- 已有 A/B/C 类修复（已 merge 到 main）
- 现有 IPC 协议表面变更
- 现有渲染端 UI 改动

## 3. 关键决策

| 决策点 | 结论 | 备选与否决理由 |
|--------|------|----------------|
| 抽象中心 | `@shared/` | main / renderer 都从同一处 import；与既有 `src/shared/types.ts` 共置 |
| 校验库 | zod | 业界标准；既支持 TS type 也支持 runtime；与共享类型协同好 |
| IPC 协议表面 | 不动 | 避免破坏 preload/renderer 调用；本次只动内部实现 |
| #4 缓存语义 | 事件订阅 invalidate | 在 `useRegistryStore` 监听 session events，触发 invalidate；不做 in-flight dedupe（YAGNI） |
| #14 边界 | normalized events list | 抽 `parseEvents(raw): StreamEvent[]` 统一入口；`extractResultText` / `toTranscriptItems` 都从 normalized 消费 |
| zod 中间表示 | `streamEvents.ts` 用 zod schema 定义 `NormalizedEvent` union | 编译期 + 运行期双重契约 |
| channel 重命名 | 不改 | spec 范围外；保留 'sessions:create' / 'tasks:changed' 等原名 |

## 4. 文件结构

```
src/shared/
├── types.ts              # 既有（保留）
├── channels.ts           # 新：所有 IPC channel 字符串 const
├── schemas.ts            # 新：zod schema 单一事实来源（AppSettings 等）
└── streamEvents.ts       # 新：normalized StreamEvent 类型 + zod schema

src/main/
├── ipc.ts                # 改：用 @shared/channels；setSettings handler 用 zod 校验
├── tasks/streamJson.ts   # 改：抽 parseEvents 入口 + 用 @shared/streamEvents
└── package.json          # 加 zod dep

src/renderer/src/
├── stores/registry.ts    # 改：订阅 session events invalidate
└── stores/registry.test.ts (新)  # 测 invalidate 行为

src/preload/
└── index.ts              # 改：用 @shared/channels

tests/
└── channels.test.ts      # 新：snapshot 所有 channel 字符串
```

## 5. 详细设计

### #12 — `@shared/channels.ts`

```ts
// src/shared/channels.ts

/** 所有 IPC invoke channel（renderer → main） */
export const INVOKE_CHANNELS = {
  sessions: {
    create: 'sessions:create',
    write: 'sessions:write',
    resize: 'sessions:resize',
    kill: 'sessions:kill',
    list: 'sessions:list',
    rename: 'sessions:rename'
  },
  app: {
    pickDirectory: 'app:pickDirectory',
    getSettings: 'app:getSettings',
    setSettings: 'app:setSettings',
    getClaudeStatus: 'app:getClaudeStatus'
  },
  registry: { scan: 'registry:scan' },
  tasks: {
    list: 'tasks:list',
    history: 'tasks:history',
    create: 'tasks:create',
    update: 'tasks:update',
    remove: 'tasks:remove',
    setEnabled: 'tasks:setEnabled',
    runNow: 'tasks:runNow',
    transcript: 'tasks:transcript'
  }
} as const

/** 所有 IPC 推送 channel（main → renderer） */
export const PUSH_CHANNELS = {
  sessionData: 'session:data',
  sessionExit: 'session:exit',
  tasksChanged: 'tasks:changed',
  appShortcut: 'app:shortcut',
  appSettingsChanged: 'app:settingsChanged',
  appOpenTasks: 'app:openTasks'
} as const

export type InvokeChannel = typeof INVOKE_CHANNELS[keyof typeof INVOKE_CHANNELS][keyof any]
export type PushChannel = typeof PUSH_CHANNELS[keyof typeof PUSH_CHANNELS]
```

**改动点**：
- `src/main/ipc.ts`：`ipcMain.handle(INVOKE_CHANNELS.sessions.create, ...)` 替代字符串字面量；`push(..., PUSH_CHANNELS.sessionData, ...)` 替代
- `src/preload/index.ts`：所有 `ipcRenderer.invoke(...)` 用 INVOKE_CHANNELS；`ipcRenderer.on(...)` 用 PUSH_CHANNELS
- 移除既有 `src/main/ipc.ts:27-31` 的 CHANNELS 常量（功能并入 INVOKE_CHANNELS/PUSH_CHANNELS）

### #11 — `@shared/schemas.ts`

```ts
// src/shared/schemas.ts
import { z } from 'zod'

export const ThemeSchema = z.enum(['system', 'light', 'dark'])
export const LocaleSchema = z.string().min(2).max(10)

export const AppSettingsSchema = z.object({
  theme: ThemeSchema,
  locale: LocaleSchema,
  closeToTray: z.boolean(),
  showNotifications: z.boolean().optional()
}).strict()  // 拒绝未知 key

export type AppSettings = z.infer<typeof AppSettingsSchema>

/** Partial patch schema（setSettings 接收） */
export const AppSettingsPatchSchema = AppSettingsSchema.partial().strict()
```

**改动点**：
- `src/shared/types.ts` 的 `AppSettings` interface 改为 `z.infer` 的别名（保持向后兼容）
- `src/main/ipc.ts` 的 `app:setSettings` handler：
  ```ts
  ipcMain.handle(PUSH_CHANNELS.app.setSettings ?? INVOKE_CHANNELS.app.setSettings, (_e, patch: unknown) => {
    const parsed = AppSettingsPatchSchema.parse(patch)  // throw ZodError if invalid
    const next = deps.settings.set(parsed)
    if (parsed.theme) nativeTheme.themeSource = parsed.theme
    push(deps.getWindow(), PUSH_CHANNELS.appSettingsChanged, next)
    return next
  })
  ```
- ZodError 转译为 IPC error：handler 用 try/catch 包，catch 抛 `new Error('invalid settings: ...')` 让渲染端 catch

### #4 — registry 事件 invalidate

```ts
// src/renderer/src/stores/registry.ts
export const useRegistryStore = create<RegistryState>()((set, get) => {
  // 订阅 session events — 任一会话改变就清缓存
  // 通过 window.api 的 onSessionExit + new-session event 实现
  const offSessionExit = window.api.onSessionExit(() => {
    set({ snapshot: null, fetchedAt: 0 })  // 强制下一次重新拉
  })
  const offSessionData = window.api.onSessionData(() => {
    // 不需要 invalidate — session 活动不影响 skills/MCP 列表
  })
  
  return {
    // ... 既有 fields
    scan: async () => {
      // 既有逻辑；fetchedAt 检查：cache stale 就重拉
    }
  }
})
```

**关键**：触发 invalidate 的事件源 = session 生命周期事件。Main 进程不广播 cwd 变化事件（已有 `activeCwd` 内部状态），所以注册表 store 不知道 active cwd 是什么——但**只要任何 session 创建/销毁，就 invalidate**。激进但保守正确：误 invalidate 多拉一次比缓存过期好。

**简化方案**：
- Main 端在 `sessions:create` / `sessions:kill` handler 内广播一个新 push channel：`sessions:changed`
- Renderer 端 store 监听这个 channel，触发 invalidate

新增 channel 串：`PUSH_CHANNELS.sessionsChanged = 'sessions:changed'`

**Surface 边界澄清**：本次 D 类重构在 spec §3 决策"IPC 协议表面不动"约束下，意思是**既有 channel 的名字/参数/返回不变**。但**新加 push channel 是允许的**——这是 #4 invalidate 的功能需求，且不破坏既有 IPC 调用方（renderer 不监听这个新 channel 也不影响功能；监听方是新加的 store subscription）。

### #14 — `@shared/streamEvents.ts` + `parseEvents`

```ts
// src/shared/streamEvents.ts
import { z } from 'zod'

const TextContentSchema = z.object({
  type: z.literal('text'),
  text: z.string()
})
const ToolUseContentSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.unknown()
})
const AssistantContentSchema = z.union([TextContentSchema, ToolUseContentSchema])

export const NormalizedEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({ kind: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.unknown() }),
  z.object({ kind: z.literal('result'), text: z.string() }),
  z.object({ kind: z.literal('system'), subtype: z.string(), data: z.unknown().optional() }),
  z.object({ kind: z.literal('unknown'), raw: z.unknown() })
])
export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>
```

```ts
// src/main/tasks/streamJson.ts (改后)
import { NormalizedEventSchema, type NormalizedEvent } from '@shared/streamEvents'

export function parseEvents(raw: string): NormalizedEvent[] {
  return raw.split('\n')
    .map(line => parseLine(line))
    .filter((e): e is NormalizedEvent => e !== null)
}

function parseLine(line: string): NormalizedEvent | null {
  let parsed: unknown
  try { parsed = JSON.parse(line) } catch { return null }
  
  const obj = parsed as { type?: unknown; message?: { content?: unknown } }
  if (typeof obj?.type !== 'string') return null
  
  switch (obj.type) {
    case 'assistant': {
      const content = obj.message?.content
      if (!Array.isArray(content)) return null
      return content.map(item => normalizeAssistantItem(item)).filter(notNull)
        // 注意：return list 不是单值；要么改 NormalizedEvent 让 parseLine 返回 list，要么 caller 处理
        // **设计选择**：parseLine 返回第一个；parseEvents 收集所有
    }
    // ...
  }
  return { kind: 'unknown', raw: parsed }
}
```

**关键设计选择**：`parseEvents` 返回 `NormalizedEvent[]`，`extractResultText` / `toTranscriptItems` 都从 `NormalizedEvent[]` 消费，**不再走原始 `parseStreamLine`**。

既有 `parseStreamLine(line)` 保留为 compat 导出。

### 测试策略

| finding | 新测试 |
|---------|--------|
| #4 | `registry.test.ts`: 模拟 session exit 事件 → snapshot 清空、fetchedAt=0 |
| #11 | `setSettings` handler 测试：合法 patch 通过；非法 patch 抛 Error；未知 key 拒绝 |
| #12 | `channels.test.ts`: snapshot 所有 channel 字符串；类型 `InvokeChannel` / `PushChannel` 编译期覆盖 |
| #14 | `streamJson.test.ts`: parseEvents 测各种 shape；既有的 extractResultText/toTranscriptItems 测试保留并改成 from-normalized-events 消费 |

### 调度

**不并行**（同文件 / 依赖）：
- #12 (channels.ts) 必须最先做（#11、#4 依赖 channel 字符串）
- #14 (streamEvents.ts) 与 #11 (#11 改 ipc.ts)、#4 (#4 改 registry.ts) 不同文件——可与 #11/#4 并行，但前提是 #12 已 commit

执行顺序：
1. **#12 channels 抽象**（最先，串行）
2. **#11 schemas + setSettings handler 校验** + **#4 registry invalidate** + **#14 streamJson 重构**（三个 subagent 并行）

## 6. 错误处理与边缘情况

| 场景 | 行为 |
|------|------|
| zod parse 失败 | handler throw `Error('invalid settings: <details>')`，IPC 返回 rejected promise；renderer console.error |
| unknown channel 引用 | TypeScript 编译失败（类型保证） |
| parseEvents 遇 malformed line | skip；不抛（与现有 `parseStreamLine` 一致） |
| session event 频繁触发 | invalidate 是 O(1) 操作；下次 scan 才是 O(n) |
| zod 包大小影响 bundle | #11（main）和 #14（main）用 zod；renderer 不 import `@shared/streamEvents.ts` 的 schema，仅消费 `TranscriptItem[]`。#4 不需要 zod（只是事件订阅 + invalidate 计数）。bundle 影响限于 main 进程 |

## 7. 风险与回滚

- **风险 1**：zod 是新依赖
  - 缓解：zod 是 industry standard，bundle 影响有限；只在 main 进程 + 抽象层用
  - 回滚：移除 zod 引用，回退到纯 TS type guard
- **风险 2**：#14 重构 streamJson 可能影响 transcript 解析
  - 缓解：现有 `parseStreamLine` 保留为 compat 导出；现有测试保留并从 parseEvents 重跑
  - 回滚：revert 14 commit；既有路径仍可用
- **风险 3**：#12 改 channel 字符串可能漏掉一个引用
  - 缓解：snapshot 测试 + 类型 `InvokeChannel` 在所有 ipcMain.handle / ipcRenderer.invoke 调用点 grep
  - 回滚：revert 12 commit

## 8. 实施完成定义（DoD）

- [ ] `@shared/channels.ts`、`@shared/schemas.ts`、`@shared/streamEvents.ts` 三个新文件
- [ ] zod 加 dep
- [ ] 既有 18 个 channel 字符串全部从字面量换成 INVOKE_CHANNELS / PUSH_CHANNELS 引用
- [ ] `app:setSettings` handler 用 zod 校验
- [ ] `parseEvents(raw): NormalizedEvent[]` 实现 + 既有 `extractResultText` / `toTranscriptItems` 改用
- [ ] `useRegistryStore` 订阅 session events invalidate
- [ ] 新增 `PUSH_CHANNELS.sessionsChanged` 在 main 端 broadcast
- [ ] 4 个新测试通过 + 全量回归通过（127 → 预计 135+）
- [ ] typecheck clean
- [ ] tag 0.1.2
