# Performance 执行结果

**日期**：2026-09-25
**Branch**：`performance`（已 merge 为 `7f6c787`）
**Baseline**：`05393dd`（Spec C design）
**Plan**：`docs/superpowers/plans/2026-09-24-performance.md`

## 完成度

✅ **4/4 finding 全部修复并通过 spec + code 两级 review + final review**

| Finding | Commit | 状态 |
|---------|--------|------|
| #14 流式 result 提取 | `03b1e11` | spec ✅ code ✅（1365 序列穷举 fuzz 等价验证） |
| #12 sessionDataBus 单订阅分发 | `63d0437` | spec ✅ code ✅ |
| #13 trimHistory 去 sort | `44dad6c` + `6159f2c`（loadStore 补 sort） | spec ✅ code ✅（500 样本 localeCompare 实证） |
| #15 resize rAF 合帧 | `1273acf` + `6159f2c`（guard 测试） | spec ✅ code ✅（mutation 三段复验） |
| review 加固 | `6159f2c` | rAF guard mutation 防护 + 6 项 minor |

**Final review**: ✅ APPROVED FOR MERGE（reviewer 独立复验 mutation、IPC surface 零变更、无死代码）

## 测试结果

- **`npx vitest run`**: **226/226** PASS across **27 files**（baseline 199 + 27 new）
- **`npm run typecheck`**: clean（node + web）

## 性能主张核验（final reviewer 确认"真正消除，非仅加测试"）

| finding | 前 | 后 |
|---------|----|----|
| #12 | N pane × 每 chunk N 次 listener | 全局 1 次订阅 + Map 直达路由 |
| #13 | 每次持久化 O(n log n) sort | 运行时 O(cap) slice；排序仅 load 冷路径 |
| #14 | events[] O(总 payload) 累积 | O(最长 text run) 滚动状态 |
| #15 | 每帧多次 fit + IPC | 每帧最多 1 次 fit；尺寸未变零 IPC |

## 执行异常与处置

1. **默认子代理模型不可用**：Round 1 三路首次派发全部 429（"订阅套餐未开放 GLM-5.3-FlashX"），worktree 零残留；改用显式 `model: sonnet` 重派三路全部成功。教训：此环境派 subagent 需显式指定模型。
2. **并行纪律生效**：三路并行（文件互不相交）+ 只 add 明确文件的强约束，本轮零 commit 抢占事故（对比 Spec A/B 的多次 race）。
3. **44dad6c 短暂引入真实隐患，同分支闭环**：trimHistory 改 slice-only 时 loadStore 未动，"乱序磁盘超 cap 按位置截断丢真正最新记录"被 code reviewer 抓出，`6159f2c` 一行修复 + 专项测试。
4. **#15 code review CHANGES REQUIRED**：rAF 合帧 guard（标题特性）mutation 存活零覆盖；fix agent 按 reviewer 已验证配方补测试并做三段 mutation 复验（HEAD 绿/删 guard 红/还原零残留）。

## 既有测试改动（1 处，判定为契约变更非弱化）

- TaskStore「trimHistory 保留最新 HISTORY_CAP 条」：原断言 sort-based 语义（#13 要删除的行为），改为降序输入下的 slice 语义；cap 截断覆盖保留，"最新保留"保证由 load 乱序守护测试 + fire 集成降序测试（cap+30 次真实 fire）端到端钉死。

## 遗留 follow-up（已登记，均低优）

- **激活 refit 直发 IPC**（TerminalPane.tsx ~L99-111）：切 tab 路径绕过 rAF 合帧/相等检查，其 rAF 也未 cancel；低频非风暴源，工整做法是复用 scheduleSync（需把 lastCols/lastRows 提为跨 effect ref）
- sessionDataBus：per-writer try/catch 异常隔离；app 生命周期单例行为文档化；同 id 重复注册覆盖语义在 split-view 场景需重审
- load 路径双重排序（loadStore + TaskService.load）：≤230 条启动一次，防御性冗余
- spec §4/§5 措辞冲突（loadStore 是否排序）：实现遵循 §5，§4 为不精确缩写
- **Spec D**（7 finding：#7/#8/#10/#11 UX silent failures + Modal Escape、#16 IPC 测试覆盖、#17 tasks.update zod、#18 RunRecord 路径泄漏）

## 用户手动冒烟（建议）

1. 3+ pane 高吞吐输出（`yes | head -n 100000`）→ 其他 pane 无抖动、CPU 无线性放大（#12）
2. 拖拽窗口 resize → 流畅、字符不错位（#15）
3. 关闭全部会话再新建 → 输出正常流入（bus 单例存活）（#12）
4. 小时级 scheduled run → 内存曲线平坦 + resultText 正确（#14）
5. 手工构造乱序/超 cap history.json 重启 → 显示恰好最新 200 条降序（#13）
