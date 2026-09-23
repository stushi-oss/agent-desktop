# Security Hardening 设计

**日期**：2026-09-23
**状态**：设计阶段，待用户审阅
**Baseline**：tag `0.1.2`（commit `be9fe1b`）
**关联**：deep review 报告 finding #1, #2, #3, #11

## 1. 目标

修复 deep review 中标记的 **4 个 critical security finding**，统一到 `@shared/security.ts` 抽象中心 + IPC handler 入口 zod 校验 + 主进程 sanitization：

- **#1**：tasks.transcript 接受 renderer-supplied transcriptPath → **任意本地文件读**
- **#2**：sessions.create 接受任意 cwd + login shell → **rc 文件 RCE**
- **#3**：probeUserEnv 把 login shell secrets 注入 process.env → **API key/token 泄露**
- **#11**：RegistryScanner symlink-follow → **恶意插件一键 shell 注入**

## 2. 范围与非目标

### 本 spec 涉及
- 4 个 critical security finding
- 新增 `@shared/security.ts`（path validators + env filter）
- `src/main/ipc.ts` handler 入口统一校验
- `src/main/env.ts` probe 逻辑收紧
- `src/main/registry/RegistryScanner.ts` symlink guard

### 不在本 spec
- ux/perf/test-coverage/architecture 类的 15 个 important finding（Spec B/C/D 跟进）
- D 类重构（已完成 0.1.2）

## 3. 关键决策

| 决策点 | 结论 | 备选与否决理由 |
|--------|------|----------------|
| 抽象中心 | `@shared/security.ts` | 与既有 @shared 模块协同；preload/renderer 也能 import（schema 层） |
| 校验位置 | IPC handler 入口（zod parse + custom guard） | 边界统一；handler 内部假定输入已校验 |
| Path 校验策略 | `path.resolve` + `realpathSync` + 白名单父目录 | realpath 防 symlink；白名单限制可访问区域 |
| Env 黑名单 | 拒绝 `*TOKEN`, `*KEY`, `*SECRET`, `*PASSWORD`, `ANTHROPIC_*`, `AWS_*`, `GITHUB_*`, `*PRIVATE*` 等 | 保守策略：宁可漏掉也不能泄露 |
| Symlink 策略 | `lstat` 跳过 symlink（默认根 `~/.claude`） | spec 已选定；plugin 开发者不能用 ln 但安全 |
| IPC 协议表面 | **改变** | runId-based lookup 是 API 改善（contract 改善），但 spec 范围明确允许；其他 channel 不动 |
| transcript IPC | 接受 `{ runId, taskId }` 而不是完整 `RunRecord` | 强制 main 端用 id 找路径，renderer 不能选文件 |
| sessions.create cwd | 加 zod schema + `path.resolve` + `realpathSync` 必须存在 + 父目录在白名单 | 防止 RCE 和任意路径 |
| env probe 输出 | 全部 key/value 经过黑名单过滤后再 merge | 防止 secrets 进 process.env |
| symlink guard | plugin/agents 目录内每个文件 lstat，symlink 跳过 | 防止恶意 plugin |

## 4. 文件结构

```
src/shared/
├── security.ts            # 新：path validators + env blacklist + zod schemas
├── security.test.ts       # 新：测试所有 validator
└── types.ts               # 改：RunRecord 重导出 zod inferred 类型（v0.2 计划）

src/main/
├── ipc.ts                 # 改：handler 入口用 @shared/security 校验
├── ipc.test.ts            # 新（部分覆盖 #16 的子集）
├── env.ts                 # 改：envFilter + 黑名单
├── env.test.ts            # 改：加 blacklist 测试
├── registry/RegistryScanner.ts  # 改：lstat-based symlink guard
└── ...

src/preload/
└── index.ts               # 改：transcript IPC 签名 { runId, taskId } 不再传 RunRecord
```

## 5. 详细设计

### `@shared/security.ts`

```ts
import { z } from 'zod'
import { resolve } from 'node:path'

// ---------- Path validators ----------

/** 解析路径并验证是绝对路径（不检查存在） */
export function safeAbsPath(p: unknown): string {
  if (typeof p !== 'string' || !p) throw new SecurityError('path must be non-empty string')
  const resolved = resolve(p)
  if (!resolved.startsWith('/')) throw new SecurityError('path must be absolute')
  return resolved
}

/** 验证路径在白名单父目录内 */
export function pathWithinParents(p: string, parents: string[]): void {
  const resolved = resolve(p)
  for (const parent of parents) {
    if (resolved.startsWith(resolve(parent) + '/') || resolved === resolve(parent)) return
  }
  throw new SecurityError(`path not under any of: ${parents.join(', ')}`)
}

/** 验证目录存在且不是 symlink */
export function assertRealDir(p: string): void {
  const stat = lstatSync(p)
  if (stat.isSymbolicLink()) throw new SecurityError('symlinks not allowed')
  if (!stat.isDirectory()) throw new SecurityError('not a directory')
}

// ---------- Env blacklist ----------

const SENSITIVE_ENV_PATTERNS = [
  /^ANTHROPIC_/i, /^AWS_/i, /^GITHUB_/i, /^OPENAI_/i,
  /TOKEN$/i, /KEY$/i, /SECRET$/i, /PASSWORD$/i, /PRIVATE/i
]

/** 过滤敏感 env vars；返回安全副本 */
export function filterSensitiveEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(env)) {
    if (SENSITIVE_ENV_PATTERNS.some(re => re.test(k))) continue
    out[k] = v
  }
  return out
}

// ---------- zod schemas ----------

/** sessions.create cwd: must be non-empty string */
export const CwdSchema = z.string().min(1).max(4096)

/** tasks.transcript request: just runId + taskId */
export const TranscriptRequestSchema = z.object({
  taskId: z.string().uuid(),
  runId: z.string().uuid()
})

// ---------- types ----------

export class SecurityError extends Error {
  constructor(msg: string) { super(`security: ${msg}`); this.name = 'SecurityError' }
}
```

### 修改 IPC handlers

```ts
// src/main/ipc.ts

import { CwdSchema, TranscriptRequestSchema, safeAbsPath, pathWithinParents, SecurityError, assertRealDir } from '@shared/security'

// sessions.create
ipcMain.handle(INVOKE_CHANNELS.sessions.create, (_e, rawCwd: unknown, launchClaude?: boolean): SessionSummary => {
  const cwd = CwdSchema.parse(rawCwd)  // 抛 ZodError if invalid
  assertRealDir(cwd)  // 抛 SecurityError if symlink or not dir
  pathWithinParents(cwd, [homedir()])  // cwd 必须在 home 下
  const summary = sessions.create(cwd, 80, 24, deps.shellFor(cwd), launchClaude ?? false)
  deps.onSessionCreated?.(cwd, summary.id)
  push(deps.getWindow(), PUSH_CHANNELS.sessionsChanged, undefined)
  return summary
})

// tasks.transcript — 改为 runId-based lookup，不再信 renderer-supplied path
ipcMain.handle(INVOKE_CHANNELS.tasks.transcript, (_e, rawReq: unknown): TranscriptItem[] => {
  const req = TranscriptRequestSchema.parse(rawReq)
  return toTranscriptItems(tasks.readTranscriptByRunId(req.taskId, req.runId))
})

// TaskService 新增方法：
readTranscriptByRunId(taskId: string, runId: string): NormalizedEvent[] {
  // 路径必须 baseDir/runs/<taskId>/<runId>.jsonl
  // 用 runsDir + taskId + runId 重新拼，不信 RunRecord
  const path = join(this.deps.runsDir, taskId, `${runId}.jsonl`)
  return this.readTranscript({ transcriptPath: path, /* 其 rest 是 RunRecord shape */ } as RunRecord)
}
```

### 修改 env.ts

```ts
import { filterSensitiveEnv } from '@shared/security'

// probeUserEnv 用 filterSensitiveEnv
export function probeUserEnv(...): NodeJS.ProcessEnv | null {
  // ... 现有逻辑 ...
  return filterSensitiveEnv(parseEnvOutput(stdout))
}

// mergedEnv 用 filterSensitiveEnv
export function mergedEnv(base: NodeJS.ProcessEnv, probed: NodeJS.ProcessEnv | null): NodeJS.ProcessEnv {
  if (!probed) return base
  return { ...base, ...filterSensitiveEnv(probed) }
}
```

### 修改 RegistryScanner symlink guard

```ts
import { lstatSync } from 'node:fs'

function walkDir(dir: string, ...): Skill[] {
  const stat = lstatSync(dir)  // 不 follow symlink
  if (stat.isSymbolicLink()) return []  // 跳过整个目录
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const es = lstatSync(full)
    if (es.isSymbolicLink()) continue  // 跳过 symlink 文件
    if (es.isDirectory()) walkDir(full, ...)
    else if (entry.endsWith('.md')) parseSkill(full)
  }
}
```

**白名单**：`~/.claude/plugins/cache`、`~/.claude/agents`、`~/.claude/skills` 是允许扫描的根；其他路径不扫。**所有低于这些根的 symlink 跳过**。

### IPC 协议表面变更

- `tasks.transcript`：输入从 `RunRecord` 改为 `{ taskId: string; runId: string }`
- `sessions.create`：输入 schema 收紧（不变 schema，加 zod parse）
- 其他 IPC handler 不变

**这影响 renderer**：`window.api.tasks.transcript(rec)` → `window.api.tasks.transcript({ taskId, runId })`。需要更新所有 caller。

## 6. 测试策略

### 新增测试

`@shared/security.test.ts`：
- safeAbsPath: 非空字符串、绝对路径、相对路径拒绝
- pathWithinParents: 白名单内/外
- assertRealDir: 真实目录、symlink 拒绝、文件拒绝
- filterSensitiveEnv: ANTHROPIC_API_KEY 过滤、PATH 保留
- zod schemas: 合法/非法用例

`src/main/ipc.test.ts`（部分覆盖 spec #16）：
- sessions.create：合法 cwd 通过、symlink 拒绝、不存在目录拒绝
- tasks.transcript：runId-based lookup 工作、不存在的 runId 返回 []- env.test.ts：filterSensitiveEnv 集成测试

## 7. 错误处理与边缘情况

| 场景 | 行为 |
|------|------|
| sessions.create 收到相对路径 | ZodError → IPC reject |
| sessions.create 收到 symlink 目录 | SecurityError → IPC reject |
| sessions.create cwd 不存在 | SecurityError → IPC reject |
| sessions.create cwd 超出 home | SecurityError → IPC reject |
| tasks.transcript runId 不存在 | readTranscriptByRunId 返回 []（不抛） |
| tasks.transcript runId 但 transcript 文件缺失 | readFileSync 抛 ENOENT → IPC reject |
| env probe 含 ANTHROPIC_API_KEY | filterSensitiveEnv 过滤后不会进 process.env |
| registry symlink | lstat 检测到 symlink → 跳过 |

## 8. 风险与回滚

- **风险 1**：sessions.create 收紧后用户创建 session 受限（如尝试 create session 在 /tmp）
  - 缓解：白名单允许 home 下任何非 symlink 目录
  - 回滚：放宽白名单或改回 path-only 校验
- **风险 2**：transcript IPC 协议变更是 breaking change
  - 缓解：renderer caller 数量有限（grep）
  - 回滚：handler 仍兼容旧 RunRecord 输入（带 fallback）
- **风险 3**：env 黑名单漏掉新 secret prefix
  - 缓解：patterns 是 conservative 列表；新增 secret 时人工 review
  - 回滚：白名单模式（reject all 未在白名单的）

## 9. 实施完成定义（DoD）

- [ ] `@shared/security.ts` + test 新文件
- [ ] IPC handler 入口加 zod parse + 安全 guard
- [ ] `tasks.transcript` 改为 runId-based lookup
- [ ] preload 暴露新签名；renderer caller 更新
- [ ] `probeUserEnv` / `mergedEnv` 用 filterSensitiveEnv
- [ ] RegistryScanner 加 lstat symlink guard
- [ ] env.test.ts 加 blacklist 测试
- [ ] ipc.test.ts 加 session.create + tasks.transcript 安全测试
- [ ] 全量测试通过（baseline 143 + 至少 12 新 = 155+）
- [ ] typecheck clean
- [ ] 没有发现新的 security regression

## 10. 调度

单 spec plan 内：
- Phase 1（串行）：Task 1 — `@shared/security.ts` + 测试
- Phase 2（并行）：Task 2 — IPC handler 安全化（#1 #2）+ Task 3 — env filter（#3）+ Task 4 — RegistryScanner symlink guard（#11）

## 11. 用户手动验证（merge 前可选）

- 创建 session 在 `~/Downloads` —— 应工作
- 创建 session 在 `/tmp` —— 应被拒（不在 home 下）
- 创建 session 在 `/etc` —— 应被拒
- 创建 symlink `~/malicious` → `/tmp` —— 在 NewSessionModal 选 `~/malicious`，应被拒
- 修改 `~/.zshenv` 加 `ANTHROPIC_API_KEY=hacked`，启动 → 检查 `app.getClaudeStatus` 后 `echo $ANTHROPIC_API_KEY` 在 process.env 应为空
- `~/.claude/plugins/cache` 下创建 symlink 指向 `/etc/passwd` —— Extensions 抽屉中该 skill 应不显示