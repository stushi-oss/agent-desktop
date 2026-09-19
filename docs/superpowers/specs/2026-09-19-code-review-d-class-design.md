# Code Review D 类修复设计（待完善）

**日期**：2026-09-19
**状态**：骨架，design 阶段延后
**关联 spec**：`docs/superpowers/specs/2026-09-19-code-review-fixes-design.md`

## 包含 finding（D 类：重构/质量债）

| # | finding | 文件 | 类别 |
|---|---------|------|------|
| 4 | useRegistryStore 60s 缓存不随 cwd 失效 | `src/renderer/src/stores/registry.ts:17` | 状态正确性 |
| 11 | app:setSettings handler 无 schema 校验 | `src/main/ipc.ts:86` | 验证缺失 |
| 12 | CHANNELS 常量只覆盖 3 个 IPC channel，preload 与 main 散落 18 个字符串 | `src/preload/index.ts:15` + 散落 | 重构 |
| 14 | streamJson.extractResultText / toTranscriptItems 重复 walk + 重复 shape cast | `src/main/tasks/streamJson.ts:18` | 重构 |

## 范围与非目标

### 本 spec 涉及
- A 11 个 finding 中的 4 个被独立拆出，本 spec 跟踪
- 修复时机：下一次 sprint

### 不在本 spec
- 已在主 spec 中完成的 11 个 fix（commits `5e6578b`..`93f8bf7`）

## 待 design 阶段定

### Finding #4 — registry 缓存
- 触发条件：active session cwd 改变时强制 invalidate
- 候选方案：
  - 监听 `onSessionCreated` / `onSessionRemoved` 主动清除缓存
  - 改成单飞（single-flight）：同 cwd 复用同 promise
  - 维持 60s TTL 但加订阅接口让上层强制刷新
- 抽象边界：缓存语义在哪一层？renderer 还是 main？

### Finding #11 — setSettings schema
- 候选方案：
  - 用 zod 在 ipc handler 入口做校验（runtime cost）
  - 抽 AppSettings 类型 → schema 单一事实来源（编译期）
  - 简单白名单：handler 端只接受 known keys
- 与 IPC 协议表面变更的权衡

### Finding #12 — CHANNELS 统一
- 候选方案：
  - 抽 `@shared/channels.ts` 单一来源，preload + main 都从这里 import
  - runtime 校验 channel 字符串（cost 高，不建议）
  - 把 18 个字符串提到 const enum（避免 string typos）
- 现状评估：`CHANNELS` 当前在 `src/main/ipc.ts:27-31` 只覆盖 3 个推送 channel（session:data / session:exit / tasks:changed）。其他 15 个 invoke channel 在 main 和 preload 散落。

### Finding #14 — streamJson 重构
- 候选方案：
  - 抽 `parseEvents(raw: string): StreamEvent[]` 单一入口
  - 抽 `selectContentEvents(events): ContentEvent[]` 中间表示
  - 在源头处加运行时校验（区分 'assistant.message.content[].type === text/tool_use/thinking' 等）
- 测试策略：现有 `streamJson.test.ts` 应同时覆盖 extractResultText 和 toTranscriptItems；重构后这两个函数都从一个 normalized events 列表消费。

## 依赖关系

| finding | 依赖 |
|---------|------|
| #11 | 共享 AppSettings 类型（@shared/types.ts）已存在 |
| #12 | 可与 #11 共用一个 schema 来源 |
| #4 | 需要 sessions.onSessionCreated 已就位（已完成）+ onSessionRemoved |
| #14 | 独立 |

## 并行/串行调度

候选：分两批并行
- 批 A（独立）：#11、#14
- 批 B（可与 A 并行）：#4、#12
- 批 A + 批 B 共 4 个 subagent 同时启动

或串行 by file：
- 先 #4（最小 diff）
- 再 #11
- 再 #14（影响 TaskRunner）
- 再 #12（跨文件重构，最后做）

## 测试策略

- #4：renderer store 测试（zustand）— 监听事件触发缓存清除
- #11：handler 测试 — 非法 patch 应被拒绝
- #12：snapshot test — 所有 channel 字符串在 import 时一致
- #14：现有 streamJson 测试 + 新增 invariant 测试

## 触发

下一次 sprint 启动时由独立 brainstorming 会话完成完整 design + plan。
