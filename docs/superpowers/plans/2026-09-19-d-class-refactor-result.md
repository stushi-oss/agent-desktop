# D 类重构执行结果

**日期**：2026-09-19
**Branch**：`d-class-refactor`
**Baseline**：`67239b1`（D 类重构 design）
**Plan**：`docs/superpowers/plans/2026-09-19-d-class-refactor.md`

## 完成度

✅ **4/4 finding 全部重构并通过 review**

| Finding | Commit | 类型 | 状态 |
|---------|--------|------|------|
| #12 IPC channels 统一 | `d0ab8c6` + `4748f1a` | 重构 | spec ✅ code ✅ |
| #11 setSettings zod | `f3f786e` + `e716038` | 验证 | spec ✅ code ✅ |
| #4 registry invalidate | `e8cedcc` | 状态 | spec ✅ code ✅ |
| #14 streamJson parseEvents | `5059a30` | 重构 | spec ✅ code ✅ |

## 测试结果

- **`npx vitest run`**: **143/143** PASS across **20 files**（baseline 142 + 1 regression test for LocaleSchema alignment）
- **`npm run typecheck`**: clean（node + web）

## 主要改动

### 新增 3 个 @shared 模块
- `src/shared/channels.ts` — INVOKE_CHANNELS (18) + PUSH_CHANNELS (7 含 sessionsChanged)
- `src/shared/schemas.ts` — ThemeSchema + LocaleSchema (enum) + AppSettingsSchema (strict) + AppSettingsPatchSchema
- `src/shared/streamEvents.ts` — NormalizedEventSchema (zod discriminated union)

### 改动现有模块
- `src/main/ipc.ts` — 所有 channel 字面量 → INVOKE_CHANNELS/PUSH_CHANNELS；setSettings 用 zod 校验；sessions:create/kill 广播 sessions:changed
- `src/main/index.ts` — push 字符串 → PUSH_CHANNELS
- `src/preload/index.ts` — 所有 invoke/on 字符串 → INVOKE_CHANNELS/PUSH_CHANNELS；新增 onSessionsChanged
- `src/main/tasks/streamJson.ts` — 新增 parseEvents 统一入口；保留 parseStreamLine compat；extractResultText/toTranscriptItems 改消费 NormalizedEvent[]
- `src/main/tasks/TaskRunner.ts` + `TaskService.ts` — 更新 callers 用 parseEvents
- `src/renderer/src/stores/registry.ts` — 订阅 sessions:changed 触发 invalidate
- `src/shared/types.ts` — AppSettings 改为 z.infer 别名

### 测试新增
- `src/shared/channels.test.ts` — 25 个 channel 字符串 snapshot
- `src/shared/schemas.test.ts` — 7 个 schema case (legal full/partial/enum locale/illegal theme/strict unknown/regression 对齐 loadSettings)
- `src/renderer/src/stores/registry.test.ts` — 2 个 invalidate case
- `src/main/tasks/streamJson.test.ts` — 新增 5 个 parseEvents 测试 + 迁移 6 个旧测试 (15 总)

## 偏离 spec 的地方

1. **Task 4 (#14) implementer 主动扩展 spec**：实现中发现 spec draft 的 `extractResultText` 只走 `kind: 'result'`，会失败 "assistant 文本与 result.result 同时存在 → 优先 assistant" 测试。改为 "last contiguous text run" pattern 保留原始语义。同时补 `isError` 字段、加 tool_use → 'tool' kind 映射（匹配 TranscriptItem）。所有既有测试保留。

2. **Task 3 (#4) implementer lazy 订阅**：原 spec 说"create() 之前订阅（store 顶层）"，但 test mock 时序下 top-level 订阅失败（window.api 还没装上）。改为 lazy `ensureInvalidateSubscription()` 在 scan() 内调。spec 已允 adaptive deviation。

3. **Task 2 (#11) LocaleSchema 类型 widening**：原 spec `LocaleSchema = z.string().min(2).max(10)` 被 code reviewer 标 Important——与 `loadSettings` 的 literal union 不一致，会接受 `fr-FR` 等但下次启动被 reset。fix commit `e716038` 改为 `z.enum(['system', 'zh-CN', 'en'])` 与 loadSettings 对齐。

4. **Phase 2 并行 implementer 冲突**：Task 2 和 Task 3 都改 `src/main/ipc.ts`，worktree 单一 working tree 实际不是真并行。Task 3 implementer 用 `git show HEAD:src/main/ipc.ts` + backup/restore 保住 sibling 工作；Task 2 的 zod 改动仍存，但 commit 时机 race。最终 `f3f786e` 仅含 Task 2，Task 3 在 `f6a3cd8` 独立 commit。

5. **Controller 操作错 amend**：我（controller）误把 trailing newline fix `git commit --amend` 到 Task 2 的 dangling commit 上而非 Task 3。撤销后用 `git reset --soft` + cherry-pick + 分组 commit 重建。最终 history 干净。

## 风险与回滚

- **风险 1**：zod 4.6.5 新依赖。仅 main 进程 + `@shared/` 使用，renderer bundle 不受影响。
- **风险 2**：新增 push channel `sessions:changed`。Spec 已豁免（既有 IPC 调用方不监听也不影响功能）。
- **风险 3**：LocaleSchema enum 收紧——若用户已在 settings.json 存了 `fr-FR`，下次启动会被 loadSettings reset 为 'system'（与修复前行为一致）。
- **回滚**：`git revert` Task 2/3/4 commits 或整个 branch revert。

## 用户手动验证（merge 前可选）

- 重启 dev：观察 store 缓存 invalidate（开关新 session 后 Extensions 抽屉立即刷新）
- 修改 settings.json 中的 locale 为 enum 外的值（如 `fr-FR`）→ 重启 → 应被 reset 为 'system'（验证 LocaleSchema 修复）

## 后续

1. 等待 final reviewer 报告
2. merge to main + tag 0.1.2
