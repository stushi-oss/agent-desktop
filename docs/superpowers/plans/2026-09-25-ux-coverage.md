# UX 反馈 + IPC 覆盖实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 deep review 最后 6 个 finding（#7/#8/#10/#11 UX 静默失败 + Escape、#16 IPC 测试覆盖、#17 tasks zod），收官整轮 deep review。

**Architecture:** Round 1 三路并行（Task 1 toast 体系+三处接入 / Task 2 Modal Escape / Task 3 zod schemas+handler）；Round 2 串行（Task 4 IPC 测试补全，覆盖 Task 3 的 parse 路径）。

**Tech Stack:** Electron 44 · React 19 · zustand 5 · vitest 5 · zod 4.6.5 · i18next（既有）。

**Baseline:** tag `0.1.5` (commit `1da93c5`)。
Spec: `docs/superpowers/specs/2026-09-25-ux-coverage-design.md` (commit `fddbc80`)。

**事实核对（已验证）**：
- `PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions'`（**无 'plan'**，spec §5 草稿的枚举以此为准修正）
- Modal 使用方 3 个：SettingsModal / NewSessionModal / TranscriptView（无双层叠开，Escape 全局监听安全）
- `store.remove` 唯一 caller：TaskDrawer
- i18n：`src/renderer/src/i18n/{zh-CN,en}.ts` 顶层命名空间对象（`common: {...}`）

---

## 全局约定

1. **工作目录**：worktree `/Users/cramer/Documents/tools/agent-desktop/.worktrees/ux-coverage`。
2. **TDD**：先测试后实现。
3. **提交**：每 finding/task 一 commit，`fix(review): #N — 描述` 或 `test(review)`，结尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
4. **并行纪律**：只 `git add <明确文件>`，禁止 `git add .` / `-A` / `commit -a`。
5. **既有测试不删不弱化**：226 baseline。
6. **Branch**：`ux-coverage`，不动 main。

---

## 文件结构总览

| 文件 | 状态 | finding | 任务 |
|------|------|---------|------|
| `src/renderer/src/stores/toast.ts` | 新 | #7#8#10 基建 | Task 1 |
| `src/renderer/src/stores/toast.test.ts` | 新 | 同上 | Task 1 |
| `src/renderer/src/components/ui/Toast.tsx` | 新 | 同上 | Task 1 |
| `src/renderer/src/App.tsx` | 改（挂 Toast） | 同上 | Task 1 |
| `src/renderer/src/i18n/zh-CN.ts` + `en.ts` | 改（3 个 key） | 同上 | Task 1 |
| `src/renderer/src/components/NewSessionModal.tsx` | 改 | #7 | Task 1 |
| `src/renderer/src/components/SettingsModal.tsx` | 改 | #8 | Task 1 |
| `src/renderer/src/components/tasks/TaskDrawer.tsx` | 改 | #10 | Task 1 |
| `src/renderer/src/stores/tasks.ts` | 改（remove rethrow） | #10 | Task 1 |
| `src/renderer/src/components/ui/Modal.tsx` | 改 | #11 | Task 2 |
| `src/renderer/src/components/ui/Modal.test.tsx` | 新 | #11 | Task 2 |
| `src/shared/schemas.ts` + `.test.ts` | 改 | #17 | Task 3 |
| `src/main/ipc.ts` | 改（create/update parse） | #17 | Task 3 |
| `src/main/ipc.test.ts` | 改（补全） | #16 | Task 4 |

---

# Round 1（三路并行）

## Task 1: toast 体系 + #7/#8/#10 接入

**Files（只 add 这些）:**
- Create: `src/renderer/src/stores/toast.ts`、`src/renderer/src/stores/toast.test.ts`、`src/renderer/src/components/ui/Toast.tsx`
- Modify: `src/renderer/src/App.tsx`、`src/renderer/src/i18n/zh-CN.ts`、`src/renderer/src/i18n/en.ts`、`src/renderer/src/components/NewSessionModal.tsx`、`src/renderer/src/components/SettingsModal.tsx`、`src/renderer/src/components/tasks/TaskDrawer.tsx`、`src/renderer/src/stores/tasks.ts`

### Step 1: 写 `src/renderer/src/stores/toast.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useToastStore, errMessage } from './toast'

describe('useToastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    vi.useFakeTimers()
  })

  it('show 叠加两条', () => {
    useToastStore.getState().show('a')
    useToastStore.getState().show('b', 'info')
    const t = useToastStore.getState().toasts
    expect(t).toHaveLength(2)
    expect(t[0]).toMatchObject({ message: 'a', kind: 'danger' })
    expect(t[1]).toMatchObject({ message: 'b', kind: 'info' })
  })

  it('5s 自动消失', () => {
    useToastStore.getState().show('x')
    vi.advanceTimersByTime(5000)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('dismiss 移除指定条', () => {
    useToastStore.getState().show('a')
    useToastStore.getState().show('b')
    const id = useToastStore.getState().toasts[0].id
    useToastStore.getState().dismiss(id)
    const t = useToastStore.getState().toasts
    expect(t).toHaveLength(1)
    expect(t[0].message).toBe('b')
  })

  it('errMessage 提取 Error message / String 兜底', () => {
    expect(errMessage(new Error('boom'))).toBe('boom')
    expect(errMessage('raw')).toBe('raw')
  })
})
```

### Step 2: 跑测试确认失败 → Step 3: 创建 `stores/toast.ts`（按 spec §5 代码）→ Step 4: 跑过

### Step 5: 创建 `components/ui/Toast.tsx`（按 spec §5）+ 样式

在既有全局 CSS（找 `modal-overlay` 所在文件）追加：

```css
.toast-stack { position: fixed; right: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 8px; z-index: 1000; }
.toast { padding: 10px 14px; border-radius: 8px; font-size: 13px; cursor: pointer; max-width: 360px; box-shadow: 0 4px 16px rgba(0,0,0,.25); }
.toast-danger { background: var(--danger); color: #fff; }
.toast-info { background: var(--accent, #316dca); color: #fff; }
```

（变量名以现有 CSS 实际为准——grep `--danger`/`--accent` 核对。）

### Step 6: i18n key（两份同步）

`zh-CN.ts` / `en.ts` 顶层加（跟随现有命名空间风格，若已有 `errors:` 命名空间则并入）：

```ts
errors: {
  sessionCreateFailed: '创建会话失败',   // en: 'Failed to create session'
  settingsSaveFailed: '保存设置失败',     // en: 'Failed to save settings'
  taskDeleteFailed: '删除任务失败'        // en: 'Failed to delete task'
}
```

### Step 7: App.tsx 挂载

```tsx
import { Toast } from '@/components/ui/Toast'
// JSX 根部（与既有 drawer 同级）加 <Toast />
```

### Step 8: #7 NewSessionModal

```tsx
import { useToastStore } from '@/stores/toast'
// confirm 内：
if (s) onClose()
else useToastStore.getState().show(t('errors.sessionCreateFailed'))
```

### Step 9: #8 SettingsModal

```tsx
const patch = async (p: Partial<AppSettings>): Promise<void> => {
  try {
    const next = await window.api.app.setSettings(p)
    setSettings(next)
    if (p.theme) setMode(next.theme)
    if (p.locale) { /* 既有逻辑不变 */ }
  } catch {
    useToastStore.getState().show(t('errors.settingsSaveFailed'))
    void window.api.app.getSettings().then(setSettings)  // 消除视觉漂移
  }
}
```

### Step 10: #10 store.remove rethrow + TaskDrawer

```ts
// stores/tasks.ts（加注释：调用方需自带 catch）
remove: async (id) => {
  try { await window.api.tasks.remove(id) }
  catch (e) { console.error('remove task failed', e); throw e }
}
```

```tsx
// TaskDrawer L100
onDelete={() => {
  void remove(view.taskId)
    .then(() => setView({ kind: 'list' }))
    .catch(() => useToastStore.getState().show(t('errors.taskDeleteFailed')))
}}
```

### Step 11: 全量 + typecheck（226 + 4 = 230+）

### Step 12: 提交

```bash
git add <上面列出的 11 个文件>
git commit -m "fix(review): #7 #8 #10 — toast 体系 + 三处 UX 静默失败反馈

新增 useToast store + Toast 组件（5s 自动消失/可叠加/danger+info），
App 挂载，i18n key 双语言。

#7 NewSessionModal：创建失败 toast + modal 留开可重试
#8 SettingsModal：patch try/catch + toast + 失败重拉真实状态
#10 TaskDrawer：await remove 成功才离开详情页；
   store.remove console.error 后 rethrow（唯一 caller 已接 catch）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 2: #11 Modal Escape

**Files（只 add 2 个）:** `Modal.tsx`、新建 `Modal.test.tsx`

### Step 1: 写测试

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Modal } from './Modal'

describe('Modal Escape (#11)', () => {
  it('Escape 触发 onClose', () => {
    const onClose = vi.fn()
    render(<Modal title="t" onClose={onClose}>x</Modal>)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('非 Escape 键不触发', () => {
    const onClose = vi.fn()
    render(<Modal title="t" onClose={onClose}>x</Modal>)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(onClose).not.toHaveBeenCalled()
  })
  it('卸载后监听移除', () => {
    const onClose = vi.fn()
    const { unmount } = render(<Modal title="t" onClose={onClose}>x</Modal>)
    unmount()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).not.toHaveBeenCalled()
  })
})
```

（文件级 `afterEach(cleanup)` 若本文件无其他 describe 可省——参照 TerminalPane.test.tsx 的处理。）

### Step 2: 红 → Step 3: 改 Modal.tsx（spec §5 #11 代码，useEffect + document keydown + cleanup）→ Step 4: 绿

### Step 5: 提交（只 add 2 文件）

```bash
git commit -m "fix(review): #11 — Modal 加 Escape 关闭

document 级 keydown 监听 + 卸载 cleanup；3 个使用方
（SettingsModal/NewSessionModal/TranscriptView）自动受益。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 3: #17 zod schemas + handler

**Files（只 add 3 个）:** `src/shared/schemas.ts`、`src/shared/schemas.test.ts`、`src/main/ipc.ts`

### Step 1: 写测试（schemas.test.ts 追加）

```ts
import { TaskInputSchema, TaskPatchSchema } from './schemas'

const validInput = {
  name: 'demo', prompt: 'hi', cwd: '/tmp',
  schedule: { type: 'interval', minutes: 5 },
  permissionMode: 'default'
}

describe('TaskInputSchema (#17)', () => {
  it('合法 input（interval）通过', () => {
    expect(() => TaskInputSchema.parse(validInput)).not.toThrow()
  })
  it('cron / once 变体通过', () => {
    expect(() => TaskInputSchema.parse({ ...validInput, schedule: { type: 'cron', expr: '0 9 * * *' } })).not.toThrow()
    expect(() => TaskInputSchema.parse({ ...validInput, schedule: { type: 'once', at: '2026-10-01T00:00:00Z' } })).not.toThrow()
  })
  it('非法 permissionMode 拒绝（含已核实的枚举边界：无 plan）', () => {
    expect(() => TaskInputSchema.parse({ ...validInput, permissionMode: 'plan' })).toThrow()
    expect(() => TaskInputSchema.parse({ ...validInput, permissionMode: 'bypassPermissions' })).not.toThrow()
  })
  it('未知 key 拒绝（strict）', () => {
    expect(() => TaskInputSchema.parse({ ...validInput, rogue: 1 })).toThrow()
  })
  it('schedule 非法变体拒绝', () => {
    expect(() => TaskInputSchema.parse({ ...validInput, schedule: { type: 'interval', minutes: 'x' } })).toThrow()
    expect(() => TaskInputSchema.parse({ ...validInput, schedule: { type: 'nope' } })).toThrow()
  })
  it('TaskPatchSchema 允许 partial', () => {
    expect(() => TaskPatchSchema.parse({ name: 'renamed' })).not.toThrow()
    expect(() => TaskPatchSchema.parse({ enabled: true })).toThrow()  // enabled 不在 TaskInput 域
  })
})
```

> 注意：`enabled` 是 update handler 现有 `Partial<TaskInput> & { enabled?: boolean }` 的额外字段——TaskPatchSchema 需 `.extend({ enabled: z.boolean().optional() })` 后再 strict，或 handler 单独处理。**实现时读 `TaskService.update` 签名决定**，保持现有 IPC 行为（renderer 传 enabled 的调用路径不能破坏——grep TaskDrawer/TaskForm 的 update 调用确认）。

### Step 2: 红 → Step 3: schemas.ts 加 ScheduleSchema/TaskInputSchema/TaskPatchSchema（**permissionMode 枚举 = ['default','acceptEdits','bypassPermissions']**）→ Step 4: 绿

### Step 5: 改 ipc.ts 两 handler（spec §5 #17 代码；TaskPatchSchema 按 Step 1 决定的形态）

### Step 6: 全量 + typecheck（230 + 6 = 236+；既有 TaskService 测试不受影响——handler 层 parse 在 IPC 边界）

### Step 7: 提交（只 add 3 文件）

```bash
git commit -m "fix(review): #17 — tasks.create/update 加 zod（信任边界统一）

@shared/schemas 新增 TaskInputSchema + TaskPatchSchema
（discriminated schedule；permissionMode 枚举对齐 types.ts；
形状校验入 zod，cron 格式/once 未来时等业务规则留 TaskService）。

tasks.update 不再用 Parameters<TaskService['update']>[1]
泄漏内部签名；与 setSettings 的 AppSettingsPatchSchema 模式对齐。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

# Round 2（Task 3 完成后串行）

## Task 4: #16 IPC 测试补全

**Files（只 add 1 个）:** `src/main/ipc.test.ts`

### Step 1: 读现有 ipc.test.ts 基建（vi.mock('electron') + handlers map + makeDeps + _resetBootstrapForTests）

### Step 2: 补测试（目标：19 个 invoke handler 全覆盖 happy + 关键错误）

按 spec §5 #16 表格逐条写：
- sessions.write/resize/kill/list/rename 各 1 happy（断言委托传参；kill 断言 sessionsChanged push 被调——需要 mock getWindow 返回可 send 的假窗口，或断言 push 函数不抛即可）
- app.pickDirectory：窗口销毁返 null；dialog 取消返 null（mock electron dialog）
- registry.scan / app.getSettings / app.getClaudeStatus：委托返回
- app.setSettings：happy（返回值透传）；非法 patch 抛（zod 回归锚）
- tasks.list/history/remove/setEnabled/runNow：各 1 委托 happy
- tasks.create：happy 透传；非法 input 抛（Task 3 的 TaskInputSchema 路径）
- tasks.update：happy 透传；非法 patch 抛（Task 3 路径）

（sessions.create/transcript 已有 security 测试；sessionsReady 已有 handshake 测试——只需确认仍绿。）

### Step 3: 全量 + typecheck（236 + 16~20 = 252+）

### Step 4: 提交（只 add 1 文件）

```bash
git commit -m "test(review): #16 — IPC handler 测试覆盖补全

19 个 invoke handler 全覆盖 happy path + 关键错误分支
（setSettings 非法 patch / pickDirectory 窗口销毁与取消 /
tasks.create 非法 input / tasks.update 非法 patch 的 zod 路径）。
防 handler 注册遗漏与参数错位回归。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## 收尾

- [ ] 全量 ≥ 246 PASS + typecheck clean
- [ ] 结果报告 `docs/superpowers/plans/2026-09-25-ux-coverage-result.md`
- [ ] merge --no-ff + tag 0.1.6 + 删 branch/worktree

## DoD

- [ ] 6 finding 各有 commit（#7#8#10 合一 / #11 / #17 / #16）
- [ ] ≥246 PASS；typecheck clean
- [ ] 既有测试保留
- [ ] toast 双主题可用、i18n 双语言
- [ ] tag 0.1.6
