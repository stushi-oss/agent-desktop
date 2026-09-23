# Security Hardening 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 deep review 4 个 critical security finding，统一到 `@shared/security.ts` 抽象中心。

**Architecture:** TDD；Phase 1 串行（@shared/security.ts）+ Phase 2 三路并行（IPC handler / env filter / RegistryScanner symlink guard）。IPC 协议 surface 改变：`tasks.transcript` 输入从 `RunRecord` 改为 `{ taskId, runId }`。

**Tech Stack:** Electron 44 · TypeScript 5.9 · vitest 5 · zod 4.6.5 (既有) · Node.js fs/path/crypto (built-in)。

**Baseline:** tag `0.1.2` (commit `be9fe1b`)。
Spec: `docs/superpowers/specs/2026-09-23-security-hardening-design.md` (commit `48f7cb6`)。

---

## 全局约定

1. **工作目录**：所有命令都在 worktree `/Users/cramer/Documents/tools/agent-desktop/.worktrees/security-hardening` 执行。
2. **TDD**：先写测试（vitest），看到失败再实现，看到通过再提交。
3. **提交**：每个 finding 一组 commit，消息 `fix(review): #N — 描述`，结尾加 `Co-Authored-By: Claude Code < <noreply@anthropic.com>`。
4. **既有测试不删除/不弱化**：143 baseline 必须保留。
5. **IPC 协议 surface**：tasks.transcript 改 contract 是 spec 明确允许；其他 IPC handler 不动。
6. **Branch 纪律**：所有改动在 `security-hardening` 分支，不动 main。

---

## 文件结构总览

| 文件 | 状态 | finding | 备注 |
|------|------|---------|------|
| `src/shared/security.ts` | 新建 | #1 #2 #3 | validators + filter + schemas |
| `src/shared/security.test.ts` | 新建 | #1 #2 #3 | 全部 validator 测试 |
| `src/main/ipc.ts` | 改 | #1 #2 | sessions.create + tasks.transcript 安全化 |
| `src/main/ipc.test.ts` | 新建 | #1 #2 | handler 测试 |
| `src/main/tasks/TaskService.ts` | 改 | #1 | 新增 readTranscriptByRunId |
| `src/main/env.ts` | 改 | #3 | filterSensitiveEnv 集成 |
| `src/main/env.test.ts` | 改 | #3 | 黑名单测试 |
| `src/main/registry/RegistryScanner.ts` | 改 | #11 | lstat symlink guard |
| `src/preload/index.ts` | 改 | #1 | tasks.transcript 签名变 { taskId, runId } |
| `src/renderer/src/stores/tasks.ts` | 改 | #1 | tasks.transcript caller 更新 |
| `src/renderer/src/components/tasks/TranscriptView.tsx` | 改 | #1 | 调用更新 |

---

## 调度

```
Phase 1（串行）        Phase 2（并行）
──────────────         ──────────────────────────────────
Task 1: #3 @shared/security.ts  Task 2: #1 #2 IPC handler 安全化
                       Task 3: #3 env filter 集成
                       Task 4: #11 RegistryScanner symlink guard
```

---

# Phase 1：Task 1 — `@shared/security.ts`

## Task 1: 新建 `@shared/security.ts` + 完整测试

**Files:**
- Create: `src/shared/security.ts`
- Create: `src/shared/security.test.ts`

### Step 1: 写 `src/shared/security.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  safeAbsPath, pathWithinParents, assertRealDir,
  filterSensitiveEnv, CwdSchema, TranscriptRequestSchema, SecurityError
} from './security'

describe('safeAbsPath', () => {
  it('接受绝对路径', () => {
    expect(safeAbsPath('/tmp/foo')).toBe('/tmp/foo')
  })
  it('拒绝空字符串', () => {
    expect(() => safeAbsPath('')).toThrow(SecurityError)
  })
  it('拒绝非字符串', () => {
    expect(() => safeAbsPath(123)).toThrow(SecurityError)
    expect(() => safeAbsPath(null)).toThrow(SecurityError)
  })
  it('解析相对路径为绝对路径', () => {
    const r = safeAbsPath('relative/foo')
    expect(r.startsWith('/')).toBe(true)
  })
})

describe('pathWithinParents', () => {
  it('白名单内路径通过', () => {
    expect(() => pathWithinParents('/home/user/Downloads', ['/home/user'])).not.toThrow()
  })
  it('白名单外路径拒绝', () => {
    expect(() => pathWithinParents('/etc/passwd', ['/home/user'])).toThrow(SecurityError)
  })
  it('白名单边界等于父路径通过', () => {
    expect(() => pathWithinParents('/home/user', ['/home/user'])).not.toThrow()
  })
})

describe('assertRealDir', () => {
  let tmp: string
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'sec-')) })
  it('真实目录通过', () => {
    expect(() => assertRealDir(tmp)).not.toThrow()
  })
  it('symlink 拒绝', () => {
    const link = join(tmpdir(), `sec-symlink-${Date.now()}`)
    symlinkSync(tmp, link)
    expect(() => assertRealDir(link)).toThrow(SecurityError)
  })
  it('文件拒绝（不是目录）', () => {
    const f = join(tmp, 'file.txt')
    writeFileSync(f, 'x')
    expect(() => assertRealDir(f)).toThrow(SecurityError)
  })
})

describe('filterSensitiveEnv', () => {
  it('ANTHROPIC_API_KEY 被过滤', () => {
    const out = filterSensitiveEnv({ ANTHROPIC_API_KEY: 'secret', PATH: '/usr/bin' })
    expect(out).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(out.PATH).toBe('/usr/bin')
  })
  it('*TOKEN 后缀被过滤', () => {
    const out = filterSensitiveEnv({ GITHUB_TOKEN: 'x', MY_TOKEN: 'y', HOME: '/home/u' })
    expect(out).not.toHaveProperty('GITHUB_TOKEN')
    expect(out).not.toHaveProperty('MY_TOKEN')
    expect(out.HOME).toBe('/home/u')
  })
  it('*KEY / *SECRET / *PASSWORD 被过滤', () => {
    const out = filterSensitiveEnv({ AWS_SECRET_KEY: 'k', DB_PASSWORD: 'p', LANG: 'en' })
    expect(out).not.toHaveProperty('AWS_SECRET_KEY')
    expect(out).not.toHaveProperty('DB_PASSWORD')
    expect(out.LANG).toBe('en')
  })
  it('大小写不敏感', () => {
    const out = filterSensitiveEnv({ 'anthropic_api_key': 'x', 'PATH': '/y' })
    expect(out).not.toHaveProperty('anthropic_api_key')
    expect(out.PATH).toBe('/y')
  })
})

describe('CwdSchema', () => {
  it('非空字符串通过', () => {
    expect(() => CwdSchema.parse('/home/user')).not.toThrow()
  })
  it('空字符串拒绝', () => {
    expect(() => CwdSchema.parse('')).toThrow()
  })
  it('非字符串拒绝', () => {
    expect(() => CwdSchema.parse(123)).toThrow()
  })
  it('超长字符串拒绝（>4096）', () => {
    expect(() => CwdSchema.parse('a'.repeat(5000))).toThrow()
  })
})

describe('TranscriptRequestSchema', () => {
  it('合法 uuid 通过', () => {
    expect(() => TranscriptRequestSchema.parse({
      taskId: '00000000-0000-0000-0000-000000000001',
      runId: '00000000-0000-0000-0000-000000000002'
    })).not.toThrow()
  })
  it('非法 uuid 拒绝', () => {
    expect(() => TranscriptRequestSchema.parse({ taskId: 'x', runId: 'y' })).toThrow()
  })
})
```

### Step 2: 跑测试，确认失败

```bash
cd /Users/cramer/Documents/tools/agent-desktop/.worktrees/security-hardening
npx vitest run src/shared/security.test.ts
```

期望：FAIL（`./security` 模块不存在）。

### Step 3: 创建 `src/shared/security.ts`

```ts
// src/shared/security.ts
import { z } from 'zod'
import { resolve, join } from 'node:path'
import { lstatSync } from 'node:fs'

export class SecurityError extends Error {
  constructor(msg: string) {
    super(`security: ${msg}`)
    this.name = 'SecurityError'
  }
}

export function safeAbsPath(p: unknown): string {
  if (typeof p !== 'string' || !p) {
    throw new SecurityError('path must be non-empty string')
  }
  const resolved = resolve(p)
  if (!resolved.startsWith('/')) {
    throw new SecurityError('path must be absolute')
  }
  return resolved
}

export function pathWithinParents(p: string, parents: string[]): void {
  const resolved = resolve(p)
  for (const parent of parents) {
    const pr = resolve(parent)
    if (resolved.startsWith(pr + '/') || resolved === pr) return
  }
  throw new SecurityError(`path not under any of: ${parents.join(', ')}`)
}

export function assertRealDir(p: string): void {
  const stat = lstatSync(p)
  if (stat.isSymbolicLink()) {
    throw new SecurityError('symlinks not allowed')
  }
  if (!stat.isDirectory()) {
    throw new SecurityError('not a directory')
  }
}

const SENSITIVE_ENV_PATTERNS = [
  /^ANTHROPIC_/i,
  /^AWS_/i,
  /^GITHUB_/i,
  /^OPENAI_/i,
  /TOKEN$/i,
  /KEY$/i,
  /SECRET$/i,
  /PASSWORD$/i,
  /PRIVATE/i
]

export function filterSensitiveEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(env)) {
    if (SENSITIVE_ENV_PATTERNS.some((re) => re.test(k))) continue
    out[k] = v
  }
  return out
}

export const CwdSchema = z.string().min(1).max(4096)

export const TranscriptRequestSchema = z.object({
  taskId: z.string().uuid(),
  runId: z.string().uuid()
})
```

### Step 4: 跑测试，确认通过

```bash
npx vitest run src/shared/security.test.ts
```

### Step 5: 提交

```bash
git add src/shared/security.ts src/shared/security.test.ts
git commit -m "fix(review): security — @shared/security 抽象层

新增 src/shared/security.ts 提供：
- safeAbsPath / pathWithinParents / assertRealDir（路径校验）
- filterSensitiveEnv（ANTHROPIC_*, AWS_*, *TOKEN, *KEY, *SECRET 等）
- CwdSchema / TranscriptRequestSchema（zod schemas）
- SecurityError（统一错误类型）

后续 IPC handler 安全化依赖本模块。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

# Phase 2：并行 3 路

## Task 2: #1 #2 — IPC handler 安全化

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/main/tasks/TaskService.ts`（新增 `readTranscriptByRunId`）
- Modify: `src/main/ipc.test.ts`（新建）
- Modify: `src/preload/index.ts`（tasks.transcript 签名变）
- Modify: `src/renderer/src/stores/tasks.ts`
- Modify: `src/renderer/src/components/tasks/TranscriptView.tsx`

### Step 1: 在 TaskService.ts 新增 `readTranscriptByRunId`

读现有 `readTranscript` 实现，在它下面新增：

```ts
/**
 * 修复 #1：基于 runId 而非 renderer-supplied path 读取 transcript。
 * main 端用 runsDir + taskId + runId 重新拼路径，renderer 不能选文件。
 */
readTranscriptByRunId(taskId: string, runId: string): NormalizedEvent[] {
  const path = join(this.deps.runsDir, taskId, `${runId}.jsonl`)
  return this.readTranscript({ transcriptPath: path } as RunRecord)
}
```

记得 import `NormalizedEvent` from `@shared/streamEvents`。

### Step 2: 写 `src/main/ipc.test.ts`

读 ipc.ts 的 `registerIpc` 签名 + 写测试：

```ts
import { describe, it, expect, vi } from 'vitest'
import { registerIpc } from './ipc'
import type { IpcDeps } from './ipc'

function makeDeps(over: Partial<IpcDeps> = {}): IpcDeps {
  const sessions = {
    create: vi.fn((cwd: string) => ({ id: 's1', cwd, title: 't', shellCommand: '/bin/zsh', createdAt: '', alive: true })),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    list: vi.fn(() => []),
    rename: vi.fn(() => true),
    onData: vi.fn(),
    onExit: vi.fn()
  }
  const tasks = {
    tasks: [],
    historyOf: vi.fn(() => []),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(() => true),
    setEnabled: vi.fn(),
    runNow: vi.fn(),
    readTranscript: vi.fn(() => []),
    readTranscriptByRunId: vi.fn(() => [])
  }
  return {
    getWindow: () => null,
    sessions: sessions as any,
    tasks: tasks as any,
    shellFor: () => ({ file: '/bin/zsh', args: [], label: 'zsh' }),
    scanRegistry: () => ({ skills: [], mcp: [], agents: [], scannedAt: 0, cwd: '', home: '' }),
    settings: { get: () => ({} as any), set: (p: any) => p },
    claudeStatus: { found: false, candidates: [] },
    ...over
  } as IpcDeps
}

describe('registerIpc security', () => {
  it('sessions.create 拒绝非字符串 cwd', async () => {
    const handlers: Record<string, Function> = {}
    const ipcMain = (await import('electron')).ipcMain as any
    vi.spyOn(ipcMain, 'handle').mockImplementation((ch: string, fn: Function) => { handlers[ch] = fn })
    
    const deps = makeDeps()
    registerIpc(deps)
    
    const handler = handlers['sessions:create']
    expect(() => handler({}, 123)).toThrow()
  })

  it('tasks.transcript 使用 runId-based lookup', async () => {
    const handlers: Record<string, Function> = {}
    const ipcMain = (await import('electron')).ipcMain as any
    vi.spyOn(ipcMain, 'handle').mockImplementation((ch: string, fn: Function) => { handlers[ch] = fn })
    
    const deps = makeDeps()
    registerIpc(deps)
    
    const handler = handlers['tasks:transcript']
    const req = { taskId: '00000000-0000-0000-0000-000000000001', runId: '00000000-0000-0000-0000-000000000002' }
    handler({}, req)
    expect(deps.tasks.readTranscriptByRunId).toHaveBeenCalledWith(req.taskId, req.runId)
  })
})
```

### Step 3: 跑测试，确认失败

```bash
npx vitest run src/main/ipc.test.ts
```

### Step 4: 改 `src/main/ipc.ts`

```ts
import { CwdSchema, TranscriptRequestSchema, assertRealDir, pathWithinParents } from '@shared/security'
import { homedir } from 'node:os'

// 改 sessions.create
ipcMain.handle(INVOKE_CHANNELS.sessions.create, (_e, rawCwd: unknown, launchClaude?: boolean): SessionSummary => {
  const cwd = CwdSchema.parse(rawCwd)
  assertRealDir(cwd)
  pathWithinParents(cwd, [homedir()])
  const summary = sessions.create(cwd, 80, 24, deps.shellFor(cwd), launchClaude ?? false)
  deps.onSessionCreated?.(cwd, summary.id)
  push(deps.getWindow(), PUSH_CHANNELS.sessionsChanged, undefined)
  return summary
})

// 改 tasks.transcript
ipcMain.handle(INVOKE_CHANNELS.tasks.transcript, (_e, rawReq: unknown) => {
  const req = TranscriptRequestSchema.parse(rawReq)
  return toTranscriptItems(tasks.readTranscriptByRunId(req.taskId, req.runId))
})
```

### Step 5: 改 `src/preload/index.ts`

找到：
```ts
transcript: (rec: RunRecord): Promise<TranscriptItem[]> =>
  ipcRenderer.invoke('tasks:transcript', rec),
```

注意 `RunRecord` 不再 import。改为：
```ts
transcript: (req: { taskId: string; runId: string }): Promise<TranscriptItem[]> =>
  ipcRenderer.invoke(INVOKE_CHANNELS.tasks.transcript, req),
```

同时检查是否还 import `RunRecord`：如果不再用，删除 import。

### Step 6: 改 `src/renderer/src/stores/tasks.ts`

> **关键决策**：transcript 的 store API 签名统一改为 `(rec: RunRecord)` 不变；renderer 内部从 `rec.taskId` / `rec.transcriptPath` 提取 runId 并改为 `transcriptPath.split('/').pop().replace('.jsonl', '')`，再调用新 IPC。
>
> 实际：根据现状 grep 决定 caller 形态。如果 caller 多且分散，**保留 store API 形态**，只在 store 内部改 IPC 调用方式：
>
> ```ts
> // store.transcript 形态可保持不变，但内部实现改为：
> transcript: async (rec) => {
>   const runId = rec.transcriptPath?.match(/([0-9a-f-]+)\.jsonl$/)?.[1]
>   if (!runId) throw new Error('invalid transcript path')
>   return window.api.tasks.transcript({ taskId: rec.taskId, runId })
> }
> ```
>
> 如果 grep 显示 caller 已经直接传 runId，直接改 IPC 调用即可。

### Step 7: 改 `src/renderer/src/components/tasks/TranscriptView.tsx`

按 Step 6 的 caller 形态决定。如果 Step 6 保持 store API 不变，TranscriptView 不动；否则更新 caller。

### Step 8: 跑全量测试

```bash
npx vitest run
npm run typecheck
```

期望：143+ + 至少 +2 = 145+ PASS；typecheck clean。

### Step 9: 提交

```bash
git add src/main/ipc.ts src/main/ipc.test.ts src/main/tasks/TaskService.ts \
        src/preload/index.ts src/renderer/src/stores/tasks.ts \
        src/renderer/src/components/tasks/TranscriptView.tsx
git commit -m "fix(review): #1 #2 — IPC handler 安全化（cwd + transcript runId）

#1 tasks.transcript：Renderer-supplied transcriptPath → 任意文件读
修复：handler 接受 { taskId, runId }，main 端用 runsDir + id 拼路径，
不再信 renderer-supplied path。

#2 sessions.create：Renderer-supplied cwd + login shell → rc 文件 RCE
修复：handler 用 CwdSchema.parse + assertRealDir (lstat not symlink)
+ pathWithinParents (cwd 必须在 home 下) 三重校验。

Preload + renderer 调用方同步更新签名。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 3: #3 — env filter 集成

**Files:**
- Modify: `src/main/env.ts`
- Modify: `src/main/env.test.ts`

### Step 1: 写 `env.test.ts` 新增 case

读现有 `env.test.ts`，在末尾追加：

```ts
describe('filterSensitiveEnv integration', () => {
  it('probeUserEnv 输出应被 filterSensitiveEnv 过滤', () => {
    // mock child_process spawn 输出
    // ...
  })
  it('mergedEnv 集成 filterSensitiveEnv', () => {
    // ...
  })
})
```

> 如果直接 mock spawn 太复杂，退化为只测 `mergedEnv` 接受 `probed` 经 `filterSensitiveEnv` 后再合并。

### Step 2: 跑测试，确认失败

```bash
npx vitest run src/main/env.test.ts
```

### Step 3: 改 `src/main/env.ts`

```ts
import { filterSensitiveEnv } from '@shared/security'

// 在 probeUserEnv 末尾 return 前：
export function probeUserEnv(...): NodeJS.ProcessEnv | null {
  // ... 现有逻辑直到 parseEnvOutput(stdout)
  return filterSensitiveEnv(parseEnvOutput(stdout))
}

// 改 mergedEnv：
export function mergedEnv(base: NodeJS.ProcessEnv, probed: NodeJS.ProcessEnv | null): NodeJS.ProcessEnv {
  if (!probed) return base
  return { ...base, ...filterSensitiveEnv(probed) }
}
```

### Step 4: 跑测试

```bash
npx vitest run src/main/env.test.ts
npx vitest run
npm run typecheck
```

### Step 5: 提交

```bash
git add src/main/env.ts src/main/env.test.ts
git commit -m "fix(review): #3 — probeUserEnv / mergedEnv 用 filterSensitiveEnv 过滤

#3 probeUserEnv 把 login shell secrets（ANTHROPIC_API_KEY 等）注入
process.env，导致 pty sessions + TaskRunner.claude -p 继承 secret。
修复：probeUserEnv 返回前过滤；mergedEnv 合并 probed 前过滤。

filterSensitiveEnv 在 @shared/security.ts 黑名单：
ANTHROPIC_*, AWS_*, GITHUB_*, OPENAI_*, *TOKEN, *KEY, *SECRET,
*PASSWORD, *PRIVATE

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 4: #11 — RegistryScanner symlink guard

**Files:**
- Modify: `src/main/registry/RegistryScanner.ts`

### Step 1: 写测试

先看 `RegistryScanner.test.ts`（如有）。如果没有，写集成测试：

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNodeScannerFs } from './RegistryScanner'

describe('RegistryScanner symlink guard', () => {
  it('symlink 目录不跟进', () => {
    const root = mkdtempSync(join(tmpdir(), 'reg-'))
    const real = join(root, 'real')
    const link = join(root, 'link')
    mkdirSync(real)
    writeFileSync(join(real, 'SKILL.md'), '---\nname: real\ndescription: real\n---\n')
    symlinkSync(real, link)
    
    const fs = createNodeScannerFs()
    const skills = fs.scan(link)
    
    // 应不包含 symlinked skill
    expect(skills.find(s => s.name === 'real')).toBeUndefined()
  })
  
  it('symlink 文件不读取', () => {
    // 类似，文件级 symlink
  })
})
```

### Step 2: 跑测试，确认失败

### Step 3: 改 `RegistryScanner.ts`

读现有实现，找到 walk 函数。在每个文件/目录 stat 处改用 `lstat`：

```ts
import { lstatSync } from 'node:fs'

function walkDir(dir: string, collector: ...): void {
  // 改 readdirSync + statSync 为：
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = lstatSync(full)  // 改：lstat 而非 stat
    if (st.isSymbolicLink()) continue  // 跳过 symlink
    if (st.isDirectory()) walkDir(full, collector)
    else if (entry.endsWith('.md')) parseSkill(full)
  }
}
```

同样改 plugin/agents 扫描：

```ts
// collectPluginSkillsDirs 起始用 lstat
function collectPluginSkillsDirs(root: string): string[] {
  // 整个目录如果 isSymbolicLink 返回 []
  const st = lstatSync(root)
  if (st.isSymbolicLink()) return []
  // ... existing
}
```

### Step 4: 跑测试

```bash
npx vitest run src/main/registry/
npx vitest run
npm run typecheck
```

### Step 5: 提交

```bash
git add src/main/registry/
git commit -m "fix(review): #11 — RegistryScanner 加 symlink guard

#11 ~/.claude/plugins/cache 下的 symlink 可被恶意插件用来 inject
shell command via Extensions 一键插入功能。
修复：所有 readdirSync 后用 lstatSync（不 follow symlink），遇到
symlink 跳过；插件/agents 目录入口也加 lstat 守卫。

允许 ~/.claude 默认根；symlink 在该根下不跟进。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## 收尾

- [ ] **Task 5: 跑全量测试 + typecheck**

```bash
npm test
npm run typecheck
```

期望：143 + 至少 12 = 155+ PASS；typecheck clean。

- [ ] **Task 6: 写结果报告**

新建 `docs/superpowers/plans/2026-09-23-security-hardening-result.md`：
- 4 finding commit hash 列表
- 实际测试数
- 任何 spec 偏离与原因

- [ ] **Task 7: merge to main + 打 tag 0.1.3**

```bash
git checkout main
git merge --no-ff security-hardening
git tag -a 0.1.3 -m "v0.1.3 — Security Hardening (4 critical findings)"
git branch -d security-hardening
git worktree remove /Users/cramer/Documents/tools/agent-desktop/.worktrees/security-hardening
```

---

## DoD 完成定义

- [ ] 4 finding 每个都有 commit，消息以 `fix(review):` 开头
- [ ] `npm test` 全 PASS（baseline 143 + 至少 12 新）
- [ ] `npm run typecheck` 无错误
- [ ] 既有测试未删除/未弱化
- [ ] `@shared/security.ts` 新增
- [ ] IPC handler 入口统一校验
- [ ] `tasks.transcript` 改 runId-based lookup
- [ ] preload + renderer 调用方更新
- [ ] env probe 用 filterSensitiveEnv
- [ ] RegistryScanner 加 lstat guard
- [ ] 结果报告落档
- [ ] tag 0.1.3