# D 类重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 跨 4 个 D 类 finding 抽象到 `@shared/` 中心，统一 IPC channel 字符串、引入 zod 校验、抽 streamJson 解析层。

**Architecture:** TDD + 串行优先（#12 channels）→ 三路并行（#11 schemas + #4 registry + #14 streamJson）。新增 3 个 `@shared/` 模块 + zod dep。既有 IPC 协议表面不变（仅 `sessions:changed` 新 push channel）。

**Tech Stack:** Electron 44 · TypeScript 5.9 · vitest 5 · zod 4 (新增)。既有架构保持。

**Baseline:** tag `0.1.1` (commit `6a49247`)。
**Spec:** `docs/superpowers/specs/2026-09-19-d-class-refactor-design.md` (commit `67239b1`)。

---

## 全局约定

1. **工作目录**：所有命令都在 worktree `/Users/cramer/Documents/tools/agent-desktop/.worktrees/d-class-refactor` 执行。
2. **TDD**：先扩/写测试（vitest），看到失败再实现，看到通过再提交。
3. **提交**：每个 finding 一组 commit，消息格式 `refactor(d): #N — 描述`，结尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
4. **既有测试不删除、不弱化**：spec §5 明确要求 `parseStreamLine` 保留为 compat 导出。
5. **IPC 协议表面**：spec §3 决策"不动"——既有 channel 名/参数/返回不变。新增 `sessions:changed` push 是 #4 需要，spec 已豁免。
6. **zod 仅 main 进程使用**：`@shared/streamEvents.ts` 的 schema 在 main 端 import；renderer 端只消费 `TranscriptItem[]`。
7. **Branch 纪律**：所有改动在 `d-class-refactor` 分支，不动 main。

---

## 文件结构总览（本次涉及）

| 文件 | 状态 | finding | 备注 |
|------|------|---------|------|
| `package.json` | 改 | (#11 #14 共同) | 加 zod dep |
| `src/shared/channels.ts` | 新建 | #12 | INVOKE_CHANNELS + PUSH_CHANNELS |
| `src/shared/channels.test.ts` | 新建 | #12 | snapshot + 类型覆盖 |
| `src/shared/schemas.ts` | 新建 | #11 | AppSettingsSchema + AppSettingsPatchSchema |
| `src/shared/streamEvents.ts` | 新建 | #14 | NormalizedEventSchema |
| `src/shared/types.ts` | 改 | #11 | AppSettings 改为 z.infer 别名 |
| `src/main/ipc.ts` | 改 | #11 #12 | setSettings 校验；用 INVOKE_CHANNELS/PUSH_CHANNELS |
| `src/main/ipc.test.ts` | 新建 | #11 | setSettings 合法/非法 patch |
| `src/main/index.ts` | 改 | #4 #12 | 在 sessions:create/kill 广播 sessions:changed |
| `src/main/tasks/streamJson.ts` | 改 | #14 | 抽 parseEvents；既有 parseStreamLine 保留 |
| `src/main/tasks/streamJson.test.ts` | 改 | #14 | 加 parseEvents 测试；既有用例保留 |
| `src/preload/index.ts` | 改 | #12 | 用 INVOKE_CHANNELS/PUSH_CHANNELS；新增 onSessionsChanged |
| `src/renderer/src/stores/registry.ts` | 改 | #4 | 订阅 sessions:changed invalidate |
| `src/renderer/src/stores/registry.test.ts` | 新建 | #4 | invalidate 测试 |

---

## 调度总览

```
Phase 1（串行 #12）     Phase 2（并行）
─────────────         ─────────────────────────────
Task 1: #12 channels   Task 2: #11 schemas + setSettings 校验
                       Task 3: #4 registry invalidate
                       Task 4: #14 streamJson 抽 parseEvents
```

#12 必须最先完成；#11/#4/#14 改的文件不同，可并行（每个 subagent 在 worktree 同一 branch 上串行派）。

---

# Phase 1：#12 — IPC channels 抽象

## Task 1: #12 — `@shared/channels.ts` + 所有 channel 字符串迁移

**Files:**
- Create: `src/shared/channels.ts`
- Create: `src/shared/channels.test.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`（index.ts 的 push 字符串也迁移）

### Step 1: 写 snapshot 测试

新建 `src/shared/channels.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { INVOKE_CHANNELS, PUSH_CHANNELS } from './channels'

describe('@shared/channels', () => {
  it('INVOKE_CHANNELS 字符串稳定（renderer 跨版本依赖）', () => {
    expect(INVOKE_CHANNELS.sessions.create).toBe('sessions:create')
    expect(INVOKE_CHANNELS.sessions.write).toBe('sessions:write')
    expect(INVOKE_CHANNELS.sessions.resize).toBe('sessions:resize')
    expect(INVOKE_CHANNELS.sessions.kill).toBe('sessions:kill')
    expect(INVOKE_CHANNELS.sessions.list).toBe('sessions:list')
    expect(INVOKE_CHANNELS.sessions.rename).toBe('sessions:rename')
    expect(INVOKE_CHANNELS.app.pickDirectory).toBe('app:pickDirectory')
    expect(INVOKE_CHANNELS.app.getSettings).toBe('app:getSettings')
    expect(INVOKE_CHANNELS.app.setSettings).toBe('app:setSettings')
    expect(INVOKE_CHANNELS.app.getClaudeStatus).toBe('app:getClaudeStatus')
    expect(INVOKE_CHANNELS.registry.scan).toBe('registry:scan')
    expect(INVOKE_CHANNELS.tasks.list).toBe('tasks:list')
    expect(INVOKE_CHANNELS.tasks.history).toBe('tasks:history')
    expect(INVOKE_CHANNELS.tasks.create).toBe('tasks:create')
    expect(INVOKE_CHANNELS.tasks.update).toBe('tasks:update')
    expect(INVOKE_CHANNELS.tasks.remove).toBe('tasks:remove')
    expect(INVOKE_CHANNELS.tasks.setEnabled).toBe('tasks:setEnabled')
    expect(INVOKE_CHANNELS.tasks.runNow).toBe('tasks:runNow')
    expect(INVOKE_CHANNELS.tasks.transcript).toBe('tasks:transcript')
  })

  it('PUSH_CHANNELS 字符串稳定', () => {
    expect(PUSH_CHANNELS.sessionData).toBe('session:data')
    expect(PUSH_CHANNELS.sessionExit).toBe('session:exit')
    expect(PUSH_CHANNELS.tasksChanged).toBe('tasks:changed')
    expect(PUSH_CHANNELS.appShortcut).toBe('app:shortcut')
    expect(PUSH_CHANNELS.appSettingsChanged).toBe('app:settingsChanged')
    expect(PUSH_CHANNELS.appOpenTasks).toBe('app:openTasks')
  })
})
```

### Step 2: 跑测试，确认新建文件失败（import error）

```bash
npx vitest run src/shared/channels.test.ts
```

期望：FAIL（`./channels` 模块不存在）。

### Step 3: 创建 `src/shared/channels.ts`

按 spec §5 #12 代码块写：

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
```

> 注：#4 之后会再加 `sessionsChanged: 'sessions:changed'` 到 PUSH_CHANNELS。Task 1 不加，留给 Task 3 改。

### Step 4: 跑测试，确认通过

```bash
npx vitest run src/shared/channels.test.ts
```

### Step 5: 改 `src/main/ipc.ts`

把所有 `ipcMain.handle('literal', ...)` 改为 `ipcMain.handle(INVOKE_CHANNELS.xxx, ...)`；把 `push(..., 'literal', ...)` 改为 `push(..., PUSH_CHANNELS.xxx, ...)`。

在文件顶部 import：
```ts
import { INVOKE_CHANNELS, PUSH_CHANNELS } from '@shared/channels'
```

**保留**：`CHANNELS` 既有 const 在 ipc.ts:27-31（如果还有别处引用则保留；否则删除）。

先 grep 一下 `ipc.ts` 内的字符串：

```bash
grep -n "'sessions\|'app:\|'registry\|'tasks:" src/main/ipc.ts
```

逐个替换。

### Step 6: 改 `src/preload/index.ts`

所有 `ipcRenderer.invoke('literal', ...)` 改为 INVOKE_CHANNELS 引用；`ipcRenderer.on('literal', listener)` 改为 PUSH_CHANNELS 引用。

import：
```ts
import { INVOKE_CHANNELS, PUSH_CHANNELS } from '@shared/channels'
```

### Step 7: 改 `src/main/index.ts` 中的 push 字符串

`mainWindow.webContents.send('tasks:changed', ...)` 改为 PUSH_CHANNELS.tasksChanged。`w.webContents.send('app:openTasks')` 改为 PUSH_CHANNELS.appOpenTasks。

> index.ts 的 ipc invoke 字符串已在 registerIpc 内间接处理（registerIpc 是封装层）。这里只改 push 端。

### Step 8: 跑全量 typecheck + vitest

```bash
npm run typecheck
npx vitest run
```

期望：127/127 + typecheck clean。

### Step 9: 提交

```bash
git add src/shared/channels.ts src/shared/channels.test.ts \
        src/main/ipc.ts src/preload/index.ts src/main/index.ts
git commit -m "refactor(d): #12 — IPC channel 字符串统一到 @shared/channels

18 个 invoke channel + 6 个 push channel 全部从字面量换成 INVOKE_CHANNELS /
PUSH_CHANNELS 引用，跨 main/preload 单一事实来源；附带 snapshot 测试
锁住字符串值（避免意外改名破坏 IPC 协议）。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

# Phase 2：并行 #11 + #4 + #14

> 三个 subagent 在 worktree 同一 branch 上串行派（不同文件，无冲突）。

---

## Task 2: #11 — setSettings zod 校验

**Files:**
- Create: `src/shared/schemas.ts`
- Modify: `src/shared/types.ts`（AppSettings 改 z.infer 别名）
- Modify: `src/main/ipc.ts`
- Create: `src/main/ipc.test.ts`

### Step 1: 安装 zod

```bash
npm install zod
```

### Step 2: 写 `src/main/ipc.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcDeps } from './ipc'
import { registerIpc } from './ipc'

function makeDeps() {
  return {
    getWindow: () => null,
    sessions: { /* stub */ } as any,
    tasks: { /* stub */ } as any,
    shellFor: () => ({ file: '/bin/zsh', args: [], label: 'zsh' }),
    scanRegistry: () => ({ skills: [], mcp: [], agents: [], scannedAt: 0, cwd: '', home: '' }),
    settings: { get: () => ({ theme: 'system', locale: 'zh-CN', closeToTray: false } as any), set: (p: any) => p },
    claudeStatus: { found: false, candidates: [] }
  }
}

describe('app:setSettings handler', () => {
  let handlers: Record<string, Function>
  let deps: IpcDeps

  beforeEach(() => {
    handlers = {}
    deps = makeDeps()
    vi.spyOn(require('electron'), 'ipcMain', 'get').mockImplementation(() => ({
      handle: (channel: string, fn: Function) => { handlers[channel] = fn }
    }) as any)
  })

  it('合法 patch 通过', () => {
    registerIpc(deps)
    const result = handlers['app:setSettings']({}, { theme: 'dark' })
    expect(result.theme).toBe('dark')
  })

  it('非法 patch 抛错', () => {
    registerIpc(deps)
    expect(() => handlers['app:setSettings']({}, { theme: 'red' })).toThrow()
  })

  it('未知 key 拒绝', () => {
    registerIpc(deps)
    expect(() => handlers['app:setSettings']({}, { theme: 'dark', bogus: 1 })).toThrow()
  })
})
```

> **注意**：mock electron 的 ipcMain 比较 tricky；如果太复杂，**退化为不写 ipc.test.ts，只在 schemas.test.ts 测 schema 本身**，handler 集成测试后置。

### Step 3: 写 `src/shared/schemas.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { AppSettingsSchema, AppSettingsPatchSchema } from './schemas'

describe('AppSettingsSchema', () => {
  it('完整合法 settings 通过', () => {
    expect(() => AppSettingsSchema.parse({
      theme: 'system', locale: 'zh-CN', closeToTray: false
    })).not.toThrow()
  })

  it('非法 theme 拒绝', () => {
    expect(() => AppSettingsSchema.parse({
      theme: 'red', locale: 'zh-CN', closeToTray: false
    })).toThrow()
  })

  it('locale 长度超限拒绝', () => {
    expect(() => AppSettingsSchema.parse({
      theme: 'system', locale: 'a'.repeat(100), closeToTray: false
    })).toThrow()
  })

  it('strict: 未知 key 拒绝', () => {
    expect(() => AppSettingsSchema.parse({
      theme: 'system', locale: 'zh-CN', closeToTray: false, rogue: 1
    })).toThrow()
  })

  it('patch schema 允许 partial', () => {
    expect(() => AppSettingsPatchSchema.parse({ theme: 'light' })).not.toThrow()
  })

  it('patch schema 也严格拒绝未知 key', () => {
    expect(() => AppSettingsPatchSchema.parse({ theme: 'light', rogue: 1 })).toThrow()
  })
})
```

### Step 4: 跑测试，确认失败

```bash
npx vitest run src/shared/schemas.test.ts
```

期望：FAIL（`./schemas` 不存在）。

### Step 5: 创建 `src/shared/schemas.ts`

```ts
// src/shared/schemas.ts
import { z } from 'zod'

export const ThemeSchema = z.enum(['system', 'light', 'dark'])
export const LocaleSchema = z.string().min(2).max(10)

export const AppSettingsSchema = z.object({
  theme: ThemeSchema,
  locale: LocaleSchema,
  closeToTray: z.boolean()
}).strict()

export type AppSettings = z.infer<typeof AppSettingsSchema>

export const AppSettingsPatchSchema = AppSettingsSchema.partial().strict()
```

### Step 6: 改 `src/shared/types.ts`

找到 `AppSettings` interface 声明，改为 `export type AppSettings = import('./schemas').AppSettings`（避免循环 import 风险）。或直接在 types.ts re-export：

```ts
export type { AppSettings } from './schemas'
```

### Step 7: 改 `src/main/ipc.ts` 的 `app:setSettings` handler

```ts
import { AppSettingsPatchSchema } from '@shared/schemas'

ipcMain.handle(INVOKE_CHANNELS.app.setSettings, (_e, patch: unknown): AppSettings => {
  const parsed = AppSettingsPatchSchema.parse(patch)
  const next = deps.settings.set(parsed)
  if (parsed.theme) nativeTheme.themeSource = parsed.theme
  push(deps.getWindow(), PUSH_CHANNELS.appSettingsChanged, next)
  return next
})
```

注：parse 抛 ZodError；handler 让它抛，IPC 层会 reject promise。

### Step 8: 跑全量测试

```bash
npm run typecheck
npx vitest run
```

期望：127+6+ = 133+ PASS；typecheck clean。

### Step 9: 提交

```bash
git add package.json package-lock.json \
        src/shared/schemas.ts src/shared/schemas.test.ts \
        src/shared/types.ts src/main/ipc.ts src/main/ipc.test.ts
git commit -m "refactor(d): #11 — setSettings handler 加 zod schema 校验

AppSettingsSchema + AppSettingsPatchSchema 严格模式：
- 非法 theme / locale 长度拒绝
- 未知 key 拒绝（避免脏 patch 落盘）
- patch schema 允许 partial（setSettings 用）

ZodError 沿用 IPC reject promise 路径；renderer console.error 即可。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 3: #4 — registry 缓存 invalidate

**Files:**
- Modify: `src/shared/channels.ts`（加 PUSH_CHANNELS.sessionsChanged）
- Modify: `src/preload/index.ts`（暴露 onSessionsChanged）
- Modify: `src/main/index.ts`（sessions:create / sessions:kill 时广播 sessions:changed）
- Modify: `src/renderer/src/stores/registry.ts`
- Create: `src/renderer/src/stores/registry.test.ts`

### Step 1: 写 `src/renderer/src/stores/registry.test.ts`

先读现有 `registry.ts` 的 useRegistryStore API。

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useRegistryStore } from './registry'

const registryApi = { scan: vi.fn() }
const listeners: Array<() => void> = []
;(globalThis as unknown as { window: { api: { registry: typeof registryApi; onSessionsChanged: (cb: () => void) => () => void } } }).window = {
  api: {
    registry: registryApi,
    onSessionsChanged: (cb: () => void) => {
      listeners.push(cb)
      return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1) }
    }
  }
}

describe('useRegistryStore invalidate on sessions:changed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listeners.length = 0
    useRegistryStore.setState({ snapshot: null, fetchedAt: 0 } as any)
  })

  it('初始 scan 后有 snapshot', async () => {
    registryApi.scan.mockResolvedValue({ skills: [], mcp: [], agents: [] } as any)
    await useRegistryStore.getState().scan()
    expect(useRegistryStore.getState().snapshot).not.toBeNull()
  })

  it('收到 sessions:changed 事件后缓存清空，下次 scan 重新拉', async () => {
    registryApi.scan.mockResolvedValue({ skills: [], mcp: [], agents: [] } as any)
    await useRegistryStore.getState().scan()
    const snap1 = useRegistryStore.getState().snapshot
    expect(snap1).not.toBeNull()

    // 模拟 main 广播 sessions:changed
    listeners.forEach(fn => fn())

    expect(useRegistryStore.getState().snapshot).toBeNull()
    expect(useRegistryStore.getState().fetchedAt).toBe(0)

    await useRegistryStore.getState().scan()
    expect(registryApi.scan).toHaveBeenCalledTimes(2)
  })
})
```

### Step 2: 跑测试，确认失败

```bash
npx vitest run src/renderer/src/stores/registry.test.ts
```

### Step 3: 改 `src/shared/channels.ts`

加：
```ts
export const PUSH_CHANNELS = {
  // ... 既有
  sessionsChanged: 'sessions:changed'
} as const
```

并更新 `src/shared/channels.test.ts` 加一个断言。

### Step 4: 改 `src/preload/index.ts`

```ts
import { INVOKE_CHANNELS, PUSH_CHANNELS } from '@shared/channels'

// 在 onSessionData / onSessionExit 旁加：
onSessionsChanged: (cb: () => void): (() => void) => {
  const listener = () => cb()
  ipcRenderer.on(PUSH_CHANNELS.sessionsChanged, listener)
  return () => ipcRenderer.removeListener(PUSH_CHANNELS.sessionsChanged, listener)
}
```

### Step 5: 改 `src/main/index.ts`

找到 `registerIpc` 的 `sessions:create` handler 内（在 ipc.ts 里），加 `push(getWindow(), PUSH_CHANNELS.sessionsChanged, undefined)`。同样在 `sessions:kill` handler 加。

或者更优雅：在 `index.ts` 的 `registerIpc({...})` 块外，订阅 SessionManager 的 onRemove 事件——但 sessions:create 也需要 invalidate（用户开新 session 时，project 目录可能改变）。

**最简方案**：在 ipc.ts 的两个 handler 内：

```ts
ipcMain.handle(INVOKE_CHANNELS.sessions.create, (_e, cwd: string, launchClaude?: boolean): SessionSummary => {
  const summary = sessions.create(cwd, 80, 24, deps.shellFor(cwd), launchClaude ?? false)
  deps.onSessionCreated?.(cwd, summary.id)
  push(deps.getWindow(), PUSH_CHANNELS.sessionsChanged, undefined)
  return summary
})

ipcMain.handle(INVOKE_CHANNELS.sessions.kill, (_e, id: string) => {
  sessions.kill(id)
  push(deps.getWindow(), PUSH_CHANNELS.sessionsChanged, undefined)
})
```

### Step 6: 改 `src/renderer/src/stores/registry.ts`

在 store 初始化时订阅：

```ts
import { create } from 'zustand'

// 在 create() 之前订阅
if (typeof window !== 'undefined' && window.api?.onSessionsChanged) {
  window.api.onSessionsChanged(() => {
    useRegistryStore.setState({ snapshot: null, fetchedAt: 0 })
  })
}

export const useRegistryStore = create<RegistryState>()((set, get) => ({
  // ... 既有 fields
}))
```

具体写法按现有 useRegistryStore 结构。先读现有 registry.ts。

### Step 7: 跑测试

```bash
npx vitest run src/renderer/src/stores/registry.test.ts
npx vitest run
npm run typecheck
```

### Step 8: 提交

```bash
git add src/shared/channels.ts src/shared/channels.test.ts \
        src/preload/index.ts src/main/ipc.ts \
        src/renderer/src/stores/registry.ts \
        src/renderer/src/stores/registry.test.ts
git commit -m "refactor(d): #4 — registry 缓存随 sessions:changed invalidate

新增 PUSH_CHANNELS.sessionsChanged channel；
main 在 sessions:create / sessions:kill 时广播；
renderer useRegistryStore 订阅并清缓存；
下次 scan 重新拉取（保守 invalidate：宁可多拉）。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 4: #14 — streamJson 抽 parseEvents

**Files:**
- Create: `src/shared/streamEvents.ts`
- Modify: `src/main/tasks/streamJson.ts`
- Modify: `src/main/tasks/streamJson.test.ts`（既有测试保留 + 加 parseEvents 测试）

### Step 1: 写 `src/shared/streamEvents.ts`

```ts
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

### Step 2: 写 `parseEvents` 测试（扩展 `streamJson.test.ts`）

读现有 streamJson.test.ts 加：

```ts
import { parseEvents } from './streamJson'

describe('parseEvents (normalized)', () => {
  it('assistant text message → NormalizedEvent kind=text', () => {
    const raw = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hello' }] }
    })
    const events = parseEvents(raw)
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('text')
    expect(events[0]).toMatchObject({ kind: 'text', text: 'hello' })
  })

  it('assistant tool_use message → NormalizedEvent kind=tool_use', () => {
    const raw = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { cmd: 'ls' } }] }
    })
    const events = parseEvents(raw)
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('tool_use')
  })

  it('result event → NormalizedEvent kind=result', () => {
    const raw = JSON.stringify({ type: 'result', result: 'final answer' })
    const events = parseEvents(raw)
    expect(events.some(e => e.kind === 'result')).toBe(true)
  })

  it('多行混合 → 多个 events', () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'a' }] } }),
      JSON.stringify({ type: 'result', result: 'b' })
    ]
    const events = parseEvents(lines.join('\n'))
    expect(events).toHaveLength(3)
    expect(events.map(e => e.kind)).toEqual(['system', 'text', 'result'])
  })

  it('malformed JSON 行跳过', () => {
    const events = parseEvents('not-json\n' + JSON.stringify({ type: 'result', result: 'x' }))
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('result')
  })
})
```

### Step 3: 跑测试，确认失败

```bash
npx vitest run src/main/tasks/streamJson.test.ts
```

### Step 4: 改 `src/main/tasks/streamJson.ts`

保留既有 `parseStreamLine(line): StreamEvent | null` 为 compat 导出；新增 `parseEvents(raw: string): NormalizedEvent[]`。

```ts
// 既有 parseStreamLine 不动（保留 compat export）

// 新增 parseEvents
import { NormalizedEventSchema, type NormalizedEvent } from '@shared/streamEvents'

export function parseEvents(raw: string): NormalizedEvent[] {
  const events: NormalizedEvent[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let parsed: unknown
    try { parsed = JSON.parse(trimmed) } catch { continue }
    const obj = parsed as { type?: unknown; message?: { content?: unknown }; result?: unknown }
    if (typeof obj.type !== 'string') {
      events.push({ kind: 'unknown', raw: parsed })
      continue
    }
    switch (obj.type) {
      case 'assistant': {
        const content = obj.message?.content
        if (!Array.isArray(content)) {
          events.push({ kind: 'unknown', raw: parsed })
          break
        }
        for (const item of content) {
          const i = item as { type?: unknown; text?: unknown; id?: unknown; name?: unknown; input?: unknown }
          if (i.type === 'text' && typeof i.text === 'string') {
            events.push({ kind: 'text', text: i.text })
          } else if (i.type === 'tool_use' && typeof i.id === 'string' && typeof i.name === 'string') {
            events.push({ kind: 'tool_use', id: i.id, name: i.name, input: i.input })
          }
        }
        break
      }
      case 'result':
        events.push({ kind: 'result', text: typeof obj.result === 'string' ? obj.result : '' })
        break
      case 'system': {
        const sys = parsed as { subtype?: unknown }
        events.push({ kind: 'system', subtype: typeof sys.subtype === 'string' ? sys.subtype : '', data: parsed })
        break
      }
      default:
        events.push({ kind: 'unknown', raw: parsed })
    }
  }
  return events
}
```

**重构既有 `extractResultText` / `toTranscriptItems` 改用 parseEvents**：

```ts
export function extractResultText(events: NormalizedEvent[]): string {
  for (const e of events) {
    if (e.kind === 'result') return e.text
  }
  return ''
}

export function toTranscriptItems(events: NormalizedEvent[]): TranscriptItem[] {
  return events.flatMap(e => {
    switch (e.kind) {
      case 'text': return [{ kind: 'text', text: e.text }]
      case 'tool_use': return [{ kind: 'tool_use', id: e.id, name: e.name, input: e.input }]
      case 'result': return [{ kind: 'text', text: e.text }]
      default: return []
    }
  })
}
```

**保留**：`parseStreamLine` 既有函数（保留 export；不修改）。

### Step 5: 跑测试

```bash
npx vitest run src/main/tasks/streamJson.test.ts
npx vitest run
npm run typecheck
```

### Step 6: 提交

```bash
git add src/shared/streamEvents.ts \
        src/main/tasks/streamJson.ts \
        src/main/tasks/streamJson.test.ts
git commit -m "refactor(d): #14 — streamJson 抽 parseEvents + normalized events

@shared/streamEvents.ts 提供 NormalizedEvent zod schema 单一来源；
parseEvents(raw) 返回 NormalizedEvent[]；
extractResultText / toTranscriptItems 都从 normalized events 消费，
不再各自 walk + cast。

既有 parseStreamLine 保留为 compat export，不破坏调用方。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## 收尾

- [ ] **Task 5: 跑全量测试 + typecheck**

```bash
npm test
npm run typecheck
```

期望：127+6+ = 至少 133 PASS；typecheck clean。

- [ ] **Task 6: 写 D 类重构结果报告**

新建 `docs/superpowers/plans/2026-09-19-d-class-refactor-result.md`：
- 4 个 finding commit hash 列表
- 实际跑通的测试
- 任何 spec 偏离与原因

- [ ] **Task 7: 打 tag 0.1.2**

```bash
git tag -a 0.1.2 -m "v0.1.2 — D 类重构：@shared/channels + zod schemas + parseEvents"
git tag -l
```

---

## DoD 完成定义

- [ ] 4 个 finding 每个都有 commit，消息以 `refactor(d): #N` 开头
- [ ] `npm test` 全 PASS（127 baseline + 至少 6 新测试）
- [ ] `npm run typecheck` 无错误
- [ ] 既有测试未删除/未弱化（streamJson 既有测试保留）
- [ ] parseStreamLine 保留 compat export
- [ ] 新增 3 个 @shared/ 模块
- [ ] zod 加 dep
- [ ] D 类重构结果报告落档
- [ ] tag 0.1.2
