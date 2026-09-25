# UX 反馈 + IPC 覆盖设计（Spec D）

**日期**：2026-09-25
**状态**：设计阶段，待用户审阅
**Baseline**：tag `0.1.5`（commit `1da93c5`）
**关联**：deep review 报告 finding #7, #8, #10, #11, #16, #17（#18 已在 Spec A 修复）

## 1. 目标

修复 deep review 最后 6 个 finding，补齐 UX 静默失败反馈 + IPC 信任边界：

- **#7**：NewSessionModal 创建失败 → modal 不关、无反馈（store 返 null 只有 console.error）
- **#8**：SettingsModal `patch` 无 try/catch → IPC reject 时 UI 静默回退
- **#10**：TaskDrawer delete `void remove(); setView(list)` 同步导航 → 失败也离开详情页
- **#11**：所有 Modal 无 Escape 关闭（键盘 a11y 缺口，5 个使用方）
- **#16**：IPC handler 层测试覆盖缺口（现有 7 测试只覆盖 security + handshake，19 个 handler 中 12+ 个零覆盖）
- **#17**：`tasks.update` patch 用 `Parameters<TaskService['update']>[1]` 泄漏内部签名跨界，无 zod（对比 setSettings 已有 AppSettingsPatchSchema）

## 2. 范围与非目标

### 本 spec 涉及
- 新增 renderer toast 体系（`useToast` store + `Toast` 组件 + App 挂载）
- #7/#8/#10 三处接入 toast
- Modal.tsx 加 Escape
- `@shared/schemas` 新增 TaskInputSchema/TaskPatchSchema；tasks.create/update handler 加 parse
- ipc.test.ts 补全剩余 handler 覆盖

### 不在本 spec
- focus trap / aria-modal 完整 a11y（仅 Escape，用户已选）
- store 层其他 console.error 静默点的系统性改造（仅动 remove 一处，因其被 #10 依赖）

## 3. 关键决策

| 决策点 | 结论 | 备选与否决理由 |
|--------|------|----------------|
| UX 反馈模式 | 共享 toast（zustand store + 固定定位组件） | inline 三处重复；各组件风格会漂移 |
| toast 文案 | 调用方传 `t()` 翻译串；组件只渲染 | 组件内 i18n 耦合 key 管理 |
| toast 行为 | 自动消失（5s）+ 可叠加 + danger/info 两态 | 交互式 toast 超范围 |
| #11 范围 | 仅 Escape（document keydown + cleanup） | focus trap 范围翻倍 |
| #17 范围 | update + create 都加 zod | 信任边界统一，对齐 setSettings 模式 |
| zod 校验深度 | **形状校验**（字段类型/discriminated schedule）；业务规则（cron 格式/once 未来时）留在 TaskService.validateInput | zod 重复业务逻辑会双源漂移 |
| store.remove 改造 | console.error 后 **rethrow**（唯一 caller 是 TaskDrawer） | 返 boolean 需改签名语义 |
| #16 深度 | 全 handler happy path + 关键错误分支（setSettings 非法 patch / pickDirectory 窗口销毁 / tasks.create 非法 input） | 纯委托 handler 也测（防注册遗漏/参数错位回归） |
| 调度 | Round 1 三路并行（Task 1 toast/Task 2 Escape/Task 3 zod）；Round 2 串行（Task 4 测试补全，覆盖 Task 3 的 parse 路径） | Task 3/4 同文件 ipc.ts* |

\* Task 3 改 `ipc.ts`（handler 加 parse），Task 4 改 `ipc.test.ts` —— 不同文件但强依赖（Task 4 要测 Task 3 的 parse 路径），故串行。

## 4. 文件结构

```
src/renderer/src/
├── components/ui/Toast.tsx            # 新（toast 渲染组件）
├── stores/toast.ts                    # 新（useToast store）
├── stores/toast.test.ts               # 新
├── App.tsx                            # 改（挂载 <Toast/>）
├── components/NewSessionModal.tsx     # 改（#7 接入）
├── components/SettingsModal.tsx       # 改（#8 接入）
├── components/tasks/TaskDrawer.tsx    # 改（#10 接入）
├── stores/tasks.ts                    # 改（remove rethrow）
├── components/ui/Modal.tsx            # 改（#11 Escape）
├── components/ui/Modal.test.tsx       # 新
└── i18n/（zh-CN/en 两份 locale）       # 改（新增 toast 文案 key）

src/shared/
├── schemas.ts                         # 改（TaskInputSchema + TaskPatchSchema）
└── schemas.test.ts                    # 改

src/main/
├── ipc.ts                             # 改（tasks.create/update 加 parse）
└── ipc.test.ts                        # 改（#16 补全 + zod 路径）
```

## 5. 详细设计

### Toast 体系（Task 1）

```ts
// src/renderer/src/stores/toast.ts
import { create } from 'zustand'

export interface ToastItem {
  id: number
  kind: 'danger' | 'info'
  message: string
}

interface ToastState {
  toasts: ToastItem[]
  show: (message: string, kind?: ToastItem['kind']) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  show: (message, kind = 'danger') => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 5000)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

/** 便捷调用：任意 catch 块里 useToastStore.getState().show(errMessage(e)) */
export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
```

```tsx
// src/renderer/src/components/ui/Toast.tsx
// 固定右下角堆叠；danger 红色调（复用 --danger CSS 变量）；点击条目 dismiss
export function Toast() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  if (toasts.length === 0) return null
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.message}
        </div>
      ))}
    </div>
  )
}
```

App.tsx 根部挂 `<Toast />`；新增 `.toast-stack`/`.toast` 样式（跟随既有 CSS 变量风格）。

i18n 新 key（zh-CN / en 两份同步）：`errors.sessionCreateFailed`、`errors.settingsSaveFailed`、`errors.taskDeleteFailed`。

### #7 NewSessionModal 接入

```tsx
const confirm = async (): Promise<void> => {
  if (!cwd || busy) return
  setBusy(true)
  const s = await createAndActivate(cwd, true)
  setBusy(false)
  if (s) onClose()
  else useToastStore.getState().show(t('errors.sessionCreateFailed'))  // modal 留开可重试
}
```

### #8 SettingsModal 接入

```tsx
const patch = async (p: Partial<AppSettings>): Promise<void> => {
  try {
    const next = await window.api.app.setSettings(p)
    setSettings(next)
    // ...既有 theme/locale 处理不变
  } catch (e) {
    useToastStore.getState().show(t('errors.settingsSaveFailed'), 'danger')
    // 失败后重拉一次真实状态，消除受控 select 的视觉回退差
    void window.api.app.getSettings().then(setSettings)
  }
}
```

### #10 TaskDrawer 接入 + store.remove rethrow

```ts
// stores/tasks.ts remove：console.error 后 rethrow（grep 确认唯一 caller 是 TaskDrawer）
remove: async (id) => {
  try { await window.api.tasks.remove(id) }
  catch (e) { console.error('remove task failed', e); throw e }
}
```

```tsx
// TaskDrawer
onDelete={() => {
  void remove(view.taskId)
    .then(() => setView({ kind: 'list' }))   // 成功才离开详情
    .catch(() => useToastStore.getState().show(t('errors.taskDeleteFailed')))
}}
```

### #11 Modal Escape（Task 2）

```tsx
// Modal.tsx
import { useEffect, type ReactNode } from 'react'

export function Modal({ title, onClose, children, width = 460 }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  // ...既有 JSX 不变
}
```

**注意**：多个 modal 叠开（如 TaskForm 在 Drawer 上）时 Escape 会同时关多层——现状最多一层 modal + drawer，TaskForm/Drawer 不是 Modal 实例；可接受，实现时 grep 确认无双层 Modal 场景。

### #17 TaskInputSchema / TaskPatchSchema（Task 3）

```ts
// @shared/schemas.ts 追加（形状校验；业务规则留 TaskService.validateInput）
const ScheduleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('interval'), minutes: z.number().int() }),
  z.object({ type: z.literal('cron'), expr: z.string().min(1) }),
  z.object({ type: z.literal('once'), at: z.string().min(1) })
])

export const TaskInputSchema = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1),
  cwd: z.string().min(1),
  schedule: ScheduleSchema,
  permissionMode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan']),
  model: z.string().optional(),
  timeoutMinutes: z.number().int().positive().optional(),
  notify: z.object({
    onComplete: z.boolean().optional(),
    onFailure: z.boolean().optional()
  }).optional()
}).strict()

export const TaskPatchSchema = TaskInputSchema.partial().strict()
```

（permissionMode 枚举值以 `@shared/types.ts` 实际定义为准——实现时核对。）

```ts
// ipc.ts
ipcMain.handle(INVOKE_CHANNELS.tasks.create, (_e, raw: unknown) =>
  tasks.create(TaskInputSchema.parse(raw))
)
ipcMain.handle(INVOKE_CHANNELS.tasks.update, (_e, rawId: unknown, rawPatch: unknown) =>
  tasks.update(z.string().parse(rawId), TaskPatchSchema.parse(rawPatch))
)
```

### #16 IPC 测试补全（Task 4）

在现有 `ipc.test.ts`（已有 electron vi.mock + makeDeps 基建）补：

| handler | 测试 |
|---------|------|
| sessions.write/resize/kill/list/rename | 各 1 条 happy（委托正确传参；kill 断言 sessionsChanged push） |
| app.pickDirectory | 窗口销毁返 null；对话框取消返 null（mock dialog） |
| registry.scan | 委托 deps.scanRegistry |
| app.getSettings / getClaudeStatus | 委托返回 |
| app.setSettings | happy（返回值 + settingsChanged push）；非法 patch 抛（既有 zod 路径回归锚） |
| tasks.list/history/create/update/remove/setEnabled/runNow | 各 1 条委托 happy；create 非法 input（TaskInputSchema）抛；update 非法 patch 抛（Task 3 新路径） |

预计 +16~20 测试。

## 6. 测试策略

| 任务 | 新测试 |
|------|--------|
| Task 1 | toast store：show 叠加/自动消失（fake timers）/dismiss；#7/#8/#10 各 1 条组件级测试（mock toast store 断言 show 被调）——组件级若 mock 成本过高可降级为 store 测试 + 手动冒烟 |
| Task 2 | Modal Escape：render → dispatch keydown Escape → onClose 被调；非 Escape 键不触发；卸载后监听移除 |
| Task 3 | schemas：合法 TaskInput / 各 schedule 变体 / 非法 permissionMode / 未知 key 拒绝 / patch partial |
| Task 4 | 上表 |

## 7. 错误处理与边缘情况

| 场景 | 行为 |
|------|------|
| toast 5s 自动消失期间组件卸载 | setTimeout 里 set 是 zustand 全局 store，安全 |
| SettingsModal patch 失败重拉 | 消除受控组件视觉与真实状态漂移 |
| store.remove rethrow 后其他未来 caller | grep 当前唯一 caller；新 caller 需自带 catch（文档在 store 注释） |
| Escape 与输入框 | 输入框聚焦时 Escape 仍关 modal（标准行为，无输入冲突场景） |
| TaskPatchSchema 的 schedule 整体替换 | partial 是浅层——patch schedule 必须给完整 schedule 对象（与 TaskService.update 现状语义一致） |

## 8. 风险与回滚

- **风险 1**：toast CSS 与现有主题变量冲突——复用 `--danger` 等既有变量，双主题各验一次
- **风险 2**：store.remove rethrow 改变 API 契约——唯一 caller 已同步更新；回滚一并还原
- **风险 3**：TaskInputSchema 与 TaskInput 类型漂移——schema 手写对齐 types.ts；typecheck 不能自动抓 zod 漂移，测试锚定关键字段
- **风险 4**：Escape 多层 modal 同关——现状无双层 Modal；实现时 grep 确认并记录

## 9. 实施完成定义（DoD）

- [ ] toast 体系（store + 组件 + App 挂载 + i18n key ×2 语言）
- [ ] #7/#8/#10 三处接入 + store.remove rethrow
- [ ] Modal Escape + 测试
- [ ] TaskInputSchema/TaskPatchSchema + tasks.create/update parse + 测试
- [ ] ipc.test.ts 补全（19 handler 全覆盖 happy + 关键错误）
- [ ] 全量测试通过（226 + ≥20 = 246+）
- [ ] typecheck clean

## 10. 调度

```
Round 1（三路并行，文件互不相交）:
  Task 1: toast 体系 + #7/#8/#10 接入（renderer 7 文件）
  Task 2: #11 Modal Escape（Modal.tsx + 新测试）
  Task 3: #17 zod schemas + tasks handler（@shared/schemas + ipc.ts）

Round 2（串行，依赖 Task 3 的 parse 路径）:
  Task 4: #16 ipc.test.ts 补全
```

**并行纪律**：沿用 Spec C（显式 model、只 add 明确文件、禁止 add . / -A）。

## 11. 用户手动验证（merge 前可选）

1. NewSessionModal 选一个不可写目录（权限）创建 → 红色 toast 出现、modal 留开
2. Settings 改语言 → 正常生效；devtools 里手动 reject setSettings → toast + select 不漂移
3. TaskDrawer 删除一个任务（正常）→ 跳回列表；断网/破坏 IPC 再删 → toast、留在详情页
4. 任意 modal 按 Escape → 关闭；Tab 键不受影响
5. 双主题下 toast 样式正常
