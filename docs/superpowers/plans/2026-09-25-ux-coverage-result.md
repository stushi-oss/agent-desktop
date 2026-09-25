# UX 反馈 + IPC 覆盖执行结果（Spec D · deep review 收官）

**日期**：2026-09-25
**Branch**：`ux-coverage`（已 merge 为 `2302336`）
**Baseline**：`fddbc80`（Spec D design）
**Plan**：`docs/superpowers/plans/2026-09-25-ux-coverage.md`

## 完成度

✅ **6/6 finding 全部修复并通过 spec + code 两级 review + final review**

| Finding | Commit | 状态 |
|---------|--------|------|
| #11 Modal Escape | `3f7ce57` | spec ✅ code ✅ |
| #7 #8 #10 toast + 三处接入 | `aede1dc` | spec ✅ code ✅ |
| #17 tasks zod | `d91fab5` + `0f2baf1` | spec ✅ code ✅（CHANGES REQUIRED 已闭环） |
| #16 IPC 测试补全（+23） | `11da43a` | spec ✅ code ✅ |
| 加固（update rethrow 等） | `0f2baf1` | 静默数据丢失路径关闭 |

**Final review**: ✅ APPROVED FOR MERGE + **19-finding 收官清单确认（零未登记遗留）**

## 测试结果

- **`npx vitest run`**: **266/266** PASS across **29 files**（baseline 226 + 40 new）
- **`npm run typecheck`**: clean

## zod 信任边界错误传播终态（三处全部用户可感知）

| 路径 | 失败时用户所见 |
|------|---------------|
| setSettings | toast + 受控 select 重拉真值（无视觉漂移） |
| tasks.create | TaskForm saveFailed 横幅 + 表单不关 |
| tasks.update | rethrow → TaskDrawer catch → saveFailed 横幅（0f2baf1 关闭的假成功路径） |

## 执行亮点与处置

1. **Task 1 implementer 自纠草案缺陷**：plan 草案的 store.remove 代码会丢 `withMutationGuard`（Spec A #3 的 push 防护），implementer 识别并保留 guard、rethrow 经 finally 正确传播。
2. **#17 review 抓出真实新回归**：`.int()` + 既有 update 吞错 → timeout 输入小数时表单假成功关闭、修改静默丢失。`0f2baf1` 一行 rethrow 关闭整类问题（含未来 schema drift），链路逐环验证 + guard 无泄漏单测。
3. **#16 超额**：预估 +16~20，实交 +23；20 个 channel 全勾选（implementer 纠正了"19"计数）。
4. 并行纪律零事故（Round 1 三路 + Round 2 串行）。

## 遗留 follow-up（低优，已登记）

- errMessage 生产未用（接进 toast 消息或作为约定 API 保留）
- TaskForm timeout 无字段级整数校验（0.5 只得通用 saveFailed）
- Toast 点击 dismiss 无键盘等价（5s 自动消失缓解）
- SettingsModal 快速连续 patch 的 refetch 晚到覆盖（窗口极小、自愈）
- 同刻多 Modal 一次 Escape 全关（现无堆叠场景；modal-in-modal 需栈式管理）
- ipc.test.ts 末尾换行；测试 channel 字面量 → INVOKE_CHANNELS 常量
- Spec C 遗留项见 `2026-09-24-performance-result.md`

## 用户手动冒烟（建议）

1. 创建会话失败 → 右下 toast、modal 留开（#7）
2. 模拟 setSettings reject → toast + select 不漂移（#8）
3. 删除任务失败 → 留详情页 + toast；成功 → 回列表（#10）
4. Escape 关三个 modal（#11）
5. timeout 填 0.5 → saveFailed 横幅、表单不假成功（#17 闭环）
6. toast 堆叠/自动消失/覆盖 modal（#7 基建）

## 整轮 deep review 总账（0.1.0 → 0.1.6）

| 版本 | spec | finding | 测试 |
|------|------|---------|------|
| 0.1.1 | A/B/C fixes | 11 | 110→127 |
| 0.1.2 | D 类重构 | 4 | →143 |
| 0.1.3 | Spec A 安全 | 4 critical | →177 |
| 0.1.4 | Spec B 正确性 | 4 | →199 |
| 0.1.5 | Spec C 性能 | 4 | →226 |
| **0.1.6** | **Spec D 收官** | **6** | **→266** |

**19 finding 全部闭环**（#18 随 Spec A #1 收口）；工作流：brainstorming → spec → plan → worktree → subagent-driven（implement → spec review → code review → fix loop → final review）→ merge → tag，六个周期全程执行。
