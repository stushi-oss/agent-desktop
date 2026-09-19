# Agent Desktop 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Claude Code CLI 封装为 Electron 桌面应用：内嵌终端跑真实 claude CLI（能力零损失）、headless 定时任务（cron/间隔/一次性，历史+通知+回放）、Skill/MCP/Agent 只读可视化；专业双主题 Dashboard 抽屉布局；macOS + Windows。

**Architecture:** Electron 主进程承载 SessionManager（node-pty 多会话）、TaskService（调度+headless 执行+持久化）、RegistryScanner（只读扫描）；渲染进程 React + zustand + xterm.js，通过 contextBridge IPC 通信。设计文档：`docs/superpowers/specs/2026-09-18-agent-desktop-design.md`。

**Tech Stack:** Electron 44 · electron-vite 5 · Vite 7 · React 19 · TypeScript 5.9 · xterm.js 6（@xterm/xterm）· node-pty 1.1（N-API，无需 rebuild）· cron-parser 5 · zustand 5 · i18next 26 · vitest 5 · electron-builder 26。

---

## 全局约定（每个任务都要遵守）

1. **工作目录**：所有命令都在仓库根 `/Users/cramer/Documents/tools/agent-desktop` 执行。
2. **TDD**：有可测逻辑的任务先写测试（vitest），看到失败再实现，看到通过再提交。UI 装配任务用 `npm run dev` 手动冒烟清单验证。
3. **提交**：每个任务结束提交一次，消息格式 `feat|fix|test|chore(scope): 描述`，结尾加：
   `Co-Authored-By: Claude Code <noreply@anthropic.com>`
4. **UI 风格**：所有 UI 代码使用 Task 2 建立的设计令牌（CSS variables），不得硬编码颜色/间距。执行 UI 任务（Task 6、7、13、14、15、17、18）前先调用 `frontend-design` skill 获取现代化风格指导，但**令牌与类名必须与本计划一致**。
5. **i18n**：渲染进程所有用户可见文案必须走 `t()`，key 只允许使用 Task 2 中 `zh-CN.ts`/`en.ts` 定义的集合，两份语言文件同步修改。
6. **类型共享**：主进程与渲染进程共享类型一律放 `src/shared/`，通过 `@shared` 别名导入。
7. **平台差异**：平台相关逻辑必须通过参数注入（platform/env 回调）使其可单测，禁止在纯函数里直接读 `process.platform`（main 装配层除外）。
8. **UI 任务的验证**：`npm run dev` 打开应用，按任务内的冒烟清单逐项点验；无法自动化的写「人工确认」。

## 文件结构总览

```
agent-desktop/
├── package.json / electron.vite.config.ts / vitest.config.ts
├── tsconfig.json / tsconfig.node.json / tsconfig.web.json
├── electron-builder.yml
├── src/
│   ├── shared/
│   │   └── types.ts                 # 全部跨进程类型（单一事实来源）
│   ├── main/
│   │   ├── index.ts                 # 应用入口：装配所有服务、创建窗口
│   │   ├── env.ts                   # GUI 环境 PATH 探测 + claude 解析（macOS 登录 shell）
│   │   ├── shellSelect.ts           # 平台 shell 选择（win: pwsh→powershell→cmd）
│   │   ├── ipc.ts                   # 全部 ipcMain.handle 注册（薄封装）
│   │   ├── notifyText.ts            # 通知文案（纯函数，无 electron 依赖）
│   │   ├── notifications.ts         # 系统通知 + dock 角标
│   │   ├── session/SessionManager.ts# pty 会话生命周期（工厂注入可测）
│   │   ├── tasks/
│   │   │   ├── schedule.ts          # 纯函数：nextRunAt 计算（cron-parser）
│   │   │   ├── streamJson.ts        # 纯函数：stream-json 行解析/结果提取
│   │   │   ├── TaskRunner.ts        # spawn claude -p，落盘 transcript，超时
│   │   │   └── TaskService.ts       # CRUD + tick 调度 + missed + 通知钩子
│   │   ├── store/
│   │   │   ├── fileStore.ts         # 原子写 / 读+损坏恢复
│   │   │   ├── TaskStore.ts         # tasks.json / history.json（cap 200）
│   │   │   └── settings.ts          # settings.json + nativeTheme 应用
│   │   └── registry/
│   │       ├── frontmatter.ts       # 极简 YAML frontmatter 解析
│   │       └── RegistryScanner.ts   # skills/MCP/agents 扫描（fs 注入可测）
│   ├── preload/index.ts             # contextBridge → window.api
│   └── renderer/
│       ├── index.html
│       └── src/
│           ├── main.tsx / App.tsx
│           ├── i18n/{index.ts,zh-CN.ts,en.ts}
│           ├── theme/theme.ts       # data-theme 切换（matchMedia + IPC）
│           ├── stores/{sessions.ts,tasks.ts,registry.ts,settings.ts}
│           ├── lib/{taskForm.ts,format.ts}
│           ├── components/
│           │   ├── TitleBar.tsx          # tab 栏 + 抽屉入口 + 主题切换 + 角标
│           │   ├── SessionSidebar.tsx    # 会话列表 + 新会话 + 下次任务卡
│           │   ├── NextTaskCard.tsx
│           │   ├── NewSessionModal.tsx
│           │   ├── SettingsModal.tsx
│           │   ├── TerminalPane.tsx      # xterm.js 终端（深底常驻）
│           │   ├── tasks/
│           │   │   ├── TaskDrawer.tsx    # 列表 ↔ 详情 ↔ 表单路由
│           │   │   ├── TaskForm.tsx
│           │   │   ├── RunHistory.tsx    # 历史时间线
│           │   │   └── TranscriptView.tsx# jsonl → 对话流回放
│           │   ├── extensions/ExtensionsDrawer.tsx
│           │   └── ui/{Modal.tsx,Toggle.tsx,StatusDot.tsx}
│           └── styles/global.css    # 设计令牌 + 基础样式
├── tests/
│   ├── integration/taskRunner.test.ts     # 假 CLI 集成测试
│   └── fixtures/fake-claude.sh            # 输出预置 stream-json 的假 CLI
└── docs/superpowers/{specs,plans}/…
```

**单元测试与源码同目录**（`src/**/*.test.ts`），集成测试在 `tests/`。

---

## Phase 1 · 基础框架

### Task 1: 项目脚手架（可运行的空窗口）

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `.gitignore`（已有则不动）
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/styles/global.css`

- [ ] **Step 1.1: 写 package.json**

```json
{
  "name": "agent-desktop",
  "version": "0.1.0",
  "description": "Claude Code desktop wrapper with scheduled tasks",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.web.json --noEmit",
    "postinstall": "electron-builder install-app-deps",
    "dist:mac": "electron-vite build && electron-builder --mac",
    "dist:win": "electron-vite build && electron-builder --win"
  },
  "dependencies": {
    "@xterm/addon-fit": "^0.11.0",
    "@xterm/xterm": "^6.0.0",
    "cron-parser": "^5.10.1",
    "i18next": "^26.4.2",
    "node-pty": "^1.1.0",
    "react": "^19.3.0",
    "react-dom": "^19.3.0",
    "react-i18next": "^17.0.14",
    "zustand": "^5.0.15"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^5.0.0",
    "electron": "^44.4.2",
    "electron-builder": "^26.15.3",
    "electron-vite": "^5.0.0",
    "typescript": "^5.9.3",
    "vite": "^7.0.0",
    "vitest": "^5.0.1"
  }
}
```

注意：**不要**加 `"type": "module"`（保持 CJS 包类型，electron-vite 输出 CJS 到 out/，配置文件可用 `__dirname`）。

- [ ] **Step 1.2: 写构建配置**

`electron.vite.config.ts`：

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const sharedAlias = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias }
  },
  renderer: {
    plugins: [react()],
    resolve: { alias: { ...sharedAlias, '@': resolve(__dirname, 'src/renderer/src') } }
  }
})
```

`vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared'), '@': resolve(__dirname, 'src/renderer/src') } },
  test: { include: ['src/**/*.test.ts', 'tests/**/*.test.ts'], testTimeout: 20000 }
})
```

- [ ] **Step 1.3: 写三个 tsconfig**

`tsconfig.json`（根，仅作 IDE 汇总）：

```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }]
}
```

`tsconfig.node.json`（main + preload + shared + 配置文件）：

```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "outDir": "out/tsconfig.node.tsbuildinfo",
    "paths": { "@shared/*": ["./src/shared/*"] }
  },
  "include": ["src/main/**/*", "src/preload/**/*", "src/shared/**/*", "electron.vite.config.ts", "vitest.config.ts"]
}
```

`tsconfig.web.json`（renderer + shared）：

```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "outDir": "out/tsconfig.web.tsbuildinfo",
    "paths": { "@shared/*": ["./src/shared/*"], "@/*": ["./src/renderer/src/*"] }
  },
  "include": ["src/renderer/src/**/*", "src/shared/**/*"]
}
```

- [ ] **Step 1.4: 写主进程 / preload / 渲染进程最小实现**

`src/main/index.ts`：

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#161b22',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

`src/preload/index.ts`：

```ts
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('api', {})
```

`src/renderer/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <!-- 不加 CSP meta：dev 模式 vite/react-refresh 需要注入 inline script；
         应用 contextIsolation 开启、nodeIntegration 关闭、仅加载本地/dev-server 资源 -->
    <title>AgentDesk</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/main.tsx`：

```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/global.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

`src/renderer/src/App.tsx`（占位，后续任务替换）：

```tsx
export default function App() {
  return <div style={{ padding: 24 }}>AgentDesk scaffold OK</div>
}
```

`src/renderer/src/styles/global.css`（占位，Task 2 替换为完整令牌）：

```css
html, body, #root { height: 100%; margin: 0; }
body { background: #161b22; color: #adbac7; font-family: -apple-system, 'Segoe UI', sans-serif; }
```

- [ ] **Step 1.5: 安装依赖并启动验证**

Run: `npm install`
Expected: 安装完成无 error（node-pty 走 prebuild；若失败，确认 Xcode CLT：`xcode-select -p`）。

Run: `npm run dev`（约 10 秒后 Electron 窗口出现，页面显示 "AgentDesk scaffold OK"）。人工确认后 Ctrl+C 退出。

Run: `npm run typecheck`
Expected: 0 errors。

- [ ] **Step 1.6: Commit**

```bash
git add -A
git commit -m "chore(scaffold): electron-vite + react + ts 脚手架，可运行空窗口"
```

---

### Task 2: 设计令牌（专业双主题）+ i18n 基础

**Files:**
- Create: `src/renderer/src/styles/global.css`（覆盖占位）、`src/renderer/src/i18n/index.ts`、`src/renderer/src/i18n/zh-CN.ts`、`src/renderer/src/i18n/en.ts`、`src/renderer/src/theme/theme.ts`、`src/shared/types.ts`
- Modify: `src/renderer/src/App.tsx`（挂 i18n + 主题）
- Test: `src/renderer/src/i18n/i18n.test.ts`

- [ ] **Step 2.1: 写共享类型（后续所有任务的类型单一来源）**

`src/shared/types.ts`：

```ts
// ---------- 定时任务 ----------
export type Schedule =
  | { type: 'cron'; expr: string } // 5 段，本地时区
  | { type: 'interval'; minutes: number }
  | { type: 'once'; at: string } // ISO 时间

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions'

export interface ScheduledTask {
  id: string
  name: string
  prompt: string
  cwd: string
  schedule: Schedule
  enabled: boolean
  permissionMode: PermissionMode
  model?: string
  timeoutMinutes: number
  notify: { onComplete: boolean; onFailure: boolean }
  createdAt: string
  nextRunAt?: string
}

export interface TaskInput {
  name: string
  prompt: string
  cwd: string
  schedule: Schedule
  permissionMode: PermissionMode
  model?: string
  timeoutMinutes?: number
  notify?: { onComplete?: boolean; onFailure?: boolean }
}

export type RunStatus = 'running' | 'success' | 'failed' | 'missed'

export interface RunRecord {
  id: string
  taskId: string
  startedAt: string
  finishedAt?: string
  status: RunStatus
  exitCode?: number
  transcriptPath?: string
  resultText?: string
  error?: string
}

// ---------- 扩展可视化 ----------
export type SkillSource = 'user' | 'plugin' | 'project'
export interface SkillInfo { name: string; description: string; source: SkillSource }
export interface McpServerInfo {
  name: string
  transport: 'stdio' | 'sse' | 'http'
  command?: string
  url?: string
  scope: 'user' | 'project'
}
export interface AgentInfo { name: string; description: string; tools?: string; source: 'user' | 'project' }
export interface RegistrySnapshot {
  scannedAt: string
  skills: SkillInfo[]
  mcpServers: McpServerInfo[]
  agents: AgentInfo[]
}

// ---------- 会话 ----------
export interface SessionSummary {
  id: string
  title: string
  cwd: string
  shellCommand: string
  createdAt: string
  alive: boolean
}

// ---------- 设置 ----------
export interface AppSettings {
  theme: 'system' | 'light' | 'dark'
  locale: 'system' | 'zh-CN' | 'en'
  closeToTray: boolean
}

// ---------- stream-json ----------
export interface StreamEvent {
  type: string
  [key: string]: unknown
}

/** 回放条目（主进程 streamJson 产出，TranscriptView 消费） */
export type TranscriptItem =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; input?: string }
  | { kind: 'result'; text: string; isError: boolean }
```

- [ ] **Step 2.2: 写设计令牌 global.css（完整替换）**

`src/renderer/src/styles/global.css`：

```css
html, body, #root { height: 100%; margin: 0; }

/* ===== 设计令牌：专业双主题（GitHub Light / Dark Dimmed 质感） ===== */
:root, :root[data-theme='dark'] {
  --bg: #161b22;            /* 应用背景 / 面板 */
  --bg-sidebar: #12161d;    /* 侧栏 */
  --bg-raised: #1c2129;     /* 弹层/抽屉 */
  --terminal-bg: #0d1117;   /* 终端底色（常驻深色，不随主题反转） */
  --border: #30363d;
  --border-strong: #444c56;
  --text: #adbac7;
  --text-strong: #e6edf3;
  --text-dim: #768390;
  --accent: #f78166;
  --accent-contrast: #1b1f24;
  --accent-soft: rgba(247, 129, 102, 0.15);
  --success: #57ab5a;
  --danger: #f85149;
  --warn: #e3b341;
  --shadow: 0 8px 24px rgba(1, 4, 9, 0.6);
}
:root[data-theme='light'] {
  --bg: #ffffff;
  --bg-sidebar: #f8f9fb;
  --bg-raised: #ffffff;
  --terminal-bg: #0d1117;
  --border: #d8dce4;
  --border-strong: #b8bfcc;
  --text: #4b5563;
  --text-strong: #1f2328;
  --text-dim: #6e7781;
  --accent: #316dca;
  --accent-contrast: #ffffff;
  --accent-soft: rgba(49, 109, 202, 0.12);
  --success: #1a7f37;
  --danger: #cf222e;
  --warn: #9a6700;
  --shadow: 0 8px 24px rgba(140, 149, 159, 0.2);
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 13px;
  overflow: hidden;
  user-select: none;
}
* { box-sizing: border-box; }
button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; }
input, textarea, select { font: inherit; }

/* ===== 通用控件 ===== */
.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px; border-radius: 6px;
  border: 1px solid var(--border-strong);
  background: var(--bg); color: var(--text);
}
.btn:hover { border-color: var(--accent); color: var(--text-strong); }
.btn-primary { background: var(--accent); color: var(--accent-contrast); border-color: var(--accent); }
.btn-primary:hover { opacity: 0.9; }
.btn-danger:hover { border-color: var(--danger); color: var(--danger); }
.btn-ghost { border-color: transparent; color: var(--text-dim); }
.btn-ghost:hover { color: var(--text-strong); background: var(--accent-soft); }

.field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.field label { font-size: 12px; color: var(--text-dim); }
.field input, .field textarea, .field select {
  background: var(--bg-sidebar); color: var(--text-strong);
  border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px;
}
.field input:focus, .field textarea:focus, .field select:focus {
  outline: none; border-color: var(--accent);
}
.field .error { color: var(--danger); font-size: 12px; }

.badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px;
  background: var(--accent); color: var(--accent-contrast); font-size: 10px; font-weight: 600;
}

.scroll-y { overflow-y: auto; }
.scroll-y::-webkit-scrollbar { width: 8px; }
.scroll-y::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 4px; }
```

- [ ] **Step 2.3: 写 i18n 资源（完整最终 key 集——后续任务只准用这里定义的 key）**

`src/renderer/src/i18n/zh-CN.ts`：

```ts
export const zhCN = {
  common: {
    close: '关闭', cancel: '取消', save: '保存', delete: '删除', edit: '编辑',
    back: '返回', confirm: '确认', details: '详情', minutes: '分钟'
  },
  sessions: {
    title: '终端会话', new: '新会话', empty: '暂无会话，点击「新会话」开始',
    exited: '已退出', restart: '重启会话', closeSession: '关闭会话',
    rename: '重命名', copyPath: '复制路径',
    claudeMissingBanner: '未找到 claude 可执行文件，会话将以纯 shell 启动（详情见设置）'
  },
  tabs: { newTab: '新标签页' },
  tasks: {
    title: '定时任务', new: '新建任务', empty: '还没有定时任务', list: '任务列表',
    name: '名称', prompt: '任务指令', cwd: '工作目录', pickDir: '选择目录',
    scheduleType: '调度方式', cron: 'Cron 表达式', interval: '间隔（分钟）', once: '执行时间',
    permissionMode: '权限模式', pmDefault: '默认（每次询问）', pmAcceptEdits: '接受文件编辑',
    pmBypass: '跳过所有权限', pmRisk: '跳过权限意味着 Claude 可不经确认执行命令/写文件，仅用于完全可信的任务。',
    model: '模型（可选，留空用默认）', timeout: '超时（分钟）',
    notifyComplete: '完成时通知', notifyFailure: '失败时通知', enabled: '启用',
    nextRun: '下次运行', lastStatus: '最近状态', runNow: '立即运行', history: '运行历史',
    viewTranscript: '查看运行过程',
    statusRunning: '运行中', statusSuccess: '成功', statusFailed: '失败', statusMissed: '已错过',
    vNameRequired: '请填写名称', vPromptRequired: '请填写任务指令', vCwdRequired: '请选择工作目录',
    vCronInvalid: 'Cron 表达式无效（应为 5 段）', vIntervalPositive: '间隔必须大于 0',
    vOnceFuture: '执行时间必须在未来',
    summaryNext: '下一个任务', summaryNone: '无待触发任务', summaryMore: '另有 {{count}} 个任务',
    runningCount: '{{count}} 个任务运行中'
  },
  registry: {
    title: '扩展', tabSkills: 'Skills', tabMcp: 'MCP', tabAgents: 'Agents',
    search: '搜索…', empty: '未发现任何条目',
    hint: '只读展示本机 Claude 配置，点击条目可插入当前终端',
    sourceUser: '用户', sourcePlugin: '插件', sourceProject: '项目',
    transport: '传输', insert: '插入终端'
  },
  settings: {
    title: '设置', theme: '主题', themeSystem: '跟随系统', themeLight: '浅色', themeDark: '深色',
    language: '语言', langSystem: '跟随系统', langZh: '中文', langEn: 'English',
    closeToTray: '关闭窗口时最小化到托盘（保证定时任务后台运行）',
    claudeTitle: 'claude 可执行文件', claudeNotFound: '未找到，已尝试：'
  },
  notify: { done: '「{{name}}」已完成', failed: '「{{name}}」运行失败', clickDetail: '点击查看详情' },
  transcript: {
    title: '运行过程', prompt: '任务指令', tool: '工具调用', result: '最终结果',
    empty: '该次运行没有输出', exitCode: '退出码 {{code}}'
  }
} as const

// Widen：as const 会把值收窄为中文字面量类型，直接 typeof 会让 en.ts 报 ~90 个
// TS2322；Widen 保持 key/结构完全校验、仅把值放宽为 string。
type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> }
export type TranslationShape = Widen<typeof zhCN>
```

`src/renderer/src/i18n/en.ts`（与 zh-CN 结构完全一致）：

```ts
import type { TranslationShape } from './zh-CN'

export const en: TranslationShape = {
  common: {
    close: 'Close', cancel: 'Cancel', save: 'Save', delete: 'Delete', edit: 'Edit',
    back: 'Back', confirm: 'Confirm', details: 'Details', minutes: 'min'
  },
  sessions: {
    title: 'Terminal Sessions', new: 'New Session', empty: 'No sessions yet — click "New Session"',
    exited: 'Exited', restart: 'Restart Session', closeSession: 'Close Session',
    rename: 'Rename', copyPath: 'Copy Path',
    claudeMissingBanner: 'claude executable not found; sessions will start as plain shell (see Settings)'
  },
  tabs: { newTab: 'New Tab' },
  tasks: {
    title: 'Scheduled Tasks', new: 'New Task', empty: 'No scheduled tasks yet', list: 'Tasks',
    name: 'Name', prompt: 'Prompt', cwd: 'Working Directory', pickDir: 'Choose…',
    scheduleType: 'Schedule', cron: 'Cron Expression', interval: 'Interval (minutes)', once: 'Run At',
    permissionMode: 'Permission Mode', pmDefault: 'Default (ask)', pmAcceptEdits: 'Accept Edits',
    pmBypass: 'Bypass all permissions', pmRisk: 'Bypassing permissions lets Claude run commands and write files without confirmation. Only for fully trusted tasks.',
    model: 'Model (optional, blank = default)', timeout: 'Timeout (minutes)',
    notifyComplete: 'Notify on complete', notifyFailure: 'Notify on failure', enabled: 'Enabled',
    nextRun: 'Next Run', lastStatus: 'Last Status', runNow: 'Run Now', history: 'Run History',
    viewTranscript: 'View Transcript',
    statusRunning: 'Running', statusSuccess: 'Success', statusFailed: 'Failed', statusMissed: 'Missed',
    vNameRequired: 'Name is required', vPromptRequired: 'Prompt is required', vCwdRequired: 'Choose a working directory',
    vCronInvalid: 'Invalid cron expression (5 fields)', vIntervalPositive: 'Interval must be > 0',
    vOnceFuture: 'Time must be in the future',
    summaryNext: 'Next Task', summaryNone: 'No upcoming task', summaryMore: '{{count}} more tasks',
    runningCount: '{{count}} running'
  },
  registry: {
    title: 'Extensions', tabSkills: 'Skills', tabMcp: 'MCP', tabAgents: 'Agents',
    search: 'Search…', empty: 'Nothing found',
    hint: 'Read-only view of local Claude config. Click an item to insert into the active terminal.',
    sourceUser: 'User', sourcePlugin: 'Plugin', sourceProject: 'Project',
    transport: 'Transport', insert: 'Insert'
  },
  settings: {
    title: 'Settings', theme: 'Theme', themeSystem: 'System', themeLight: 'Light', themeDark: 'Dark',
    language: 'Language', langSystem: 'System', langZh: '中文', langEn: 'English',
    closeToTray: 'Minimize to tray on close (keeps scheduled tasks running)',
    claudeTitle: 'claude executable', claudeNotFound: 'Not found. Tried:'
  },
  notify: { done: '"{{name}}" finished', failed: '"{{name}}" failed', clickDetail: 'Click to view details' },
  transcript: {
    title: 'Transcript', prompt: 'Prompt', tool: 'Tool Call', result: 'Result',
    empty: 'No output for this run', exitCode: 'Exit code {{code}}'
  }
}
```

`src/renderer/src/i18n/index.ts`：

```ts
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { zhCN } from './zh-CN'
import { en } from './en'

export function detectLocale(): 'zh-CN' | 'en' {
  const nav = (navigator.language || 'en').toLowerCase()
  return nav.startsWith('zh') ? 'zh-CN' : 'en'
}

void i18next.use(initReactI18next).init({
  resources: { 'zh-CN': { translation: zhCN }, en: { translation: en } },
  lng: detectLocale(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

export default i18next
```

- [ ] **Step 2.4: 写主题切换模块**

`src/renderer/src/theme/theme.ts`：

```ts
// 跟随系统主题：Electron 中 nativeTheme.themeSource='system' 时
// matchMedia('(prefers-color-scheme: dark)') 可用且随系统切换。
// 设置页的显式切换（Task 18）通过设置 theme 后仍收敛到这里的 applyTheme。

export type ThemeMode = 'system' | 'light' | 'dark'

export function effectiveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = effectiveTheme(mode)
}

export function watchSystemTheme(cb: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = () => cb()
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}
```

- [ ] **Step 2.5: 写失败测试（i18n 两份资源 key 结构一致）**

`src/renderer/src/i18n/i18n.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { zhCN } from './zh-CN'
import { en } from './en'

function keysOf(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keysOf(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]
  )
}

describe('i18n resources', () => {
  it('zh-CN 与 en 的 key 集合完全一致', () => {
    expect(new Set(keysOf(en))).toEqual(new Set(keysOf(zhCN)))
  })
  it('zh-CN 无空字符串值', () => {
    for (const k of keysOf(zhCN)) {
      const val = k.split('.').reduce<unknown>((o, seg) => (o as Record<string, unknown>)![seg], zhCN)
      expect(String(val ?? '').length, `key ${k}`).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2.6: 运行测试确认失败→通过**

Run: `npx vitest run src/renderer/src/i18n/i18n.test.ts`
Expected: 首次运行 2 passed（资源已写好；此测试是防回归护栏——若失败说明两份资源不同步，修到通过）。

- [ ] **Step 2.7: App.tsx 挂载 i18n + 主题**

`src/renderer/src/App.tsx`（覆盖）：

```tsx
import { useEffect } from 'react'
import './i18n'
import { applyTheme, watchSystemTheme } from './theme/theme'

export default function App() {
  useEffect(() => {
    applyTheme('system')
    return watchSystemTheme(() => applyTheme('system'))
  }, [])
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ color: 'var(--text-strong)', fontSize: 16 }}>AgentDesk</h1>
      <p style={{ color: 'var(--text-dim)' }}>tokens + i18n ready</p>
    </div>
  )
}
```

Run: `npm run dev`
人工确认：切换系统深浅外观（系统设置 → 外观），窗口底色/文字色随之变化。

- [ ] **Step 2.8: Commit**

```bash
git add -A
git commit -m "feat(ui): 专业双主题设计令牌 + i18next 中英资源（完整 key 集）"
```

---

## Phase 2 · 终端核心（能力零损失）

### Task 3: 环境探测与 claude 解析（TDD）

**Files:**
- Create: `src/main/env.ts`
- Test: `src/main/env.test.ts`

- [ ] **Step 3.1: 写失败测试**

`src/main/env.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { buildProbeCommand, parseEnvOutput, resolveClaudePath } from './env'

describe('buildProbeCommand', () => {
  it('darwin 返回登录 shell -l -i -c env', () => {
    expect(buildProbeCommand('darwin', '/bin/zsh')).toEqual({ file: '/bin/zsh', args: ['-l', '-i', '-c', 'env'] })
  })
  it('非 darwin 返回 null（GUI 进程已继承 PATH）', () => {
    expect(buildProbeCommand('win32', 'C:\\pwsh.exe')).toBeNull()
  })
})

describe('parseEnvOutput', () => {
  it('解析 KEY=VALUE 行，值中可含 =', () => {
    const env = parseEnvOutput('PATH=/a:/b\nFOO=bar=baz\n\nINVALID\n')
    expect(env.PATH).toBe('/a:/b')
    expect(env.FOO).toBe('bar=baz')
    expect(Object.keys(env).sort()).toEqual(['FOO', 'PATH'])
  })
})

describe('resolveClaudePath', () => {
  const sep = { darwin: ':', win32: ';' } as const
  it('macOS：优先 home/.local/bin，其次 PATH 扫描', () => {
    const existing = new Set(['/Users/u/.local/bin/claude'])
    const found = resolveClaudePath(
      { HOME: '/Users/u', PATH: `/Users/u/.local/bin${sep.darwin}/usr/bin` },
      'darwin',
      (p) => existing.has(p)
    )
    expect(found).toBe('/Users/u/.local/bin/claude')
  })
  it('macOS：home 没有则在 PATH 里找', () => {
    const existing = new Set(['/opt/homebrew/bin/claude'])
    const found = resolveClaudePath(
      { HOME: '/Users/u', PATH: `/Users/u/.local/bin${sep.darwin}/opt/homebrew/bin` },
      'darwin',
      (p) => existing.has(p)
    )
    expect(found).toBe('/opt/homebrew/bin/claude')
  })
  it('win32：找 claude.exe（含 USERPROFILE 兜底）', () => {
    const existing = new Set([`C:\\Users\\u\\.local\\bin\\claude.exe`])
    const found = resolveClaudePath(
      { USERPROFILE: 'C:\\Users\\u', PATH: `C:\\Windows${sep.win32}C:\\Users\\u\\.local\\bin` },
      'win32',
      (p) => existing.has(p)
    )
    expect(found).toBe('C:\\Users\\u\\.local\\bin\\claude.exe')
  })
  it('找不到返回 null', () => {
    expect(resolveClaudePath({ HOME: '/Users/u', PATH: '/usr/bin' }, 'darwin', () => false)).toBeNull()
  })
})
```

Run: `npx vitest run src/main/env.test.ts`
Expected: FAIL — `Cannot find module './env'`。

- [ ] **Step 3.2: 实现 env.ts**

`src/main/env.ts`（注意：路径拼接用 `pathFor(platform)` 从 `node:path` 选 win32/posix——
宿主 join 在 macOS 上会把 win32 用例拼出混合分隔符导致测试必挂）：

```ts
import { execFile } from 'node:child_process'
import { existsSync, posix, win32 } from 'node:path'

const pathFor = (platform: NodeJS.Platform) => (platform === 'win32' ? win32 : posix)

/** GUI 进程环境探测：macOS 需要登录 shell 的 PATH；其他平台直接用 process.env */
export function buildProbeCommand(
  platform: NodeJS.Platform,
  shell: string | undefined
): { file: string; args: string[] } | null {
  if (platform !== 'darwin' || !shell) return null
  return { file: shell, args: ['-l', '-i', '-c', 'env'] }
}

export function parseEnvOutput(output: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const line of output.split('\n')) {
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1)
    if (key && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) env[key] = value
  }
  return env
}

/** 异步探测用户登录环境（macOS）；失败或非 macOS 返回 null */
export function probeUserEnv(
  platform: NodeJS.Platform,
  shell: string | undefined,
  timeoutMs = 5000
): Promise<NodeJS.ProcessEnv | null> {
  const cmd = buildProbeCommand(platform, shell)
  if (!cmd) return Promise.resolve(null)
  return new Promise((resolve) => {
    const child = execFile(
      cmd.file,
      cmd.args,
      { timeout: timeoutMs, env: { TERM: 'dumb' } as NodeJS.ProcessEnv, windowsHide: true },
      (err, stdout) => {
        if (err && !stdout) {
          console.warn('[env] probe failed:', err instanceof Error ? err.message : err)
          resolve(null)
          return
        }
        const probed = parseEnvOutput(stdout)
        resolve(Object.keys(probed).length > 0 ? probed : null)
      }
    )
    child.on('error', () => resolve(null))
  })
}

/** 合成会话/子进程环境：探测结果优先，回退 GUI 进程环境 */
export function mergedEnv(base: NodeJS.ProcessEnv, probed: NodeJS.ProcessEnv | null): NodeJS.ProcessEnv {
  if (!probed) return { ...base }
  return { ...base, ...probed, PATH: probed.PATH ?? base.PATH ?? '' }
}

export function resolveClaudePath(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  exists: (p: string) => boolean = existsSync
): string | null {
  const join = pathFor(platform)
  const home = env.HOME ?? env.USERPROFILE
  if (!home) return null
  const exe = platform === 'win32' ? 'claude.exe' : 'claude'
  const sep = platform === 'win32' ? ';' : ':'
  const candidates = [join(home, '.local', 'bin', exe)]
  for (const dir of (env.PATH ?? '').split(sep)) {
    if (dir) candidates.push(join(dir, exe))
  }
  return candidates.find((p) => exists(p)) ?? null
}

/** 供设置页展示的探测候选（去重） */
export function claudeCandidates(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const join = pathFor(platform)
  const home = env.HOME ?? env.USERPROFILE
  const exe = platform === 'win32' ? 'claude.exe' : 'claude'
  const sep = platform === 'win32' ? ';' : ':'
  const out: string[] = []
  if (home) out.push(join(home, '.local', 'bin', exe))
  for (const dir of (env.PATH ?? '').split(sep)) if (dir) out.push(join(dir, exe))
  return [...new Set(out)]
}
```

- [ ] **Step 3.3: 运行测试确认通过**

Run: `npx vitest run src/main/env.test.ts`
Expected: 7 passed。

- [ ] **Step 3.4: Commit**

```bash
git add src/main/env.ts src/main/env.test.ts
git commit -m "feat(main): GUI 环境 PATH 探测与 claude 可执行解析（含 Windows 兜底）"
```

---

### Task 4: shell 选择 + SessionManager（TDD）

**Files:**
- Create: `src/main/shellSelect.ts`, `src/main/session/SessionManager.ts`
- Test: `src/main/shellSelect.test.ts`, `src/main/session/SessionManager.test.ts`

- [ ] **Step 4.1: 写 shellSelect 失败测试**

`src/main/shellSelect.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { defaultShellFor, pickWindowsShell } from './shellSelect'

describe('defaultShellFor', () => {
  it('darwin 用 $SHELL，缺省 zsh', () => {
    expect(defaultShellFor('darwin', { SHELL: '/bin/zsh' })).toEqual({ file: '/bin/zsh', args: ['-l'] })
    expect(defaultShellFor('darwin', {})).toEqual({ file: '/bin/zsh', args: ['-l'] })
  })
  it('linux 用 $SHELL，缺省 bash', () => {
    expect(defaultShellFor('linux', {})).toEqual({ file: '/bin/bash', args: ['-l'] })
  })
})

describe('pickWindowsShell 优先级 pwsh → powershell → cmd', () => {
  const pwsh = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
  const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  const comspec = 'C:\\Windows\\system32\\cmd.exe'
  it('pwsh 存在则用 pwsh', () => {
    expect(pickWindowsShell(() => true, comspec)).toEqual({ file: pwsh, args: [], label: 'pwsh' })
  })
  it('pwsh 不存在用 powershell', () => {
    const r = pickWindowsShell((p) => !p.includes('PowerShell\\7'), comspec)
    expect(r).toEqual({ file: powershell, args: [], label: 'powershell' })
  })
  it('都不存在用 cmd（ComSpec）', () => {
    expect(pickWindowsShell(() => false, comspec)).toEqual({ file: comspec, args: [], label: 'cmd' })
  })
})
```

Run: `npx vitest run src/main/shellSelect.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 4.2: 实现 shellSelect.ts**

`src/main/shellSelect.ts`：

```ts
export interface ShellChoice {
  file: string
  args: string[]
  label: string
}

const PWSH = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'

export function defaultShellFor(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): ShellChoice {
  if (platform === 'win32') {
    return pickWindowsShell(() => false, env.ComSpec ?? 'C:\\Windows\\system32\\cmd.exe')
  }
  const file = env.SHELL ?? (platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  return { file, args: ['-l'], label: file }
}

/**
 * Windows shell 探测。exists 回调由装配层实现（扫描 PATH / 常见安装位置），
 * 保证本函数纯逻辑可测。
 */
export function pickWindowsShell(exists: (absPath: string) => boolean, comspec: string): ShellChoice {
  if (exists(PWSH)) return { file: PWSH, args: [], label: 'pwsh' }
  if (exists(POWERSHELL)) return { file: POWERSHELL, args: [], label: 'powershell' }
  return { file: comspec, args: [], label: 'cmd' }
}

/** 装配层：在真实文件系统上解析 Windows shell */
export function resolveWindowsShell(env: NodeJS.ProcessEnv, existsSyncFn: (p: string) => boolean): ShellChoice {
  return pickWindowsShell((p) => existsSyncFn(p), env.ComSpec ?? 'C:\\Windows\\system32\\cmd.exe')
}
```

Run: `npx vitest run src/main/shellSelect.test.ts`
Expected: 5 passed。

- [ ] **Step 4.3: 写 SessionManager 失败测试（注入 FakePty 工厂）**

`src/main/session/SessionManager.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SessionManager, type PtyFactory, type PtyProcess } from './SessionManager'

class FakePty implements PtyProcess {
  written: string[] = []
  killed = false
  exited = false
  private dataCbs: Array<(d: string) => void> = []
  private exitCbs: Array<(c: number | undefined) => void> = []
  constructor(public opts: { file: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; cols: number; rows: number }) {}
  write(data: string): void { this.written.push(data) }
  resize(cols: number, rows: number): void { this.opts.cols = cols; this.opts.rows = rows }
  kill(): void { this.killed = true; this.exit(0) }
  onData(cb: (d: string) => void): void { this.dataCbs.push(cb) }
  onExit(cb: (c: number | undefined) => void): void { this.exitCbs.push(cb) }
  emitData(d: string): void { for (const cb of this.dataCbs) cb(d) }
  exit(code: number | undefined): void { if (this.exited) return; this.exited = true; for (const cb of this.exitCbs) cb(code) }
}

function makeManager(runClaude = true) {
  const created: FakePty[] = []
  const factory: PtyFactory = (opts) => {
    const pty = new FakePty(opts)
    created.push(pty)
    return pty
  }
  const mgr = new SessionManager(factory, { env: { HOME: '/Users/u' }, launchClaude: runClaude, claudeLaunchDelayMs: 10 })
  return { mgr, created }
}

describe('SessionManager', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('create 返回会话摘要，title 为 cwd basename', () => {
    const { mgr } = makeManager(false)
    const info = mgr.create('/Users/u/proj-a', 80, 24, { file: '/bin/zsh', args: ['-l'], label: 'zsh' })
    expect(info.title).toBe('proj-a')
    expect(info.cwd).toBe('/Users/u/proj-a')
    expect(info.alive).toBe(true)
    expect(mgr.list().map((s) => s.id)).toEqual([info.id])
  })

  it('create 后延迟写入 "claude\\r"（launchClaude=true）', () => {
    const { mgr, created } = makeManager(true)
    mgr.create('/Users/u/p', 80, 24, { file: '/bin/zsh', args: ['-l'], label: 'zsh' })
    expect(created[0].written).toEqual([])
    vi.advanceTimersByTime(20)
    expect(created[0].written).toEqual(['claude\r'])
  })

  it('launchClaude=false 不写入 claude', () => {
    const { mgr, created } = makeManager(false)
    mgr.create('/p', 80, 24, { file: '/bin/zsh', args: ['-l'], label: 'zsh' })
    vi.advanceTimersByTime(50)
    expect(created[0].written).toEqual([])
  })

  it('write/resize 转发到对应 pty', () => {
    const { mgr, created } = makeManager(false)
    const a = mgr.create('/a', 80, 24, { file: '/bin/zsh', args: [], label: 'zsh' })
    mgr.write(a.id, 'ls\n')
    mgr.resize(a.id, 100, 30)
    expect(created[0].written).toEqual(['ls\n'])
    expect(created[0].opts.cols).toBe(100)
  })

  it('onData 广播带会话 id；onExit 后 alive=false', () => {
    const { mgr, created } = makeManager(false)
    const seen: Array<{ id: string; data: string }> = []
    const exits: Array<{ id: string; code: number | undefined }> = []
    mgr.onData((ev) => seen.push(ev))
    mgr.onExit((ev) => exits.push(ev))
    const a = mgr.create('/a', 80, 24, { file: '/bin/zsh', args: [], label: 'zsh' })
    created[0].emitData('hello')
    expect(seen).toEqual([{ id: a.id, data: 'hello' }])
    created[0].exit(3)
    expect(exits).toEqual([{ id: a.id, code: 3 }])
    expect(mgr.list()[0].alive).toBe(false)
  })

  it('kill 杀 pty 并标记退出', () => {
    const { mgr, created } = makeManager(false)
    const a = mgr.create('/a', 80, 24, { file: '/bin/zsh', args: [], label: 'zsh' })
    mgr.kill(a.id)
    expect(created[0].killed).toBe(true)
    expect(mgr.list()[0].alive).toBe(false)
  })

  it('kill 不存在的 id 不抛错', () => {
    const { mgr } = makeManager(false)
    expect(() => mgr.kill('nope')).not.toThrow()
  })
})
```

Run: `npx vitest run src/main/session/SessionManager.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 4.4: 实现 SessionManager.ts**

`src/main/session/SessionManager.ts`：

```ts
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { SessionSummary } from '@shared/types'
import type { ShellChoice } from '../shellSelect'

export interface PtySpawnOptions {
  file: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  cols: number
  rows: number
}

export interface PtyProcess {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  onData(cb: (data: string) => void): void
  onExit(cb: (code: number | undefined) => void): void
}

export type PtyFactory = (opts: PtySpawnOptions) => PtyProcess

interface SessionEntry {
  info: SessionSummary
  pty: PtyProcess
  claudeTimer?: NodeJS.Timeout
}

export class SessionManager {
  private sessions = new Map<string, SessionEntry>()
  // 类级监听器集合：注册时机与 会话创建顺序 解耦（IPC 广播在启动时注册，早于任何会话）
  private dataListeners = new Set<(ev: { id: string; data: string }) => void>()
  private exitListeners = new Set<(ev: { id: string; code: number | undefined }) => void>()

  constructor(
    private readonly factory: PtyFactory,
    private readonly defaults: {
      env: NodeJS.ProcessEnv
      launchClaude: boolean
      claudeLaunchDelayMs?: number
    }
  ) {}

  create(cwd: string, cols: number, rows: number, shell: ShellChoice): SessionSummary {
    const id = randomUUID()
    const pty = this.factory({
      file: shell.file,
      args: shell.args,
      cwd,
      env: this.defaults.env,
      cols,
      rows
    })
    const info: SessionSummary = {
      id,
      title: basename(cwd) || cwd,
      cwd,
      shellCommand: shell.file,
      createdAt: new Date().toISOString(),
      alive: true
    }
    const entry: SessionEntry = { info, pty }
    this.sessions.set(id, entry)

    pty.onData((data) => {
      for (const cb of this.dataListeners) cb({ id, data })
    })
    pty.onExit((code) => {
      info.alive = false
      if (entry.claudeTimer) clearTimeout(entry.claudeTimer)
      for (const cb of this.exitListeners) cb({ id, code })
    })

    if (this.defaults.launchClaude) {
      entry.claudeTimer = setTimeout(
        () => pty.write('claude\r'),
        this.defaults.claudeLaunchDelayMs ?? 600
      )
    }
    return info
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.pty.resize(cols, rows)
  }

  kill(id: string): void {
    const entry = this.sessions.get(id)
    if (!entry) return
    if (entry.claudeTimer) clearTimeout(entry.claudeTimer)
    entry.pty.kill()
    entry.info.alive = false
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()].map((s) => ({ ...s.info }))
  }

  onData(cb: (ev: { id: string; data: string }) => void): void {
    this.dataListeners.add(cb)
  }

  onExit(cb: (ev: { id: string; code: number | undefined }) => void): void {
    this.exitListeners.add(cb)
  }
}
```

- [ ] **Step 4.5: 运行测试确认通过**

Run: `npx vitest run src/main/shellSelect.test.ts src/main/session/SessionManager.test.ts`
Expected: 全部 passed。

- [ ] **Step 4.6: Commit**

```bash
git add src/main/shellSelect.ts src/main/shellSelect.test.ts src/main/session
git commit -m "feat(main): 平台 shell 选择 + pty 会话管理器（工厂注入、自动启动 claude）"
```

---

### Task 5: node-pty 装配 + IPC 通道 + preload API

**Files:**
- Create: `src/main/ptyFactory.ts`, `src/main/ipc.ts`
- Modify: `src/main/index.ts`（装配）、`src/preload/index.ts`（暴露 sessions API）

- [ ] **Step 5.1: 写 node-pty 工厂（适配 PtyProcess 接口）**

`src/main/ptyFactory.ts`：

```ts
import { spawn as ptySpawn } from 'node-pty'
import type { PtyFactory } from './session/SessionManager'

/** 真实 node-pty 工厂（N-API，无需 electron-rebuild） */
export const nodePtyFactory: PtyFactory = (opts) => {
  const pty = ptySpawn(opts.file, opts.args, {
    cwd: opts.cwd,
    env: opts.env,
    cols: opts.cols,
    rows: opts.rows,
    name: 'xterm-256color'
  })
  return {
    write: (data) => pty.write(data),
    resize: (cols, rows) => pty.resize(cols, rows),
    kill: (signal) => pty.kill(signal),
    onData: (cb) => pty.onData(cb),
    // node-pty 1.1.0 的 onExit 回调参数是 { exitCode, signal }，不是裸 number
    onExit: (cb) => pty.onExit(({ exitCode }) => cb(exitCode))
  }
}
```

- [ ] **Step 5.2: 写 IPC 注册模块（本任务只含 sessions 通道，后续任务追加）**

`src/main/ipc.ts`：

```ts
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { SessionManager } from './session/SessionManager'
import type { SessionSummary } from '@shared/types'

export interface IpcDeps {
  getWindow: () => BrowserWindow | null
  sessions: SessionManager
}

/** 渲染进程 → 主进程推送（preload 里包装成 onXxx 订阅） */
export const CHANNELS = {
  sessionData: 'session:data',
  sessionExit: 'session:exit'
} as const

function push(win: BrowserWindow | null, channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

export function registerIpc(deps: IpcDeps): void {
  const { sessions } = deps

  ipcMain.handle('sessions:create', (_e, cwd: string): SessionSummary => {
    return sessions.create(cwd, 80, 24, deps.shellFor(cwd))
  })
  ipcMain.handle('sessions:write', (_e, id: string, data: string) => sessions.write(id, data))
  ipcMain.handle('sessions:resize', (_e, id: string, cols: number, rows: number) =>
    sessions.resize(id, cols, rows)
  )
  ipcMain.handle('sessions:kill', (_e, id: string) => sessions.kill(id))
  ipcMain.handle('sessions:list', () => sessions.list())

  ipcMain.handle('app:pickDirectory', async () => {
    const win = deps.getWindow()
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })

  // 广播转发
  sessions.onData((ev) => push(deps.getWindow(), CHANNELS.sessionData, ev))
  sessions.onExit((ev) => push(deps.getWindow(), CHANNELS.sessionExit, ev))
}
```

**注意**：`deps.shellFor` 需要加入 `IpcDeps`——直接在接口里加：

```ts
export interface IpcDeps {
  getWindow: () => BrowserWindow | null
  sessions: SessionManager
  shellFor: (cwd: string) => import('./shellSelect').ShellChoice
}
```

（把上面 `IpcDeps` 定义替换为此版本。）

- [ ] **Step 5.3: 更新 preload 暴露 sessions + app API**

`src/preload/index.ts`（覆盖）：

```ts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { SessionSummary } from '@shared/types'

const api = {
  sessions: {
    create: (cwd: string): SessionSummary => ipcRenderer.invoke('sessions:create', cwd),
    write: (id: string, data: string): Promise<void> => ipcRenderer.invoke('sessions:write', id, data),
    resize: (id: string, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke('sessions:resize', id, cols, rows),
    kill: (id: string): Promise<void> => ipcRenderer.invoke('sessions:kill', id),
    list: (): Promise<SessionSummary[]> => ipcRenderer.invoke('sessions:list')
  },
  onSessionData: (cb: (ev: { id: string; data: string }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, ev: { id: string; data: string }) => cb(ev)
    ipcRenderer.on('session:data', listener)
    return () => ipcRenderer.removeListener('session:data', listener)
  },
  onSessionExit: (cb: (ev: { id: string; code: number | undefined }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, ev: { id: string; code: number | undefined }) => cb(ev)
    ipcRenderer.on('session:exit', listener)
    return () => ipcRenderer.removeListener('session:exit', listener)
  },
  app: {
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('app:pickDirectory'),
    platform: process.platform
  }
}

contextBridge.exposeInMainWorld('api', api)
export type AgentDeskApi = typeof api
```

- [ ] **Step 5.4: 主进程装配（探测 env → claude → SessionManager → IPC）**

`src/main/index.ts` 中 `app.whenReady().then(...)` 改为（保留其余部分）：

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { probeUserEnv, mergedEnv, resolveClaudePath } from './env'
import { defaultShellFor, resolveWindowsShell, type ShellChoice } from './shellSelect'
import { nodePtyFactory } from './ptyFactory'
import { SessionManager } from './session/SessionManager'
import { registerIpc } from './ipc'
import { existsSync } from 'node:fs'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#161b22',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  const probed = await probeUserEnv(process.platform, process.env.SHELL)
  const env = mergedEnv(process.env, probed)
  const claudePath = resolveClaudePath(env, process.platform)

  const shell: ShellChoice =
    process.platform === 'win32'
      ? resolveWindowsShell(env, existsSync)
      : defaultShellFor(process.platform, env)

  const sessions = new SessionManager(nodePtyFactory, {
    env,
    launchClaude: claudePath !== null
  })

  registerIpc({
    getWindow: () => mainWindow,
    sessions,
    shellFor: () => shell
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 5.5: 冒烟验证**

Run: `npm run dev`，打开 DevTools（View → Toggle Developer Tools），在 Console 执行：

```js
const s = await window.api.sessions.create('/tmp')
await window.api.sessions.write(s.id, 'echo HELLO_FROM_PTY\r')
```

人工确认：几秒内 Console 里 `window.api.onSessionData(ev => console.log(ev.data))`（先订阅再执行 write）能看到 pty 输出（含 `HELLO_FROM_PTY` 与 shell 提示符）；若 `claude` 存在，约 1 秒后输出中出现 claude 启动画面。测试完 `await window.api.sessions.kill(s.id)`。

Run: `npm run typecheck`
Expected: 0 errors。

- [ ] **Step 5.6: Commit**

```bash
git add -A
git commit -m "feat(main): node-pty 装配 + sessions IPC + preload API，pty 全链路打通"
```

---

### Task 6: TerminalPane（xterm.js 深底常驻）

**Files:**
- Create: `src/renderer/src/theme/xtermThemes.ts`, `src/renderer/src/components/TerminalPane.tsx`
- Modify: `src/renderer/src/styles/global.css`（追加终端样式）、`src/renderer/src/App.tsx`（临时挂载）

> 执行本任务前先调用 `frontend-design` skill；令牌与类名以本计划为准，视觉细节可按 skill 指导打磨。

- [ ] **Step 6.1: 写 xterm 双主题 ANSI 配色**

`src/renderer/src/theme/xtermThemes.ts`：

```ts
import type { ITheme } from '@xterm/xterm'

/** 深色：GitHub Dark Dimmed 系；浅色：GitHub Light 系。终端底色始终深/浅对应 UI 主题，但底色保持舒适阅读 */
export const xtermDark: ITheme = {
  background: '#0d1117',
  foreground: '#adbac7',
  cursor: '#f78166',
  cursorAccent: '#0d1117',
  selectionBackground: 'rgba(247,129,102,.25)',
  black: '#545d68', red: '#f47067', green: '#57ab5a', yellow: '#c69026',
  blue: '#539bf5', magenta: '#b083f0', cyan: '#39c5cf', white: '#909dab',
  brightBlack: '#636e7b', brightRed: '#ff938a', brightGreen: '#7bc96f', brightYellow: '#e3b341',
  brightBlue: '#6cb6ff', brightMagenta: '#dcbdfb', brightCyan: '#56d4dd', brightWhite: '#cdd9e5'
}

export const xtermLight: ITheme = {
  background: '#fafbfc',
  foreground: '#4b5563',
  cursor: '#316dca',
  cursorAccent: '#fafbfc',
  selectionBackground: 'rgba(49,109,202,.22)',
  black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#4d2d00',
  blue: '#0550ae', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
  brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#633c01',
  brightBlue: '#0969da', brightMagenta: '#8250df', brightCyan: '#3192aa', brightWhite: '#8c959f'
}

export function xtermThemeFor(theme: 'light' | 'dark'): ITheme {
  return theme === 'dark' ? xtermDark : xtermLight
}
```

**说明**：spec 说「终端深底常驻不随主题反转」——这里指终端**容器/边框区**保持深色底（`--terminal-bg`），xterm 自身的配色跟随主题换 ANSI 表（深色用深底、浅色用浅底），与 VS Code 行为一致。TerminalPane 的容器背景恒为 `var(--terminal-bg)`。

- [ ] **Step 6.2: global.css 追加终端样式**

在 `src/renderer/src/styles/global.css` 末尾追加：

```css
/* ===== 终端 ===== */
.terminal-host {
  height: 100%;
  background: var(--terminal-bg);
  padding: 6px 4px 0 10px;
}
.terminal-host.is-hidden { display: none; }
```

- [ ] **Step 6.3: 写 TerminalPane.tsx**

`src/renderer/src/components/TerminalPane.tsx`：

```tsx
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { SessionSummary } from '@shared/types'
import { effectiveTheme } from '@/theme/theme'
import { xtermThemeFor } from '@/theme/xtermThemes'

interface Props {
  session: SessionSummary
  active: boolean
  themeMode: 'light' | 'dark'
}

export function TerminalPane({ session, active, themeMode }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  // 生命周期：一个 session 一个 Terminal 实例（保住 scrollback）
  useEffect(() => {
    const term = new Terminal({
      fontSize: 13,
      fontFamily: '"SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10000,
      theme: xtermThemeFor(effectiveTheme('system'))
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current!)
    // 放行应用级快捷键（⌘/Ctrl+T、W、1-9）到应用层
    term.attachCustomKeyEventHandler((ev) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.type === 'keydown') {
        const k = ev.key.toLowerCase()
        if (k === 't' || k === 'w' || (k >= '1' && k <= '9')) return false
      }
      return true
    })
    const offData = window.api.onSessionData((ev) => {
      if (ev.id === session.id) term.write(ev.data)
    })
    term.onData((d) => window.api.sessions.write(session.id, d))
    termRef.current = term
    fitRef.current = fit
    const syncSize = () => {
      try {
        fit.fit()
        window.api.sessions.resize(session.id, term.cols, term.rows)
      } catch {
        /* host 不可见时 fit 会抛错，忽略 */
      }
    }
    requestAnimationFrame(syncSize)
    const ro = new ResizeObserver(() => {
      if (hostRef.current?.offsetParent !== null) syncSize()
    })
    ro.observe(hostRef.current!)
    return () => {
      ro.disconnect()
      offData()
      term.dispose()
      termRef.current = null
    }
  }, [session.id])

  // 激活时 refit + 聚焦
  useEffect(() => {
    if (!active) return
    requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
        const t = termRef.current
        if (t) window.api.sessions.resize(session.id, t.cols, t.rows)
      } catch {
        /* ignore */
      }
      termRef.current?.focus()
    })
  }, [active, session.id])

  // 主题切换
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermThemeFor(themeMode)
  }, [themeMode])

  return <div ref={hostRef} className={`terminal-host${active ? '' : ' is-hidden'}`} />
}
```

- [ ] **Step 6.4: App.tsx 临时挂载验证**

`src/renderer/src/App.tsx` 临时改为（Task 7 会替换成完整布局）：

```tsx
import { useEffect, useState } from 'react'
import './i18n'
import { applyTheme, effectiveTheme, watchSystemTheme } from './theme/theme'
import { TerminalPane } from './components/TerminalPane'

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(effectiveTheme('system'))
  useEffect(() => {
    applyTheme('system')
    return watchSystemTheme(() => setTheme(effectiveTheme('system')))
  }, [])
  const [sessionId, setSessionId] = useState<string | null>(null)
  useEffect(() => {
    void window.api.sessions.create('/tmp').then((s) => setSessionId(s.id))
  }, [])
  return (
    <div style={{ height: '100%' }}>
      {sessionId ? (
        <TerminalPane
          session={{ id: sessionId, title: 'tmp', cwd: '', shellCommand: '', createdAt: '', alive: true }}
          active
          themeMode={theme}
        />
      ) : null}
    </div>
  )
}
```

Run: `npm run dev`
人工确认：窗口内出现可交互终端；输入 `echo hi`、`ls` 有输出；`claude` 自动启动（若安装）；窗口拉伸终端自动 refit；切系统主题后 ANSI 配色切换。

- [ ] **Step 6.5: Commit**

```bash
git add -A
git commit -m "feat(ui): xterm.js 终端组件（双 ANSI 主题、fit、scrollback 常驻）"
```

---

### Task 7: 标签栏 + 会话侧栏 + 新会话弹窗 + 快捷键

**Files:**
- Create: `src/renderer/src/stores/sessions.ts`, `src/renderer/src/theme/modeStore.ts`, `src/renderer/src/components/TitleBar.tsx`, `src/renderer/src/components/SessionSidebar.tsx`, `src/renderer/src/components/NewSessionModal.tsx`, `src/renderer/src/components/ui/Modal.tsx`, `src/renderer/src/components/ui/StatusDot.tsx`
- Modify: `src/renderer/src/App.tsx`（完整布局替换）、`src/main/ipc.ts`（快捷键转发）、`src/preload/index.ts`（onShortcut）

> 执行本任务前先调用 `frontend-design` skill。

- [ ] **Step 7.1: 写会话 zustand store**

`src/renderer/src/stores/sessions.ts`：

```ts
import { create } from 'zustand'
import type { SessionSummary } from '@shared/types'

interface SessionState {
  sessions: SessionSummary[]
  activeId: string | null
  hydrate: () => Promise<void>
  activate: (id: string) => void
  createAndActivate: (cwd: string) => Promise<SessionSummary | null>
  rename: (id: string, title: string) => void
  markExited: (id: string, code: number | undefined) => void
  close: (id: string) => Promise<void>
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  sessions: [],
  activeId: null,
  hydrate: async () => {
    const sessions = await window.api.sessions.list()
    set({ sessions, activeId: sessions.length > 0 ? sessions[0].id : null })
  },
  activate: (id) => set({ activeId: id }),
  createAndActivate: async (cwd) => {
    try {
      const info = await window.api.sessions.create(cwd)
      set((s) => ({ sessions: [...s.sessions, info], activeId: info.id }))
      return info
    } catch (e) {
      console.error('create session failed', e)
      return null
    }
  },
  rename: (id, title) =>
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, title } : x)) })),
  markExited: (id, _code) =>
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, alive: false } : x)) })),
  close: async (id) => {
    await window.api.sessions.kill(id)
    const rest = get().sessions.filter((x) => x.id !== id)
    set({
      sessions: rest,
      activeId:
        get().activeId === id ? (rest.length > 0 ? rest[rest.length - 1].id : null) : get().activeId
    })
  }
}))
```

`src/renderer/src/theme/modeStore.ts`（主题模式，Task 18 并入设置持久化）：

```ts
import { create } from 'zustand'
import { applyTheme, effectiveTheme } from './theme'

export type ThemeMode = 'system' | 'light' | 'dark'

interface ModeState {
  mode: ThemeMode
  effective: 'light' | 'dark'
  setMode: (m: ThemeMode) => void
}

export const useModeStore = create<ModeState>()((set, get) => ({
  mode: 'system',
  effective: effectiveTheme('system'),
  setMode: (m) => {
    applyTheme(m)
    set({ mode: m, effective: effectiveTheme(m) })
    if (m !== 'system') {
      // 显式选择时通知主进程固定 nativeTheme（影响 Chromium UI 色与后续 matchMedia）
      void window.api.app?.setTheme?.(m)
    }
  }
}))
```

注：`window.api.app.setTheme` 在 Task 18 才加入 preload；本任务先以 `?.` 可选调用，typecheck 需要 `app` 类型允许该可选方法——在 `src/renderer/src/global.d.ts` 声明：

```ts
// src/renderer/src/global.d.ts
import type { AgentDeskApi } from '../../preload/index'

declare global {
  interface Window {
    api: AgentDeskApi & {
      app?: Partial<AgentDeskApi['app']> & {
        setTheme?: (m: 'system' | 'light' | 'dark') => Promise<void>
        onShortcut?: (cb: (s: { key: string }) => void) => () => void
      }
    }
  }
}

export {}
```

（Task 18 会移除可选包装，直接用 `AgentDeskApi`。）

- [ ] **Step 7.2: 主进程注册快捷键转发（before-input-event，绕过菜单默认 ⌘W）**

`src/main/ipc.ts`：在 `registerIpc` 内追加（`deps.getWindow()` 获取 win）：

```ts
  // 应用级快捷键：⌘/Ctrl+T 新会话、⌘/Ctrl+W 关会话、⌘/Ctrl+1-9 切换
  // 用 before-input-event 拦截，避免 macOS 默认菜单把 ⌘W 变成关窗口
  const SHORTCUT_KEYS = new Set(['t', 'w', '1', '2', '3', '4', '5', '6', '7', '8', '9'])
  function hookShortcuts(): void {
    const win = deps.getWindow()
    if (!win || win.isDestroyed()) return
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      if (!(input.meta || input.control) || input.alt || input.shift) return  // Electron Input 用 alt/shift
      const key = input.key.toLowerCase()
      if (SHORTCUT_KEYS.has(key)) {
        event.preventDefault()
        push(win, 'app:shortcut', { key })
      }
    })
  }
```

并在 `registerIpc` 末尾调用 `hookShortcuts()`。**hookShortcuts 必须在窗口创建后执行**——把 `registerIpc` 的调用时机改为 `createWindow()` 之后（Step 7.4 的装配代码已保证），同时 `getSessionWindow` 使用闭包 `mainWindow`，创建顺序：createWindow() → registerIpc(...)。若 webContents 已有 listener 会重复注册——用 `win.webContents.removeAllListeners('before-input-event')` 先清一次再挂。

`src/preload/index.ts` 的 `api` 对象追加：

```ts
  onShortcut: (cb: (s: { key: string }) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, s: { key: string }) => cb(s)
    ipcRenderer.on('app:shortcut', listener)
    return () => ipcRenderer.removeListener('app:shortcut', listener)
  }
```

- [ ] **Step 7.3: 写 UI 组件**

`src/renderer/src/components/ui/StatusDot.tsx`：

```tsx
export function StatusDot({ alive, running }: { alive: boolean; running?: boolean }) {
  const color = running ? 'var(--warn)' : alive ? 'var(--success)' : 'var(--text-dim)'
  return <span className="status-dot" style={{ background: color }} aria-hidden />
}
```

`src/renderer/src/components/ui/Modal.tsx`：

```tsx
import type { ReactNode } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  width?: number
}

export function Modal({ title, onClose, children, width = 460 }: Props) {
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="close">✕</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
```

global.css 追加：

```css
/* ===== 弹窗 ===== */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(1,4,9,.5);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.modal {
  background: var(--bg-raised); border: 1px solid var(--border);
  border-radius: 10px; box-shadow: var(--shadow); max-height: 80vh; display: flex; flex-direction: column;
}
.modal header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--border);
  -webkit-app-region: no-drag;
}
.modal header h2 { margin: 0; font-size: 14px; color: var(--text-strong); font-weight: 600; }
.modal-body { padding: 16px; overflow-y: auto; }

.status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; }

/* ===== 应用布局 ===== */
.app-shell { display: grid; grid-template-rows: 40px 1fr; height: 100%; }
.app-body { display: grid; grid-template-columns: 220px 1fr; min-height: 0; }

/* ===== 顶栏 / tabs ===== */
.titlebar {
  display: flex; align-items: center; gap: 8px; padding: 0 10px;
  background: var(--bg-sidebar); border-bottom: 1px solid var(--border);
  -webkit-app-region: drag;
}
.titlebar > * { -webkit-app-region: no-drag; }
.brand { font-weight: 700; font-size: 13px; color: var(--text-strong); margin-right: 4px; }
.tabstrip { display: flex; align-items: flex-end; gap: 2px; flex: 1; min-width: 0; overflow-x: auto; }
.tab {
  display: inline-flex; align-items: center; gap: 6px; max-width: 180px;
  padding: 5px 8px 6px; border-radius: 6px 6px 0 0; font-size: 12px;
  color: var(--text-dim); border-bottom: 2px solid transparent; white-space: nowrap;
}
.tab:hover { color: var(--text-strong); background: var(--accent-soft); }
.tab.active { color: var(--text-strong); border-bottom-color: var(--accent); background: var(--accent-soft); }
.tab .close-x { visibility: hidden; color: var(--text-dim); font-size: 11px; padding: 0 2px; }
.tab:hover .close-x { visibility: visible; }
.tab .close-x:hover { color: var(--danger); }
.titlebar-actions { display: flex; align-items: center; gap: 4px; }
.icon-btn {
  display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px;
  border-radius: 6px; color: var(--text-dim); font-size: 12px; position: relative;
}
.icon-btn:hover { color: var(--text-strong); background: var(--accent-soft); }

/* ===== 侧栏 ===== */
.sidebar {
  background: var(--bg-sidebar); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; min-height: 0;
}
.sidebar-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px 6px; font-size: 11px; text-transform: uppercase;
  letter-spacing: .6px; color: var(--text-dim);
}
.sidebar-list { flex: 1; overflow-y: auto; padding: 0 8px; }
.session-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 6px 8px; border-radius: 6px; color: var(--text-dim);
  text-align: left; font-size: 12.5px;
}
.session-item:hover { background: var(--accent-soft); color: var(--text-strong); }
.session-item.active { background: var(--accent-soft); color: var(--accent); }
.session-item .label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.session-item .close-x { visibility: hidden; color: var(--text-dim); }
.session-item:hover .close-x { visibility: visible; }
.session-item .close-x:hover { color: var(--danger); }
.sidebar-foot { padding: 8px 12px 12px; border-top: 1px solid var(--border); }
.ctx-menu {
  position: fixed; z-index: 200; background: var(--bg-raised);
  border: 1px solid var(--border); border-radius: 8px; box-shadow: var(--shadow); padding: 4px; min-width: 160px;
}
.ctx-menu button { display: block; width: 100%; text-align: left; padding: 6px 10px; border-radius: 5px; font-size: 12.5px; color: var(--text); }
.ctx-menu button:hover { background: var(--accent-soft); color: var(--text-strong); }

/* ===== 终端区 ===== */
.terminal-area { background: var(--terminal-bg); min-width: 0; min-height: 0; position: relative; }
```

`src/renderer/src/components/TitleBar.tsx`：

```tsx
import { useTranslation } from 'react-i18next'
import { useSessionStore } from '@/stores/sessions'
import { StatusDot } from './ui/StatusDot'

interface Props {
  onNewSession: () => void
  onOpenTasks: () => void
  onOpenExtensions: () => void
  onOpenSettings: () => void
  tasksRunning: number
}

export function TitleBar({ onNewSession, onOpenTasks, onOpenExtensions, onOpenSettings, tasksRunning }: Props) {
  const { t } = useTranslation()
  const sessions = useSessionStore((s) => s.sessions)
  const activeId = useSessionStore((s) => s.activeId)
  const activate = useSessionStore((s) => s.activate)
  const close = useSessionStore((s) => s.close)

  return (
    <div className="titlebar">
      <span className="brand">AgentDesk</span>
      <div className="tabstrip">
        {sessions.map((s) => (
          <button
            key={s.id}
            className={`tab${s.id === activeId ? ' active' : ''}`}
            onClick={() => activate(s.id)}
            onMouseDown={(e) => e.button === 1 && close(s.id)}
            title={s.cwd}
          >
            <StatusDot alive={s.alive} />
            <span className="label">{s.title}</span>
            <span className="close-x" onClick={(e) => { e.stopPropagation(); close(s.id) }}>✕</span>
          </button>
        ))}
        <button className="icon-btn" onClick={onNewSession} title={t('tabs.newTab')}>＋</button>
      </div>
      <div className="titlebar-actions">
        <button className="icon-btn" onClick={onOpenTasks}>
          ⏰ {t('tasks.title')}
          {tasksRunning > 0 && <span className="badge">{tasksRunning}</span>}
        </button>
        <button className="icon-btn" onClick={onOpenExtensions}>🧩 {t('registry.title')}</button>
        <button className="icon-btn" onClick={onOpenSettings} aria-label={t('settings.title')}>⚙️</button>
      </div>
    </div>
  )
}
```

`src/renderer/src/components/SessionSidebar.tsx`：

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSessionStore } from '@/stores/sessions'
import { StatusDot } from './ui/StatusDot'
import { NextTaskCard } from './NextTaskCard'

export function SessionSidebar({ onNewSession }: { onNewSession: () => void }) {
  const { t } = useTranslation()
  const sessions = useSessionStore((s) => s.sessions)
  const activeId = useSessionStore((s) => s.activeId)
  const activate = useSessionStore((s) => s.activate)
  const close = useSessionStore((s) => s.close)
  const rename = useSessionStore((s) => s.rename)
  const createAndActivate = useSessionStore((s) => s.createAndActivate)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null)

  return (
    <aside className="sidebar" onClick={() => setMenu(null)}>
      <div className="sidebar-head">
        <span>{t('sessions.title')}</span>
        <button className="btn btn-ghost" onClick={onNewSession} title={t('sessions.new')}>＋</button>
      </div>
      <div className="sidebar-list">
        {sessions.length === 0 && (
          <p style={{ color: 'var(--text-dim)', fontSize: 12, padding: '8px' }}>{t('sessions.empty')}</p>
        )}
        {sessions.map((s) => (
          <button
            key={s.id}
            className={`session-item${s.id === activeId ? ' active' : ''}`}
            onClick={() => activate(s.id)}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ id: s.id, x: e.clientX, y: e.clientY }) }}
            onDoubleClick={() => setEditing({ id: s.id, value: s.title })}
          >
            <StatusDot alive={s.alive} />
            {editing?.id === s.id ? (
              <input
                autoFocus
                value={editing.value}
                onChange={(e) => setEditing({ id: s.id, value: e.target.value })}
                onBlur={() => { rename(s.id, editing.value.trim() || s.title); setEditing(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') { rename(s.id, editing.value.trim() || s.title); setEditing(null) } }}
                style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--text-strong)' }}
              />
            ) : (
              <span className="label" title={s.cwd}>{s.title}</span>
            )}
            <span className="close-x" onClick={(e) => { e.stopPropagation(); close(s.id) }}>✕</span>
          </button>
        ))}
      </div>
      <div className="sidebar-foot">
        <NextTaskCard onOpenTasks={() => undefined} />
      </div>
      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
          <button onClick={() => { const s = sessions.find((x) => x.id === menu.id); if (s) { void navigator.clipboard.writeText(s.cwd); setMenu(null) } }}>
            {t('sessions.copyPath')}
          </button>
          <button onClick={() => { const s = sessions.find((x) => x.id === menu.id); if (s) setEditing({ id: s.id, value: s.title }); setMenu(null) }}>
            {t('sessions.rename')}
          </button>
          <button onClick={() => { void close(menu.id); setMenu(null) }}>
            {t('sessions.closeSession')}
          </button>
          <button onClick={() => { const s = sessions.find((x) => x.id === menu.id); if (s) void createAndActivate(s.cwd); setMenu(null) }}>
            {t('sessions.restart')}
          </button>
        </div>
      )}
    </aside>
  )
}
```

注：`NextTaskCard` 在 Task 15 才有——本任务先建占位文件 `src/renderer/src/components/NextTaskCard.tsx`：

```tsx
export function NextTaskCard(_props: { onOpenTasks: () => void }) {
  return null
}
```

`src/renderer/src/components/NewSessionModal.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from './ui/Modal'
import { useSessionStore } from '@/stores/sessions'

export function NewSessionModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const createAndActivate = useSessionStore((s) => s.createAndActivate)
  const [cwd, setCwd] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.api.app.pickDirectory().then((dir) => {
      if (!dir) onClose()
      else setCwd(dir)
    })
  }, [onClose])

  const confirm = async () => {
    if (!cwd || busy) return
    setBusy(true)
    const s = await createAndActivate(cwd)
    setBusy(false)
    if (s) onClose()
  }

  return (
    <Modal title={t('sessions.new')} onClose={onClose}>
      <div className="field">
        <label>{t('tasks.cwd')}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={cwd ?? ''} readOnly style={{ flex: 1 }} />
          <button className="btn" onClick={() => void window.api.app.pickDirectory().then((d) => d && setCwd(d))}>
            {t('tasks.pickDir')}
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn btn-primary" disabled={!cwd || busy} onClick={() => void confirm()}>
          {t('sessions.new')}
        </button>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 7.4: App.tsx 完整布局 + 快捷键**

`src/renderer/src/App.tsx`（覆盖 Task 6 的临时版本）：

```tsx
import { useEffect, useState } from 'react'
import './i18n'
import { applyTheme, effectiveTheme, watchSystemTheme } from '@/theme/theme'
import { useModeStore } from '@/theme/modeStore'
import { useSessionStore } from '@/stores/sessions'
import { TitleBar } from '@/components/TitleBar'
import { SessionSidebar } from '@/components/SessionSidebar'
import { NewSessionModal } from '@/components/NewSessionModal'
import { TerminalPane } from '@/components/TerminalPane'

export default function App() {
  const mode = useModeStore((s) => s.mode)
  const effective = useModeStore((s) => s.effective)
  const sessions = useSessionStore((s) => s.sessions)
  const activeId = useSessionStore((s) => s.activeId)
  const hydrate = useSessionStore((s) => s.hydrate)
  const markExited = useSessionStore((s) => s.markExited)
  const activate = useSessionStore((s) => s.activate)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [tasksOpen, setTasksOpen] = useState(false)   // Task 13 接入抽屉
  const [extOpen, setExtOpen] = useState(false)       // Task 17 接入抽屉
  const [settingsOpen, setSettingsOpen] = useState(false) // Task 18 接入

  useEffect(() => {
    applyTheme('system')
    const off = watchSystemTheme(() => {
      if (useModeStore.getState().mode === 'system') useModeStore.setState({ effective: effectiveTheme('system') })
    })
    return off
  }, [])

  useEffect(() => {
    void hydrate()
    const offExit = window.api.onSessionExit((ev) => markExited(ev.id, ev.code))
    return offExit
  }, [hydrate, markExited])

  useEffect(() => {
    const off = window.api.onShortcut?.(({ key }) => {
      if (key === 't') setNewSessionOpen(true)
      else if (key === 'w') {
        const id = useSessionStore.getState().activeId
        if (id) void useSessionStore.getState().close(id)
      } else {
        const idx = Number(key) - 1
        const s = useSessionStore.getState().sessions[idx]
        if (s) activate(s.id)
      }
    })
    return off ?? undefined
  }, [activate])

  return (
    <div className="app-shell">
      <TitleBar
        onNewSession={() => setNewSessionOpen(true)}
        onOpenTasks={() => setTasksOpen((v) => !v)}
        onOpenExtensions={() => setExtOpen((v) => !v)}
        onOpenSettings={() => setSettingsOpen(true)}
        tasksRunning={0}
      />
      <div className="app-body">
        <SessionSidebar onNewSession={() => setNewSessionOpen(true)} />
        <main className="terminal-area">
          {sessions.map((s) => (
            <TerminalPane key={s.id} session={s} active={s.id === activeId} themeMode={effective} />
          ))}
        </main>
      </div>
      {newSessionOpen && <NewSessionModal onClose={() => setNewSessionOpen(false)} />}
      {/* Task 13/17/18: {tasksOpen && <TaskDrawer …/>} {extOpen && <ExtensionsDrawer …/>} {settingsOpen && <SettingsModal …/>} */}
      <span hidden>{String(tasksOpen)}{String(extOpen)}{String(settingsOpen)}{String(mode)}</span>
    </div>
  )
}
```

**同步修主进程装配顺序**（`src/main/index.ts` 的 `whenReady` 回调）：`createWindow()` 移到 `registerIpc(...)` 之前：

```ts
  createWindow()
  registerIpc({
    getWindow: () => mainWindow,
    sessions,
    shellFor: () => shell
  })
```

- [ ] **Step 7.5: 冒烟验证**

Run: `npm run dev`，人工确认清单：
1. ⌘T（Win: Ctrl+T）弹出目录选择 → 确认后新 tab 出现、侧栏多一项、终端自动跑起 shell（mac 数秒后自动进入 claude）。
2. 开两个会话，⌘2 / ⌘1 切换，切回后 scrollback 保留（`seq 100` 后切换验证）。
3. ⌘W 关当前会话，焦点落到相邻 tab；侧栏 ✕ 同效。
4. 双击侧栏条目可重命名；右键菜单「复制路径」剪贴板正确。
5. 中键点击 tab 关闭。
6. 拉伸窗口终端 refit 不裁字。

Run: `npm run typecheck`
Expected: 0 errors。

- [ ] **Step 7.6: Commit**

```bash
git add -A
git commit -m "feat(ui): 标签栏/会话侧栏/新会话弹窗 + ⌘T/⌘W/⌘1-9 快捷键全链路"
```

---

## Phase 3 · 定时任务

### Task 8: 文件存储层（原子写 + 损坏恢复）（TDD）

**Files:**
- Create: `src/main/store/fileStore.ts`, `src/main/store/TaskStore.ts`
- Test: `src/main/store/TaskStore.test.ts`

- [ ] **Step 8.1: 写失败测试**

`src/main/store/TaskStore.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, existsSync, readdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeAtomic, readJson, backupCorrupt } from './fileStore'
import { loadStore, saveTasks, saveHistory, trimHistory, HISTORY_CAP } from './TaskStore'
import type { RunRecord, ScheduledTask } from '@shared/types'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ad-store-')) })

const task = (over: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id: 't1', name: 'n', prompt: 'p', cwd: '/tmp', schedule: { type: 'interval', minutes: 5 },
  enabled: true, permissionMode: 'default', timeoutMinutes: 30,
  notify: { onComplete: true, onFailure: true }, createdAt: '2026-01-01T00:00:00.000Z', ...over
})

const run = (id: string, startedAt: string, over: Partial<RunRecord> = {}): RunRecord => ({
  id, taskId: 't1', startedAt, status: 'success', ...over
})

describe('fileStore', () => {
  it('writeAtomic 写入可解析 JSON 且不残留 tmp 文件', () => {
    const p = join(dir, 'a.json')
    writeAtomic(p, { x: 1 })
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual({ x: 1 })
    expect(readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([])
  })
  it('writeAtomic 自动建父目录', () => {
    const p = join(dir, 'sub', 'b.json')
    writeAtomic(p, [1, 2])
    expect(existsSync(p)).toBe(true)
  })
  it('readJson：缺失 → missing；损坏 → corrupt；正常 → ok', () => {
    expect(readJson(join(dir, 'nope.json'))).toEqual({ ok: false, reason: 'missing' })
    const p = join(dir, 'bad.json')
    writeFileSync(p, '{not json', 'utf8')
    expect(readJson(p)).toEqual({ ok: false, reason: 'corrupt' })
    writeAtomic(p, { ok: true })
    expect(readJson<{ ok: boolean }>(p)).toEqual({ ok: true, data: { ok: true } })
  })
  it('backupCorrupt 生成 .corrupt- 副本', () => {
    const p = join(dir, 'bad.json')
    writeFileSync(p, 'xxx', 'utf8')
    const bak = backupCorrupt(p)
    expect(bak && existsSync(bak)).toBe(true)
  })
})

describe('TaskStore', () => {
  it('空目录 loadStore 返回空结构', () => {
    expect(loadStore(dir)).toEqual({ tasks: [], history: [] })
  })
  it('saveTasks/loadStore 往返一致', () => {
    const tasks = [task()]
    saveTasks(dir, tasks)
    expect(loadStore(dir).tasks).toEqual(tasks)
  })
  it('saveHistory/loadStore 往返一致', () => {
    const history = [run('r1', '2026-01-02T00:00:00.000Z'), run('r2', '2026-01-01T00:00:00.000Z')]
    saveHistory(dir, history)
    expect(loadStore(dir).history).toHaveLength(2)
  })
  it('损坏的 tasks.json 被备份并返回空', () => {
    writeFileSync(join(dir, 'tasks.json'), '{{{', 'utf8')
    const st = loadStore(dir)
    expect(st.tasks).toEqual([])
    expect(readdirSync(dir).some((f) => f.startsWith('tasks.json.corrupt-'))).toBe(true)
  })
  it('trimHistory 保留最新 HISTORY_CAP 条（按 startedAt 倒序）', () => {
    const many: RunRecord[] = Array.from({ length: HISTORY_CAP + 30 }, (_, i) =>
      run(`r${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString())
    )
    const trimmed = trimHistory(many)
    expect(trimmed).toHaveLength(HISTORY_CAP)
    expect(trimmed[0].id).toBe(`r${HISTORY_CAP + 29}`)
    expect(trimmed.at(-1)!.id).toBe('r30')
  })
})
```

Run: `npx vitest run src/main/store/TaskStore.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 8.2: 实现 fileStore.ts 与 TaskStore.ts**

`src/main/store/fileStore.ts`：

```ts
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'

export function writeAtomic(filePath: string, data: unknown): void {
  const tmp = join2(dirname(filePath), `.${basename(filePath)}.tmp-${process.pid}-${Date.now()}`)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, filePath)
}

// 避免与 node:path.join 命名冲突的本地 join
function join2(dir: string, name: string): string {
  return dir.endsWith('/') || dir.endsWith('\\') ? dir + name : `${dir}/${name}`
}

export type ReadJsonResult<T> = { ok: true; data: T } | { ok: false; reason: 'missing' | 'corrupt' }

export function readJson<T>(filePath: string): ReadJsonResult<T> {
  if (!existsSync(filePath)) return { ok: false, reason: 'missing' }
  try {
    return { ok: true, data: JSON.parse(readFileSync(filePath, 'utf8')) as T }
  } catch {
    return { ok: false, reason: 'corrupt' }
  }
}

export function backupCorrupt(filePath: string): string | null {
  if (!existsSync(filePath)) return null
  const bak = `${filePath}.corrupt-${Date.now()}`
  copyFileSync(filePath, bak)
  return bak
}
```

`src/main/store/TaskStore.ts`：

```ts
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { RunRecord, ScheduledTask } from '@shared/types'
import { backupCorrupt, readJson, writeAtomic } from './fileStore'

export interface StoreData {
  tasks: ScheduledTask[]
  history: RunRecord[]
}

export const HISTORY_CAP = 200

export function loadStore(storeDir: string): StoreData {
  const tasksR = readJson<ScheduledTask[]>(join(storeDir, 'tasks.json'))
  if (!tasksR.ok && tasksR.reason === 'corrupt') {
    const bak = backupCorrupt(join(storeDir, 'tasks.json'))
    console.warn(`[store] tasks.json corrupted, backed up to ${bak}`)
  }
  const historyR = readJson<RunRecord[]>(join(storeDir, 'history.json'))
  if (!historyR.ok && historyR.reason === 'corrupt') {
    const bak = backupCorrupt(join(storeDir, 'history.json'))
    console.warn(`[store] history.json corrupted, backed up to ${bak}`)
  }
  return {
    tasks: tasksR.ok && Array.isArray(tasksR.data) ? tasksR.data : [],
    history: historyR.ok && Array.isArray(historyR.data) ? trimHistory(historyR.data) : []
  }
}

export function saveTasks(storeDir: string, tasks: ScheduledTask[]): void {
  writeAtomic(join(storeDir, 'tasks.json'), tasks)
}

export function saveHistory(storeDir: string, history: RunRecord[]): void {
  writeAtomic(join(storeDir, 'history.json'), trimHistory(history))
}

export function trimHistory(history: RunRecord[], cap = HISTORY_CAP): RunRecord[] {
  return [...history].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, cap)
}

export function newId(): string {
  return randomUUID()
}
```

- [ ] **Step 8.3: 运行测试确认通过**

Run: `npx vitest run src/main/store/TaskStore.test.ts`
Expected: 9 passed。

- [ ] **Step 8.4: Commit**

```bash
git add src/main/store
git commit -m "feat(store): JSON 原子写 + 损坏备份恢复 + 历史 cap 200"
```

---

### Task 9: 调度计算（cron / interval / once）（TDD）

**Files:**
- Create: `src/main/tasks/schedule.ts`, `src/shared/scheduleCheck.ts`
- Test: `src/main/tasks/schedule.test.ts`

- [ ] **Step 9.1: 写失败测试**

`src/main/tasks/schedule.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { nextRunOf, isDue } from './schedule'
import { isValidCronExpr } from '@shared/scheduleCheck'

const T = (s: string) => new Date(s)

describe('nextRunOf', () => {
  it('cron */30：10:07 → 10:30，10:31 → 11:00', () => {
    expect(nextRunOf({ type: 'cron', expr: '*/30 * * * *' }, T('2026-01-15T10:07:00'))).toEqual(T('2026-01-15T10:30:00'))
    expect(nextRunOf({ type: 'cron', expr: '*/30 * * * *' }, T('2026-01-15T10:31:00'))).toEqual(T('2026-01-15T11:00:00'))
  })
  it('cron 每日 08:30：当天已过 → 明天', () => {
    expect(nextRunOf({ type: 'cron', expr: '30 8 * * *' }, T('2026-01-15T09:00:00'))).toEqual(T('2026-01-16T08:30:00'))
  })
  it('interval 15 分钟', () => {
    expect(nextRunOf({ type: 'interval', minutes: 15 }, T('2026-01-15T10:00:00'))).toEqual(T('2026-01-15T10:15:00'))
  })
  it('once 返回其自身时间（无论过去与否，由 isDue 判定）', () => {
    expect(nextRunOf({ type: 'once', at: '2026-01-15T08:00:00' }, T('2026-01-15T09:00:00'))).toEqual(T('2026-01-15T08:00:00'))
  })
})

describe('isDue', () => {
  it('undefined → false', () => expect(isDue(undefined, new Date())).toBe(false))
  it('到点 → true；未到 → false', () => {
    expect(isDue('2026-01-15T10:00:00', T('2026-01-15T10:00:00'))).toBe(true)
    expect(isDue('2026-01-15T10:00:01', T('2026-01-15T10:00:00'))).toBe(false)
  })
})

describe('isValidCronExpr', () => {
  it('5 段且合法 → true', () => expect(isValidCronExpr('*/30 * * * *')).toBe(true))
  it('非 5 段 → false', () => expect(isValidCronExpr('* * * *')).toBe(false))
  it('5 段但非法 → false', () => expect(isValidCronExpr('99 * * * *')).toBe(false))
})
```

Run: `npx vitest run src/main/tasks/schedule.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 9.2: 实现**

`src/shared/scheduleCheck.ts`（主/渲染两侧共用，cron-parser 是同构纯库）：

```ts
import { CronExpressionParser } from 'cron-parser'

/** 5 段标准 cron 校验（渲染端表单与主端创建共用同一规则） */
export function isValidCronExpr(expr: string): boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  try {
    CronExpressionParser.parse(expr)
    return true
  } catch {
    return false
  }
}
```

`src/main/tasks/schedule.ts`：

```ts
import { CronExpressionParser } from 'cron-parser'
import type { Schedule } from '@shared/types'

/** 计算下一次触发时间（本地时区语义） */
export function nextRunOf(schedule: Schedule, from: Date): Date | null {
  switch (schedule.type) {
    case 'cron':
      return CronExpressionParser.parse(schedule.expr, { currentDate: from }).next().toDate()
    case 'interval':
      return new Date(from.getTime() + schedule.minutes * 60_000)
    case 'once':
      return new Date(schedule.at)
  }
}

export function isDue(nextRunAt: string | undefined, now: Date): boolean {
  if (!nextRunAt) return false
  return new Date(nextRunAt).getTime() <= now.getTime()
}
```

注意：测试时间串不带 Z（如 `2026-01-15T10:07:00`）以本地时区解析，与 cron 本地时区语义一致。

- [ ] **Step 9.3: 运行测试确认通过**

Run: `npx vitest run src/main/tasks/schedule.test.ts`
Expected: 9 passed。

- [ ] **Step 9.4: Commit**

```bash
git add src/main/tasks/schedule.ts src/main/tasks/schedule.test.ts src/shared/scheduleCheck.ts
git commit -m "feat(tasks): nextRunAt 计算（cron-parser 5 段本地时区）+ cron 校验共享模块"
```

---

### Task 10: stream-json 解析（TDD）

**Files:**
- Create: `src/main/tasks/streamJson.ts`
- Test: `src/main/tasks/streamJson.test.ts`

- [ ] **Step 10.1: 写失败测试**

`src/main/tasks/streamJson.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { parseStreamLine, extractResultText, toTranscriptItems } from './streamJson'

const LINES = [
  '{"type":"system","subtype":"init","model":"claude-sonnet-5"}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"先看看文件"}]}}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/a"}}]}}',
  '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"file body"}]}}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"最终答案 A"},{"type":"text","text":"续"}]}}',
  '{"type":"result","subtype":"success","result":"最终答案 A\\n续","is_error":false}'
]

describe('parseStreamLine', () => {
  it('合法 JSON 且有 type 字段 → 解析返回', () => {
    const ev = parseStreamLine(LINES[0])
    expect(ev?.type).toBe('system')
  })
  it('空行/非 JSON/非对象/无 type → null', () => {
    expect(parseStreamLine('')).toBeNull()
    expect(parseStreamLine('   ')).toBeNull()
    expect(parseStreamLine('not json')).toBeNull()
    expect(parseStreamLine('[1,2]')).toBeNull()
    expect(parseStreamLine('42')).toBeNull()
    expect(parseStreamLine('{"foo":1}')).toBeNull()
  })
})

describe('extractResultText', () => {
  it('优先取最后一条 assistant 的全部 text 块（拼接）', () => {
    const events = LINES.map((l) => parseStreamLine(l)!).filter(Boolean)
    expect(extractResultText(events)).toBe('最终答案 A\n续')
  })
  it('无 assistant 文本时回退 result.result', () => {
    const events = [parseStreamLine(LINES[0])!, parseStreamLine(LINES[5])!]
    expect(extractResultText(events)).toBe('最终答案 A\n续')
  })
  it('两者皆无 → undefined', () => {
    expect(extractResultText([parseStreamLine(LINES[0])!])).toBeUndefined()
  })
})

describe('toTranscriptItems', () => {
  it('text/tool/result 三种条目；tool_result/system 跳过', () => {
    const events = LINES.map((l) => parseStreamLine(l)!).filter(Boolean)
    const items = toTranscriptItems(events)
    expect(items).toEqual([
      { kind: 'text', text: '先看看文件' },
      { kind: 'tool', name: 'Read', input: '{"file_path":"/a"}' },
      { kind: 'text', text: '最终答案 A' },
      { kind: 'text', text: '续' },
      { kind: 'result', text: '最终答案 A\n续', isError: false }
    ])
  })
  it('result is_error=true 标记错误', () => {
    const ev = parseStreamLine('{"type":"result","subtype":"error_during_execution","result":"boom","is_error":true}')!
    expect(toTranscriptItems([ev])[0]).toMatchObject({ kind: 'result', isError: true })
  })
})
```

Run: `npx vitest run src/main/tasks/streamJson.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 10.2: 实现 streamJson.ts**

`src/main/tasks/streamJson.ts`：

```ts
import type { StreamEvent, TranscriptItem } from '@shared/types'

export function parseStreamLine(line: string): StreamEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const value: unknown = JSON.parse(trimmed)
    if (typeof value === 'object' && value !== null && 'type' in value) {
      return value as StreamEvent
    }
    return null
  } catch {
    return null
  }
}

/** 提取任务结果文本：优先最后一条 assistant 的 text 块拼接，回退 result.result */
export function extractResultText(events: StreamEvent[]): string | undefined {
  let lastAssistant: string | undefined
  let resultText: string | undefined
  for (const ev of events) {
    if (ev.type === 'assistant') {
      const content = (ev as { message?: { content?: unknown[] } }).message?.content
      if (Array.isArray(content)) {
        const texts = content
          .filter((c): c is { type: string; text: string } =>
            typeof c === 'object' && c !== null && (c as { type?: string }).type === 'text' && typeof (c as { text?: unknown }).text === 'string')
          .map((c) => c.text)
        if (texts.length > 0) lastAssistant = texts.join('\n')
      }
    } else if (ev.type === 'result') {
      const r = ev as { result?: unknown }
      if (typeof r.result === 'string') resultText = r.result
    }
  }
  return lastAssistant ?? resultText
}

export type { TranscriptItem }

/** stream-json → 回放用条目（TranscriptView 消费） */
export function toTranscriptItems(events: StreamEvent[]): TranscriptItem[] {
  const items: TranscriptItem[] = []
  for (const ev of events) {
    if (ev.type === 'assistant') {
      const content = (ev as { message?: { content?: unknown[] } }).message?.content
      if (Array.isArray(content)) {
        for (const c of content) {
          const block = c as { type?: string; text?: unknown; name?: unknown; input?: unknown }
          if (block.type === 'text' && typeof block.text === 'string') {
            items.push({ kind: 'text', text: block.text })
          } else if (block.type === 'tool_use') {
            items.push({
              kind: 'tool',
              name: String(block.name ?? ''),
              input: block.input === undefined ? undefined : JSON.stringify(block.input).slice(0, 200)
            })
          }
        }
      }
    } else if (ev.type === 'result') {
      const r = ev as { result?: unknown; is_error?: unknown }
      items.push({ kind: 'result', text: typeof r.result === 'string' ? r.result : '', isError: r.is_error === true })
    }
  }
  return items
}
```

- [ ] **Step 10.3: 运行测试确认通过**

Run: `npx vitest run src/main/tasks/streamJson.test.ts`
Expected: 7 passed。

- [ ] **Step 10.4: Commit**

```bash
git add src/main/tasks/streamJson.ts src/main/tasks/streamJson.test.ts
git commit -m "feat(tasks): stream-json 行解析、结果文本提取、回放条目转换"
```

---

### Task 11: TaskRunner（headless 执行，假 CLI 集成测试）

**Files:**
- Create: `src/main/tasks/TaskRunner.ts`, `tests/fixtures/fake-claude.sh`, `tests/integration/taskRunner.test.ts`

- [ ] **Step 11.1: 写假 CLI fixture**

`tests/fixtures/fake-claude.sh`（行为由环境变量控制）：

```bash
#!/usr/bin/env bash
# 假 claude CLI：输出预置 stream-json 行。
# 控制变量：NO_OUT=1 不输出；SLOW_SEC=n 输出前睡 n 秒；EXIT_CODE=n 退出码（默认 0）
if [ "${NO_OUT:-0}" != "1" ]; then
  echo '{"type":"system","subtype":"init","model":"fake"}'
  echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"fake answer"}]}}'
  echo '{"type":"result","subtype":"success","result":"fake answer","is_error":false}'
fi
if [ -n "${SLOW_SEC:-}" ]; then sleep "$SLOW_SEC"; fi
exit "${EXIT_CODE:-0}"
```

- [ ] **Step 11.2: 写集成测试**

`tests/integration/taskRunner.test.ts`：

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { chmodSync, existsSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startRun, type RunContext } from '@main/tasks/TaskRunner'
import type { ScheduledTask } from '@shared/types'

const FIXTURE = join(__dirname, '../fixtures/fake-claude.sh')

beforeAll(() => chmodSync(FIXTURE, 0o755))

const task = (over: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id: 't1', name: 'n', prompt: 'do it', cwd: tmpdir(),
  schedule: { type: 'interval', minutes: 5 }, enabled: true,
  permissionMode: 'default', timeoutMinutes: 30,
  notify: { onComplete: true, onFailure: true }, createdAt: '2026-01-01T00:00:00.000Z', ...over
})

// 注意：辅助函数不能叫 ctx——`const { ctx } = ctx()` 是 TDZ ReferenceError
function makeCtx(env: NodeJS.ProcessEnv = {}): { ctx: RunContext; runsDir: string } {
  const runsDir = mkdtempSync(join(tmpdir(), 'ad-runs-'))
  return { ctx: { claudePath: FIXTURE, env: { ...process.env, ...env }, runsDir }, runsDir }
}

describe('TaskRunner（真实 spawn 假 CLI）', () => {
  it('成功：status=success、exitCode=0、resultText、transcript 落盘', async () => {
    const { ctx, runsDir } = makeCtx()
    const handle = startRun(task(), ctx)
    const rec = await handle.promise
    expect(rec.status).toBe('success')
    expect(rec.exitCode).toBe(0)
    expect(rec.resultText).toBe('fake answer')
    expect(rec.transcriptPath).toBeDefined()
    expect(existsSync(rec.transcriptPath!)).toBe(true)
    expect(rec.transcriptPath!.startsWith(runsDir)).toBe(true)
    const lines = readFileSync(rec.transcriptPath!, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(JSON.parse(lines[0]).type).toBe('system')
  })

  it('失败：EXIT_CODE=1 → status=failed', async () => {
    const { ctx } = makeCtx({ EXIT_CODE: '1' })
    const rec = await startRun(task(), ctx).promise
    expect(rec.status).toBe('failed')
    expect(rec.exitCode).toBe(1)
  })

  it('超时：timeoutMs 后杀进程 → failed + error 含 timeout', async () => {
    const { ctx } = makeCtx({ SLOW_SEC: '3' })
    const handle = startRun(task({ timeoutMinutes: 30 }), ctx, { timeoutMs: 300 })
    const rec = await handle.promise
    expect(rec.status).toBe('failed')
    expect(rec.error).toContain('timeout')
  })

  it('spawn 失败（不存在的 claudePath）→ failed + error', async () => {
    const { ctx } = makeCtx()
    const rec = await startRun(task(), { ...ctx, claudePath: '/nonexistent/claude' }, {}).promise
    expect(rec.status).toBe('failed')
    expect(rec.error).toBeTruthy()
  })
})
```

**注意**：`@main` 别名需加入 vitest.config.ts 与两个 tsconfig——

`vitest.config.ts` 的 `resolve.alias` 增加一项：

```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: { include: ['src/**/*.test.ts', 'tests/**/*.test.ts'], testTimeout: 20000 }
})
```

`tsconfig.node.json` / `tsconfig.web.json` 的 `paths` 各增加 `"@main/*": ["./src/main/*"]`；**同时** `tsconfig.node.json` 的 `include` 增加 `"tests/**/*"`（否则 tests/ 下的集成测试从不被 typecheck——T1 质量评审发现的计划缺口）。

Run: `npx vitest run tests/integration/taskRunner.test.ts`
Expected: FAIL — `Cannot find module '@main/tasks/TaskRunner'`。

- [ ] **Step 11.3: 实现 TaskRunner.ts**

`src/main/tasks/TaskRunner.ts`：

```ts
import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { RunRecord, ScheduledTask, StreamEvent } from '@shared/types'
import { extractResultText, parseStreamLine } from './streamJson'
import { newId } from '../store/TaskStore'

export interface RunContext {
  claudePath: string
  env: NodeJS.ProcessEnv
  runsDir: string
}

export interface RunHandle {
  runId: string
  promise: Promise<RunRecord>
  kill(): void
}

export type SpawnFn = typeof spawn

export interface RunOpts {
  spawnFn?: SpawnFn
  /** 测试用：毫秒级超时覆盖 task.timeoutMinutes */
  timeoutMs?: number
}

/** headless 执行一个任务：spawn claude -p、transcript 落盘、超时杀进程 */
export function startRun(task: ScheduledTask, ctx: RunContext, opts: RunOpts = {}): RunHandle {
  const spawnFn = opts.spawnFn ?? spawn
  const runId = newId()
  const startedAt = new Date().toISOString()
  const events: StreamEvent[] = []
  let finished = false
  let timedOut = false

  const dir = join(ctx.runsDir, task.id)
  mkdirSync(dir, { recursive: true })
  const transcriptPath = join(dir, `${runId}.jsonl`)
  const out = createWriteStream(transcriptPath, { encoding: 'utf8', flags: 'w' })
  let buffer = ''

  const args = [
    '-p', task.prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', task.permissionMode
  ]
  if (task.model) args.push('--model', task.model)

  const child: ChildProcess = spawnFn(ctx.claudePath, args, { cwd: task.cwd, env: ctx.env })
  const timeoutMs = opts.timeoutMs ?? Math.max(1, task.timeoutMinutes) * 60_000

  const promise = new Promise<RunRecord>((resolve) => {
    const settle = (record: RunRecord): void => {
      if (finished) return
      finished = true
      if (timer) clearTimeout(timer)
      out.end(() => resolve(record))
    }

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      out.write(chunk)
      buffer += chunk
      let idx: number
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        const ev = parseStreamLine(line)
        if (ev) events.push(ev)
      }
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => out.write(chunk))

    child.on('error', (err) => {
      settle({
        id: runId, taskId: task.id, startedAt, finishedAt: new Date().toISOString(),
        status: 'failed', error: err.message, transcriptPath
      })
    })

    child.on('close', (code) => {
      settle({
        id: runId, taskId: task.id, startedAt, finishedAt: new Date().toISOString(),
        status: code === 0 ? 'success' : 'failed',
        exitCode: code ?? undefined,
        resultText: extractResultText(events),
        error: timedOut ? `timeout after ${timeoutMs}ms` : undefined,
        transcriptPath
      })
    })

    const timer: NodeJS.Timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => {
        if (!finished && child.exitCode === null) child.kill('SIGKILL')
      }, 3000).unref()
    }, timeoutMs)
    timer.unref()
  })

  return { runId, promise, kill: () => child.kill('SIGTERM') }
}
```

- [ ] **Step 11.4: 运行集成测试确认通过**

Run: `npx vitest run tests/integration/taskRunner.test.ts`
Expected: 4 passed（超时用例约 0.3–3s 完成）。

- [ ] **Step 11.5: Commit**

```bash
git add src/main/tasks/TaskRunner.ts tests/ vitest.config.ts tsconfig.node.json tsconfig.web.json
git commit -m "feat(tasks): headless TaskRunner——stream-json 落盘、结果提取、超时终止（假 CLI 集成测试）"
```

---

### Task 12: TaskService 调度编排 + 主进程装配 + tasks IPC（TDD）

**Files:**
- Create: `src/main/tasks/TaskService.ts`, `src/main/tasks/TaskService.test.ts`, `src/renderer/src/stores/tasks.ts`
- Modify: `src/main/ipc.ts`（tasks 通道）、`src/preload/index.ts`（tasks API）、`src/main/index.ts`（装配 TaskService + 30s tick）

- [ ] **Step 12.1: 写失败测试（注入 fake runner）**

`src/main/tasks/TaskService.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskService, type StartRunFn, type RunContext } from './TaskService'
import type { RunRecord, ScheduledTask, TaskInput } from '@shared/types'

let storeDir: string
let runsDir: string
beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), 'ad-svc-store-'))
  runsDir = mkdtempSync(join(tmpdir(), 'ad-svc-runs-'))
})

const input = (over: Partial<TaskInput> = {}): TaskInput => ({
  name: 'demo', prompt: 'hi', cwd: '/tmp',
  schedule: { type: 'interval', minutes: 5 },
  permissionMode: 'default', ...over
})

interface Deferred { resolve: (r: Partial<RunRecord>) => void; promise: Promise<RunRecord> }
function deferred(): Deferred {
  let resolve!: (r: Partial<RunRecord>) => void
  const promise = new Promise<RunRecord>((res) => {
    resolve = (partial) => res({ id: 'run-x', taskId: '', startedAt: '', status: 'success', ...partial } as RunRecord)
  })
  return { resolve, promise }
}

function makeService(runner?: StartRunFn) {
  const notified: Array<{ rec: RunRecord; task: ScheduledTask }> = []
  const logs: string[] = []
  const changes: number[] = []
  const svc = new TaskService({
    storeDir, runsDir, claudePath: '/fake/claude', env: { PATH: '/x' },
    runner,
    log: (m) => logs.push(m),
    notify: (rec, task) => notified.push({ rec, task }),
    onChanged: () => changes.push(changes.length)
  })
  return { svc, notified, logs }
}

describe('TaskService.create/update/remove', () => {
  it('create 计算 nextRunAt = now + interval；持久化', () => {
    const { svc } = makeService()
    const now = new Date('2026-01-15T10:00:00')
    const t = svc.create(input(), now)
    expect(svc.tasks).toHaveLength(1)
    // 注意用毫秒差比较：nextRunAt 是 UTC ISO 串，测试机时区未知，禁止字符串断言
    expect(new Date(t.nextRunAt!).getTime() - now.getTime()).toBe(5 * 60_000)
  })
  it('create 非法调度抛错：坏 cron / interval<=0 / once 过去', () => {
    const { svc } = makeService()
    const now = new Date('2026-01-15T10:00:00')
    expect(() => svc.create(input({ schedule: { type: 'cron', expr: 'bad' } }), now)).toThrow()
    expect(() => svc.create(input({ schedule: { type: 'interval', minutes: 0 } }), now)).toThrow()
    expect(() => svc.create(input({ schedule: { type: 'once', at: '2026-01-15T09:00:00' } }), now)).toThrow()
  })
  it('update 改调度后重算 nextRunAt；setEnabled(false) 清空', () => {
    const { svc } = makeService()
    const now = new Date('2026-01-15T10:00:00')
    const t = svc.create(input(), now)
    svc.update(t.id, { schedule: { type: 'interval', minutes: 10 } }, new Date('2026-01-15T11:00:00'))
    expect(new Date(svc.tasks[0].nextRunAt!).getTime() - new Date('2026-01-15T11:00:00').getTime()).toBe(10 * 60_000)
    svc.setEnabled(t.id, false)
    expect(svc.tasks[0].nextRunAt).toBeUndefined()
    svc.setEnabled(t.id, true)
    expect(svc.tasks[0].nextRunAt).toBeDefined()
  })
  it('remove 删除任务', () => {
    const { svc } = makeService()
    const t = svc.create(input())
    expect(svc.remove(t.id)).toBe(true)
    expect(svc.tasks).toHaveLength(0)
  })
})

describe('TaskService.tick 触发与防抖', () => {
  it('到点触发一次：history 出现 running，runner 收到任务；nextRunAt 前进', async () => {
    const calls: ScheduledTask[] = []
    const d = deferred()
    const { svc } = makeService((t, _ctx: RunContext) => { calls.push(t); return { runId: 'run-x', promise: d.promise, kill: () => undefined } })
    const t0 = new Date('2026-01-15T10:00:00')
    const task = svc.create(input(), t0)
    ;(task as ScheduledTask).nextRunAt = '2026-01-15T10:00:00' // 强制立即到期
    const t1 = new Date('2026-01-15T10:00:01')
    svc.tick(t1)
    expect(calls).toHaveLength(1)
    expect(calls[0].id).toBe(task.id)
    expect(svc.history.some((r) => r.taskId === task.id && r.status === 'running')).toBe(true)
    expect(new Date(svc.tasks[0].nextRunAt!).getTime() - t1.getTime()).toBe(5 * 60_000)

    // 运行中第二次 tick：跳过，不重复触发
    svc.tick(new Date('2026-01-15T10:05:30'))
    expect(calls).toHaveLength(1)

    // 完成：状态合并 success + 通知
    d.resolve({ id: 'run-x', status: 'success', exitCode: 0, resultText: 'ok', finishedAt: '2026-01-15T10:06:00.000Z' })
    await vi0(d.promise)
    const rec = svc.history.find((r) => r.id === 'run-x')!
    expect(rec.status).toBe('success')
    expect(rec.resultText).toBe('ok')
  })
  it('once 任务完成后自动禁用', async () => {
    const d = deferred()
    const { svc } = makeService(() => ({ runId: 'run-y', promise: d.promise, kill: () => undefined }))
    const task = svc.create(input({ schedule: { type: 'once', at: '2026-01-15T10:01:00' } }), new Date('2026-01-15T10:00:00'))
    ;(task as ScheduledTask).nextRunAt = '2026-01-15T10:00:30'
    svc.tick(new Date('2026-01-15T10:00:31'))
    d.resolve({ id: 'run-y', status: 'success' })
    await d.promise
    await Promise.resolve()
    expect(svc.tasks[0].enabled).toBe(false)
  })
  it('runNow 可手动触发（含已禁用任务）', () => {
    const d = deferred()
    const calls: string[] = []
    const { svc } = makeService((t) => { calls.push(t.id); return { runId: 'r', promise: d.promise, kill: () => undefined } })
    const task = svc.create(input())
    svc.setEnabled(task.id, false)
    svc.runNow(task.id)
    expect(calls).toEqual([task.id])
  })
  it('claudePath=null：立即失败记录 + 通知', async () => {
    const d = deferred()
    const { svc, notified } = makeService(() => ({ runId: 'r', promise: d.promise, kill: () => undefined }))
    ;(svc as unknown as { deps: { claudePath: string | null } }).deps.claudePath = null
    const task = svc.create(input())
    svc.runNow(task.id)
    const rec = svc.history.find((r) => r.taskId === task.id)!
    expect(rec.status).toBe('failed')
    expect(rec.error).toContain('claude')
    expect(notified).toHaveLength(1)
  })
})

describe('TaskService.load（错过标记）', () => {
  it('持久化 nextRunAt 已过 → missed 记录 + 重算', () => {
    const { svc: seed } = makeService()
    const task = seed.create(input(), new Date('2026-01-15T08:00:00'))
    // 直接用 seed 的 storeDir 构造第二个 service 实例模拟重启
    const { svc } = makeService()
    svc.tasks = JSON.parse(JSON.stringify(seed.tasks)) as ScheduledTask[]
    ;(svc.tasks[0] as ScheduledTask).nextRunAt = '2026-01-15T09:00:00'
    svc.persist()
    const rebooted = new TaskService({ storeDir, runsDir, claudePath: '/fake/claude', env: {} })
    rebooted.load(new Date('2026-01-15T10:00:00'))
    const missed = rebooted.history.find((r) => r.taskId === task.id && r.status === 'missed')
    expect(missed?.startedAt).toBe('2026-01-15T09:00:00') // 原样保留持久化的时刻串
    expect(new Date(rebooted.tasks[0].nextRunAt!).getTime() - new Date('2026-01-15T10:00:00').getTime()).toBe(5 * 60_000)
  })
})

// 小工具：等一个 microtask 沉淀
async function vi0<T>(p: Promise<T>): Promise<T> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
  return p
}
```

Run: `npx vitest run src/main/tasks/TaskService.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 12.2: 实现 TaskService.ts**

`src/main/tasks/TaskService.ts`：

```ts
import { readFileSync } from 'node:fs'
import type { RunRecord, ScheduledTask, StreamEvent, TaskInput } from '@shared/types'
import { isValidCronExpr } from '@shared/scheduleCheck'
import { loadStore, newId, saveHistory, saveTasks, trimHistory } from '../store/TaskStore'
import { isDue, nextRunOf } from './schedule'
import { parseStreamLine } from './streamJson'
import { startRun, type RunContext, type RunHandle } from './TaskRunner'

export type StartRunFn = (task: ScheduledTask, ctx: RunContext) => RunHandle

export interface TaskServiceDeps {
  storeDir: string
  runsDir: string
  claudePath: string | null
  env: NodeJS.ProcessEnv
  runner?: StartRunFn
  log?: (msg: string) => void
  notify?: (rec: RunRecord, task: ScheduledTask) => void
  onChanged?: (tasks: ScheduledTask[], history: RunRecord[]) => void
}

function validateInput(input: TaskInput, now: Date): void {
  if (!input.name.trim() || !input.prompt.trim() || !input.cwd.trim()) {
    throw new Error('name/prompt/cwd required')
  }
  const s = input.schedule
  if (s.type === 'cron' && !isValidCronExpr(s.expr)) throw new Error('invalid cron expression')
  if (s.type === 'interval' && !(s.minutes > 0)) throw new Error('interval must be positive')
  if (s.type === 'once' && new Date(s.at).getTime() <= now.getTime()) throw new Error('once schedule must be in the future')
}

export class TaskService {
  tasks: ScheduledTask[] = []
  history: RunRecord[] = []
  private active = new Map<string, RunHandle>()

  constructor(public readonly deps: TaskServiceDeps) {}

  private get runner(): StartRunFn {
    return this.deps.runner ?? ((t, c) => startRun(t, c))
  }

  private log(msg: string): void {
    ;(this.deps.log ?? console.log)(msg)
  }

  private emit(): void {
    this.deps.onChanged?.(this.tasks, this.history)
  }

  persist(): void {
    saveTasks(this.deps.storeDir, this.tasks)
    saveHistory(this.deps.storeDir, this.history)
  }

  load(now: Date = new Date()): void {
    const data = loadStore(this.deps.storeDir)
    this.tasks = data.tasks
    this.history = data.history
    for (const t of this.tasks) {
      if (t.enabled && isDue(t.nextRunAt, now)) {
        this.history.push({
          id: newId(),
          taskId: t.id,
          startedAt: t.nextRunAt!,
          finishedAt: now.toISOString(),
          status: 'missed'
        })
      }
      t.nextRunAt = t.enabled ? this.nextOf(t, now) : undefined  // nextOf 已返回 ISO 字符串
    }
    this.history = trimHistory(this.history)
    this.persist()
    this.emit()
  }

  private nextOf(t: ScheduledTask, from: Date): string | undefined {
    const d = nextRunOf(t.schedule, from)
    return d?.toISOString()
  }

  tick(now: Date = new Date()): void {
    let changed = false
    for (const t of this.tasks) {
      if (!t.enabled) continue
      if (isDue(t.nextRunAt, now)) {
        if (this.active.has(t.id)) {
          this.log(`[tasks] skip "${t.name}": previous run still active`)
          t.nextRunAt = this.nextOf(t, now)
          changed = true
          continue
        }
        this.fire(t, now)
        changed = true
      } else if (!t.nextRunAt) {
        t.nextRunAt = this.nextOf(t, now)
        changed = true
      }
    }
    if (changed) {
      saveTasks(this.deps.storeDir, this.tasks)
      this.emit()
    }
  }

  private fire(t: ScheduledTask, now: Date): void {
    // 先拿 runner handle，让记录 id 对齐 runId（与 transcript 文件名 ${runId}.jsonl 一致）
    if (!this.deps.claudePath) {
      const failed: RunRecord = {
        id: newId(), taskId: t.id, startedAt: now.toISOString(), status: 'running'
      }
      this.history = trimHistory([failed, ...this.history])
      t.nextRunAt = this.nextOf(t, now)
      this.finishRun(t, failed, {
        status: 'failed',
        error: 'claude executable not found',
        finishedAt: new Date().toISOString()
      })
      return
    }
    const ctx: RunContext = {
      claudePath: this.deps.claudePath,
      env: this.deps.env,
      runsDir: this.deps.runsDir
    }
    const handle = this.runner(t, ctx)
    const running: RunRecord = {
      id: handle.runId,
      taskId: t.id,
      startedAt: now.toISOString(),
      status: 'running'
    }
    this.history = trimHistory([running, ...this.history])
    saveHistory(this.deps.storeDir, this.history)
    this.emit()

    t.nextRunAt = this.nextOf(t, now)
    this.active.set(t.id, handle)
    void handle.promise.then((final) => {
      this.active.delete(t.id)
      this.finishRun(t, running, final)
    })
  }

  private finishRun(t: ScheduledTask, running: RunRecord, final: Partial<RunRecord>): void {
    const merged: RunRecord = { ...running, ...final, id: running.id, taskId: t.id }
    this.history = trimHistory(this.history.map((r) => (r.id === running.id ? merged : r)))
    saveHistory(this.deps.storeDir, this.history)
    if (t.schedule.type === 'once') {
      t.enabled = false
      t.nextRunAt = undefined
    }
    saveTasks(this.deps.storeDir, this.tasks)
    this.deps.notify?.(merged, t)
    this.emit()
  }

  runNow(taskId: string, now: Date = new Date()): void {
    const t = this.tasks.find((x) => x.id === taskId)
    if (!t || this.active.has(t.id)) return
    this.fire(t, now)
    saveTasks(this.deps.storeDir, this.tasks)
    this.emit()
  }

  create(input: TaskInput, now: Date = new Date()): ScheduledTask {
    validateInput(input, now)
    const task: ScheduledTask = {
      id: newId(),
      name: input.name.trim(),
      prompt: input.prompt.trim(),
      cwd: input.cwd,
      schedule: input.schedule,
      enabled: true,
      permissionMode: input.permissionMode,
      model: input.model || undefined,
      timeoutMinutes: input.timeoutMinutes ?? 30,
      notify: {
        onComplete: input.notify?.onComplete ?? true,
        onFailure: input.notify?.onFailure ?? true
      },
      createdAt: now.toISOString(),
      nextRunAt: undefined
    }
    task.nextRunAt = this.nextOf(task, now)
    this.tasks.push(task)
    this.persist()
    this.emit()
    return task
  }

  update(id: string, patch: Partial<TaskInput> & { enabled?: boolean }, now: Date = new Date()): ScheduledTask | undefined {
    const t = this.tasks.find((x) => x.id === id)
    if (!t) return undefined
    const merged: TaskInput = {
      name: patch.name ?? t.name,
      prompt: patch.prompt ?? t.prompt,
      cwd: patch.cwd ?? t.cwd,
      schedule: patch.schedule ?? t.schedule,
      permissionMode: patch.permissionMode ?? t.permissionMode,
      model: patch.model ?? t.model,
      timeoutMinutes: patch.timeoutMinutes ?? t.timeoutMinutes,
      notify: {
        onComplete: patch.notify?.onComplete ?? t.notify.onComplete,
        onFailure: patch.notify?.onFailure ?? t.notify.onFailure
      }
    }
    validateInput(merged, now)
    Object.assign(t, {
      ...merged,
      model: merged.model || undefined,
      notify: { onComplete: merged.notify.onComplete, onFailure: merged.notify.onFailure }
    })
    if (patch.enabled !== undefined) t.enabled = patch.enabled
    t.nextRunAt = t.enabled ? this.nextOf(t, now) : undefined
    this.persist()
    this.emit()
    return t
  }

  remove(id: string): boolean {
    const before = this.tasks.length
    this.tasks = this.tasks.filter((t) => t.id !== id)
    if (this.tasks.length === before) return false
    this.persist()
    this.emit()
    return true
  }

  setEnabled(id: string, enabled: boolean, now: Date = new Date()): void {
    const t = this.tasks.find((x) => x.id === id)
    if (!t) return
    t.enabled = enabled
    t.nextRunAt = enabled ? this.nextOf(t, now) : undefined
    this.persist()
    this.emit()
  }

  isRunning(taskId: string): boolean {
    return this.active.has(taskId)
  }

  historyOf(taskId?: string): RunRecord[] {
    return taskId ? this.history.filter((r) => r.taskId === taskId) : this.history
  }

  readTranscript(rec: RunRecord): StreamEvent[] {
    if (!rec.transcriptPath) return []
    try {
      return readFileSync(rec.transcriptPath, 'utf8')
        .split('\n')
        .map((l) => parseStreamLine(l))
        .filter((ev): ev is StreamEvent => ev !== null)
    } catch {
      return []
    }
  }
}
```

Run: `npx vitest run src/main/tasks/TaskService.test.ts`
Expected: 全部 passed（约 10 个用例）。

- [ ] **Step 12.3: ipc.ts 追加 tasks 通道**

`src/main/ipc.ts`：`IpcDeps` 接口追加字段 `tasks: TaskService`，`CHANNELS` 追加 `tasksChanged: 'tasks:changed'`，`registerIpc` 追加：

```ts
import type { TaskService } from './tasks/TaskService'
import type { RunRecord, ScheduledTask, TaskInput } from '@shared/types'
import { toTranscriptItems } from './tasks/streamJson'

// IpcDeps 增加： tasks: TaskService

  ipcMain.handle('tasks:list', () => deps.tasks.tasks)
  ipcMain.handle('tasks:history', (_e, taskId?: string) => deps.tasks.historyOf(taskId))
  ipcMain.handle('tasks:create', (_e, input: TaskInput) => deps.tasks.create(input))
  ipcMain.handle('tasks:update', (_e, id: string, patch: Parameters<TaskService['update']>[1]) =>
    deps.tasks.update(id, patch)
  )
  ipcMain.handle('tasks:remove', (_e, id: string) => deps.tasks.remove(id))
  ipcMain.handle('tasks:setEnabled', (_e, id: string, enabled: boolean) => deps.tasks.setEnabled(id, enabled))
  ipcMain.handle('tasks:runNow', (_e, id: string) => deps.tasks.runNow(id))
  ipcMain.handle('tasks:transcript', (_e, rec: RunRecord) => toTranscriptItems(deps.tasks.readTranscript(rec)))
```

`push` 辅助已在 Task 5 定义；TaskService 的 `onChanged` 在装配层（Step 12.5）接到 `push(getWindow(), CHANNELS.tasksChanged, { tasks, history })`。

- [ ] **Step 12.4: preload 追加 tasks API**

`src/preload/index.ts` 的 `api` 对象追加（`import type { RunRecord, ScheduledTask, TaskInput, TranscriptItem } from '@shared/types'`）：

```ts
  tasks: {
    list: (): Promise<ScheduledTask[]> => ipcRenderer.invoke('tasks:list'),
    history: (taskId?: string): Promise<RunRecord[]> => ipcRenderer.invoke('tasks:history', taskId),
    create: (input: TaskInput): Promise<ScheduledTask> => ipcRenderer.invoke('tasks:create', input),
    update: (id: string, patch: Partial<TaskInput> & { enabled?: boolean }): Promise<ScheduledTask | undefined> =>
      ipcRenderer.invoke('tasks:update', id, patch),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke('tasks:remove', id),
    setEnabled: (id: string, enabled: boolean): Promise<void> => ipcRenderer.invoke('tasks:setEnabled', id, enabled),
    runNow: (id: string): Promise<void> => ipcRenderer.invoke('tasks:runNow', id),
    transcript: (rec: RunRecord): Promise<TranscriptItem[]> => ipcRenderer.invoke('tasks:transcript', rec)
  },
  onTasksChanged: (cb: (payload: { tasks: ScheduledTask[]; history: RunRecord[] }) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: { tasks: ScheduledTask[]; history: RunRecord[] }) => cb(payload)
    ipcRenderer.on('tasks:changed', listener)
    return () => ipcRenderer.removeListener('tasks:changed', listener)
  },
```

- [ ] **Step 12.5: 主进程装配（store/runs 目录 + load + 30s tick + onChanged 推送）**

`src/main/index.ts` 的 `whenReady` 回调中，`TaskService` 相关装配（放在 `registerIpc` 之前）：

```ts
import { app } from 'electron' // 追加到既有 import
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { TaskService } from './tasks/TaskService'

  // userData 下的持久化目录
  const storeDir = join(app.getPath('userData'), 'store')
  const runsDir = join(app.getPath('userData'), 'runs')
  mkdirSync(storeDir, { recursive: true })
  mkdirSync(runsDir, { recursive: true })

  const taskService = new TaskService({
    storeDir,
    runsDir,
    claudePath,
    env,
    log: (m) => console.log(m),
    onChanged: (tasks, history) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tasks:changed', { tasks, history })
      }
    }
    // notify 在 Task 15 接入系统通知
  })
  taskService.load()
  const schedulerTimer = setInterval(() => taskService.tick(), 30_000)
  schedulerTimer.unref()

  // registerIpc 的 deps 增加 tasks: taskService
```

- [ ] **Step 12.6: 渲染端 tasks store**

`src/renderer/src/stores/tasks.ts`：

```ts
import { create } from 'zustand'
import type { RunRecord, ScheduledTask } from '@shared/types'

interface TaskState {
  tasks: ScheduledTask[]
  history: RunRecord[]
  hydrate: () => Promise<void>
  refreshFromPush: (tasks: ScheduledTask[], history: RunRecord[]) => void
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  runNow: (id: string) => Promise<void>
  create: (input: Parameters<Window['api']['tasks']['create']>[0]) => Promise<ScheduledTask | null>
  update: (id: string, patch: Partial<Parameters<Window['api']['tasks']['update']>[1]>) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useTaskStore = create<TaskState>()((set) => ({
  tasks: [],
  history: [],
  hydrate: async () => {
    const [tasks, history] = await Promise.all([window.api.tasks.list(), window.api.tasks.history()])
    set({ tasks, history })
  },
  refreshFromPush: (tasks, history) => set({ tasks, history }),
  setEnabled: async (id, enabled) => {
    await window.api.tasks.setEnabled(id, enabled)
  },
  runNow: async (id) => {
    await window.api.tasks.runNow(id)
  },
  create: async (input) => {
    try {
      return await window.api.tasks.create(input)
    } catch (e) {
      console.error('create task failed', e)
      return null
    }
  },
  update: async (id, patch) => {
    await window.api.tasks.update(id, patch)
  },
  remove: async (id) => {
    await window.api.tasks.remove(id)
  }
}))

export const selectRunningCount = (s: TaskState): number =>
  s.history.filter((r) => r.status === 'running').length

export const selectNextTask = (s: TaskState): ScheduledTask | null => {
  const due = s.tasks
    .filter((t) => t.enabled && t.nextRunAt)
    .sort((a, b) => a.nextRunAt!.localeCompare(b.nextRunAt!))
  return due[0] ?? null
}
```

App.tsx 追加订阅（放在 hydrate 的 useEffect 里）：

```ts
  const hydrateTasks = useTaskStore((s) => s.hydrate)
  const refreshFromPush = useTaskStore((s) => s.refreshFromPush)
  useEffect(() => {
    void hydrateTasks()
    const off = window.api.onTasksChanged((p) => refreshFromPush(p.tasks, p.history))
    return off
  }, [hydrateTasks, refreshFromPush])
```

TitleBar 的 `tasksRunning` 换成 `selectRunningCount(useTaskStore.getState())` 订阅：在 App.tsx 用 `const tasksRunning = useTaskStore(selectRunningCount)` 传入。

- [ ] **Step 12.7: 全量测试 + typecheck + 冒烟**

Run: `npm test`
Expected: 全部 passed。

Run: `npm run typecheck && npm run dev`
人工确认（DevTools Console）：

```js
const t = await window.api.tasks.create({ name: 'smoke', prompt: 'say hi', cwd: '/tmp', schedule: { type: 'interval', minutes: 5 }, permissionMode: 'default' })
await window.api.tasks.runNow(t.id)
const h = await window.api.tasks.history(t.id)
console.log(h) // 约 10–60s 后出现 success 记录（真实 claude 执行）
await window.api.tasks.remove(t.id)
```

- [ ] **Step 12.8: Commit**

```bash
git add -A
git commit -m "feat(tasks): TaskService 调度编排（tick/防抖/missed/once 收尾）+ tasks IPC + 渲染端 store，真实 claude 冒烟通过"
```

---

### Task 13: 任务抽屉 UI（列表 / 表单 / 详情）+ 表单校验（TDD）

**Files:**
- Create: `src/renderer/src/lib/taskForm.ts`, `src/renderer/src/lib/taskForm.test.ts`, `src/renderer/src/lib/format.ts`, `src/renderer/src/lib/format.test.ts`, `src/renderer/src/components/ui/Toggle.tsx`, `src/renderer/src/components/tasks/TaskDrawer.tsx`, `src/renderer/src/components/tasks/TaskForm.tsx`
- Modify: `src/renderer/src/styles/global.css`（抽屉/表单样式）、`src/renderer/src/App.tsx`（挂 TaskDrawer）

> 执行本任务前先调用 `frontend-design` skill。

- [ ] **Step 13.1: 写校验失败测试**

`src/renderer/src/lib/taskForm.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { validateTaskForm } from './taskForm'

const NOW = new Date('2026-01-15T10:00:00')
const base = {
  name: 'n', prompt: 'p', cwd: '/tmp',
  schedule: { type: 'interval', minutes: 5 } as const
}

describe('validateTaskForm（返回 i18n key）', () => {
  it('全部合法 → {}', () => {
    expect(validateTaskForm(base, NOW)).toEqual({})
  })
  it('名称/指令/目录必填', () => {
    expect(validateTaskForm({ ...base, name: '  ' }, NOW).name).toBe('tasks.vNameRequired')
    expect(validateTaskForm({ ...base, prompt: '' }, NOW).prompt).toBe('tasks.vPromptRequired')
    expect(validateTaskForm({ ...base, cwd: '' }, NOW).cwd).toBe('tasks.vCwdRequired')
  })
  it('cron 非法', () => {
    expect(validateTaskForm({ ...base, schedule: { type: 'cron', expr: 'oops' } }, NOW).schedule).toBe('tasks.vCronInvalid')
  })
  it('interval 必须 > 0', () => {
    expect(validateTaskForm({ ...base, schedule: { type: 'interval', minutes: 0 } }, NOW).schedule).toBe('tasks.vIntervalPositive')
  })
  it('once 必须在未来', () => {
    expect(validateTaskForm({ ...base, schedule: { type: 'once', at: '2026-01-15T09:00:00' } }, NOW).schedule).toBe('tasks.vOnceFuture')
    expect(validateTaskForm({ ...base, schedule: { type: 'once', at: '2026-01-16T09:00:00' } }, NOW)).toEqual({})
  })
})
```

Run: `npx vitest run src/renderer/src/lib/taskForm.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 13.2: 实现 taskForm.ts**

`src/renderer/src/lib/taskForm.ts`：

```ts
import type { Schedule } from '@shared/types'
import { isValidCronExpr } from '@shared/scheduleCheck'

export type TaskFormErrorKey =
  | 'tasks.vNameRequired' | 'tasks.vPromptRequired' | 'tasks.vCwdRequired'
  | 'tasks.vCronInvalid' | 'tasks.vIntervalPositive' | 'tasks.vOnceFuture'

export type TaskFormErrors = Partial<Record<'name' | 'prompt' | 'cwd' | 'schedule', TaskFormErrorKey>>

export function validateTaskForm(
  input: { name: string; prompt: string; cwd: string; schedule: Schedule },
  now: Date
): TaskFormErrors {
  const errors: TaskFormErrors = {}
  if (!input.name.trim()) errors.name = 'tasks.vNameRequired'
  if (!input.prompt.trim()) errors.prompt = 'tasks.vPromptRequired'
  if (!input.cwd.trim()) errors.cwd = 'tasks.vCwdRequired'
  const s = input.schedule
  if (s.type === 'cron' && !isValidCronExpr(s.expr)) errors.schedule = 'tasks.vCronInvalid'
  else if (s.type === 'interval' && !(s.minutes > 0)) errors.schedule = 'tasks.vIntervalPositive'
  else if (s.type === 'once' && new Date(s.at).getTime() <= now.getTime()) errors.schedule = 'tasks.vOnceFuture'
  return errors
}
```

Run: `npx vitest run src/renderer/src/lib/taskForm.test.ts`
Expected: 7 passed。

- [ ] **Step 13.3: 写格式化工具（含失败测试）**

`src/renderer/src/lib/format.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { formatRelative, formatDateTime, toLocalInputValue } from './format'

const NOW = new Date('2026-01-15T10:00:00')

describe('formatRelative', () => {
  it('5 分钟后（en）包含 5', () => {
    const s = formatRelative(new Date(NOW.getTime() + 5 * 60_000).toISOString(), 'en', NOW)
    expect(s).toContain('5')
  })
  it('3 小时前（en）包含 3', () => {
    const s = formatRelative(new Date(NOW.getTime() - 3 * 3_600_000).toISOString(), 'en', NOW)
    expect(s).toContain('3')
  })
  it('2 天后（en）包含 2', () => {
    const s = formatRelative(new Date(NOW.getTime() + 2 * 86_400_000).toISOString(), 'en', NOW)
    expect(s).toContain('2')
  })
})

describe('formatDateTime', () => {
  it('en 输出包含年份无关的月日', () => {
    const s = formatDateTime('2026-01-15T10:00:00', 'en')
    expect(s.toLowerCase()).toContain('jan')
  })
})

describe('toLocalInputValue', () => {
  it('转 datetime-local 需要的 YYYY-MM-DDTHH:mm', () => {
    const d = new Date(2026, 0, 15, 9, 5)
    expect(toLocalInputValue(d)).toBe('2026-01-15T09:05')
  })
})
```

`src/renderer/src/lib/format.ts`：

```ts
export function formatRelative(iso: string, locale: string, now: Date = new Date()): string {
  const diffMs = new Date(iso).getTime() - now.getTime()
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const abs = Math.abs(diffMs)
  if (abs < 60_000) return rtf.format(Math.round(diffMs / 1000), 'second')
  if (abs < 3_600_000) return rtf.format(Math.round(diffMs / 60_000), 'minute')
  if (abs < 86_400_000) return rtf.format(Math.round(diffMs / 3_600_000), 'hour')
  return rtf.format(Math.round(diffMs / 86_400_000), 'day')
}

export function formatDateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(new Date(iso))
}

/** Date → <input type="datetime-local"> 的 value 格式 */
export function toLocalInputValue(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
```

Run: `npx vitest run src/renderer/src/lib/format.test.ts`
Expected: 7 passed。

- [ ] **Step 13.4: global.css 追加抽屉 / Toggle / 状态样式**

```css
/* ===== 抽屉 ===== */
.drawer {
  position: fixed; top: 40px; right: 0; bottom: 0; width: 420px; max-width: 90vw;
  background: var(--bg-raised); border-left: 1px solid var(--border);
  box-shadow: var(--shadow); z-index: 50; display: flex; flex-direction: column;
}
.drawer-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--border); flex: none;
}
.drawer-head h2 { margin: 0; font-size: 14px; color: var(--text-strong); font-weight: 600; }
.drawer-body { flex: 1; overflow-y: auto; padding: 12px 16px; }
.drawer-foot {
  flex: none; padding: 12px 16px; border-top: 1px solid var(--border);
  display: flex; gap: 8px; justify-content: flex-end;
}

/* ===== Toggle ===== */
.toggle { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.toggle-track {
  width: 32px; height: 18px; border-radius: 9px; background: var(--border-strong);
  position: relative; transition: background .15s; flex: none;
}
.toggle-track.on { background: var(--accent); }
.toggle-thumb {
  position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
  border-radius: 50%; background: var(--bg); transition: left .15s;
}
.toggle-track.on .toggle-thumb { left: 16px; }
.toggle-label { font-size: 12.5px; color: var(--text); }

/* ===== 任务列表项 ===== */
.task-item {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px;
  cursor: pointer; width: 100%; text-align: left; background: var(--bg);
}
.task-item:hover { border-color: var(--accent); }
.task-item .meta { flex: 1; min-width: 0; }
.task-item .name { color: var(--text-strong); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-item .sub { color: var(--text-dim); font-size: 11.5px; margin-top: 2px; }

/* ===== 状态 ===== */
.status-chip { font-size: 11px; padding: 2px 8px; border-radius: 10px; white-space: nowrap; }
.status-chip.running { background: var(--warn); color: #1b1f24; }
.status-chip.success { background: var(--success); color: #ffffff; }
.status-chip.failed { background: var(--danger); color: #ffffff; }
.status-chip.missed { background: var(--text-dim); color: var(--bg); }

.kv { display: grid; grid-template-columns: 100px 1fr; gap: 6px 10px; font-size: 12.5px; }
.kv dt { color: var(--text-dim); }
.kv dd { margin: 0; color: var(--text-strong); word-break: break-all; }

.risk-note {
  background: var(--accent-soft); border: 1px solid var(--warn);
  color: var(--text); border-radius: 6px; padding: 8px 10px; font-size: 12px; margin-bottom: 12px;
}
```

- [ ] **Step 13.5: 写 Toggle 与 TaskForm**

`src/renderer/src/components/ui/Toggle.tsx`：

```tsx
interface Props {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
}

export function Toggle({ checked, onChange, label }: Props) {
  return (
    <span className="toggle" onClick={() => onChange(!checked)} role="switch" aria-checked={checked} tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onChange(!checked) }}>
      <span className={`toggle-track${checked ? ' on' : ''}`}>
        <span className="toggle-thumb" />
      </span>
      {label && <span className="toggle-label">{label}</span>}
    </span>
  )
}
```

`src/renderer/src/components/tasks/TaskForm.tsx`：

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PermissionMode, Schedule, ScheduledTask, TaskInput } from '@shared/types'
import { validateTaskForm, type TaskFormErrors } from '@/lib/taskForm'
import { toLocalInputValue } from '@/lib/format'
import { Toggle } from '@/components/ui/Toggle'

interface Props {
  initial?: ScheduledTask
  onSubmit: (input: TaskInput) => Promise<boolean> // true=成功关闭
  onCancel: () => void
}

type ScheduleType = Schedule['type']

export function TaskForm({ initial, onSubmit, onCancel }: Props) {
  const { t, i18n } = useTranslation()
  const [name, setName] = useState(initial?.name ?? '')
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')
  const [cwd, setCwd] = useState(initial?.cwd ?? '')
  const [scheduleType, setScheduleType] = useState<ScheduleType>(initial?.schedule.type ?? 'interval')
  const [cronExpr, setCronExpr] = useState(initial?.schedule.type === 'cron' ? initial.schedule.expr : '30 8 * * *')
  const [intervalMin, setIntervalMin] = useState<number>(initial?.schedule.type === 'interval' ? initial.schedule.minutes : 30)
  const [onceAt, setOnceAt] = useState(
    initial?.schedule.type === 'once'
      ? toLocalInputValue(new Date(new Date(initial.schedule.at).getTime() + 60_000))
      : toLocalInputValue(new Date(Date.now() + 60 * 60_000))
  )
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(initial?.permissionMode ?? 'default')
  const [model, setModel] = useState(initial?.model ?? '')
  const [timeoutMinutes, setTimeoutMinutes] = useState<number>(initial?.timeoutMinutes ?? 30)
  const [notifyComplete, setNotifyComplete] = useState(initial?.notify.onComplete ?? true)
  const [notifyFailure, setNotifyFailure] = useState(initial?.notify.onFailure ?? true)
  const [errors, setErrors] = useState<TaskFormErrors>({})
  const [busy, setBusy] = useState(false)

  const buildSchedule = (): Schedule => {
    if (scheduleType === 'cron') return { type: 'cron', expr: cronExpr.trim() }
    if (scheduleType === 'interval') return { type: 'interval', minutes: Number(intervalMin) || 0 }
    return { type: 'once', at: new Date(onceAt).toISOString() }
  }

  const submit = async (): Promise<void> => {
    const schedule = buildSchedule()
    const errs = validateTaskForm({ name, prompt, cwd, schedule }, new Date())
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    setBusy(true)
    const ok = await onSubmit({
      name, prompt, cwd, schedule, permissionMode,
      model: model.trim() || undefined,
      timeoutMinutes,
      notify: { onComplete: notifyComplete, onFailure: notifyFailure }
    })
    setBusy(false)
    if (ok) onCancel()
  }

  const err = (k: keyof TaskFormErrors): string | undefined =>
    errors[k] ? t(errors[k]!) : undefined

  return (
    <div>
      <div className="field">
        <label>{t('tasks.name')}</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
        {err('name') && <span className="error">{err('name')}</span>}
      </div>
      <div className="field">
        <label>{t('tasks.prompt')}</label>
        <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        {err('prompt') && <span className="error">{err('prompt')}</span>}
      </div>
      <div className="field">
        <label>{t('tasks.cwd')}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={cwd} readOnly style={{ flex: 1 }} />
          <button
            className="btn"
            onClick={() => void window.api.app.pickDirectory().then((d) => d && setCwd(d))}
          >
            {t('tasks.pickDir')}
          </button>
        </div>
        {err('cwd') && <span className="error">{err('cwd')}</span>}
      </div>
      <div className="field">
        <label>{t('tasks.scheduleType')}</label>
        <select value={scheduleType} onChange={(e) => setScheduleType(e.target.value as ScheduleType)}>
          <option value="cron">Cron</option>
          <option value="interval">{t('tasks.interval')}</option>
          <option value="once">{t('tasks.once')}</option>
        </select>
      </div>
      {scheduleType === 'cron' && (
        <div className="field">
          <label>{t('tasks.cron')}</label>
          <input value={cronExpr} onChange={(e) => setCronExpr(e.target.value)} placeholder="30 8 * * *" />
          {err('schedule') && <span className="error">{err('schedule')}</span>}
        </div>
      )}
      {scheduleType === 'interval' && (
        <div className="field">
          <label>{t('tasks.interval')}</label>
          <input
            type="number" min={1} value={intervalMin}
            onChange={(e) => setIntervalMin(Number(e.target.value))}
          />
          {err('schedule') && <span className="error">{err('schedule')}</span>}
        </div>
      )}
      {scheduleType === 'once' && (
        <div className="field">
          <label>{t('tasks.once')}</label>
          <input type="datetime-local" value={onceAt} onChange={(e) => setOnceAt(e.target.value)} />
          {err('schedule') && <span className="error">{err('schedule')}</span>}
        </div>
      )}
      <div className="field">
        <label>{t('tasks.permissionMode')}</label>
        <select value={permissionMode} onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}>
          <option value="default">{t('tasks.pmDefault')}</option>
          <option value="acceptEdits">{t('tasks.pmAcceptEdits')}</option>
          <option value="bypassPermissions">{t('tasks.pmBypass')}</option>
        </select>
      </div>
      {permissionMode === 'bypassPermissions' && <div className="risk-note">⚠️ {t('tasks.pmRisk')}</div>}
      <div className="field">
        <label>{t('tasks.model')}</label>
        <input value={model} onChange={(e) => setModel(e.target.value)} />
      </div>
      <div className="field">
        <label>{t('tasks.timeout')}</label>
        <input
          type="number" min={1} value={timeoutMinutes}
          onChange={(e) => setTimeoutMinutes(Number(e.target.value) || 30)}
        />
      </div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
        <Toggle checked={notifyComplete} onChange={setNotifyComplete} label={t('tasks.notifyComplete')} />
        <Toggle checked={notifyFailure} onChange={setNotifyFailure} label={t('tasks.notifyFailure')} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn" onClick={onCancel} disabled={busy}>{t('common.cancel')}</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{t('common.save')}</button>
      </div>
      <span hidden>{i18n.language}</span>
    </div>
  )
}
```

（`<span hidden>{i18n.language}</span>` 防止 i18n 未使用告警，可省。）

- [ ] **Step 13.6: 写 TaskDrawer**

`src/renderer/src/components/tasks/TaskDrawer.tsx`：

```tsx
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ScheduledTask, TaskInput } from '@shared/types'
import { useTaskStore } from '@/stores/tasks'
import { formatRelative } from '@/lib/format'
import { Toggle } from '@/components/ui/Toggle'
import { TaskForm } from './TaskForm'

type View =
  | { kind: 'list' }
  | { kind: 'form'; task?: ScheduledTask }
  | { kind: 'detail'; taskId: string }

export function TaskDrawer({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const [view, setView] = useState<View>({ kind: 'list' })
  const tasks = useTaskStore((s) => s.tasks)
  const history = useTaskStore((s) => s.history)
  const setEnabled = useTaskStore((s) => s.setEnabled)
  const runNow = useTaskStore((s) => s.runNow)
  const create = useTaskStore((s) => s.create)
  const update = useTaskStore((s) => s.update)
  const remove = useTaskStore((s) => s.remove)

  const lastRunByTask = useMemo(() => {
    const m = new Map<string, (typeof history)[number]>()
    for (const r of [...history].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
      m.set(r.taskId, r) // 升序遍历，留下最新
    }
    return m
  }, [history])

  const submit = async (input: TaskInput): Promise<boolean> => {
    if (view.kind === 'form' && view.task) {
      await update(view.task.id, input)
      return true
    }
    const created = await create(input)
    return created !== null
  }

  const statusText = (status: string): string =>
    status === 'running' ? t('tasks.statusRunning')
    : status === 'success' ? t('tasks.statusSuccess')
    : status === 'failed' ? t('tasks.statusFailed')
    : t('tasks.statusMissed')

  return (
    <div className="drawer">
      <div className="drawer-head">
        <h2>{t('tasks.title')}</h2>
        <div style={{ display: 'flex', gap: 4 }}>
          {view.kind !== 'list' && (
            <button className="btn btn-ghost" onClick={() => setView({ kind: 'list' })}>{t('common.back')}</button>
          )}
          <button className="btn btn-ghost" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>
      </div>
      <div className="drawer-body">
        {view.kind === 'list' && (
          <>
            {tasks.length === 0 && <p style={{ color: 'var(--text-dim)' }}>{t('tasks.empty')}</p>}
            {tasks.map((task) => {
              const last = lastRunByTask.get(task.id)
              return (
                <div key={task.id} className="task-item" onClick={() => setView({ kind: 'detail', taskId: task.id })}>
                  <Toggle
                    checked={task.enabled}
                    onChange={(v) => { void setEnabled(task.id, v) }}
                  />
                  <div className="meta">
                    <div className="name">{task.name}</div>
                    <div className="sub">
                      {task.enabled && task.nextRunAt
                        ? `${t('tasks.nextRun')} ${formatRelative(task.nextRunAt, i18n.language)}`
                        : t('tasks.enabled') + ': ' + t('common.close')}
                    </div>
                  </div>
                  {last && <span className={`status-chip ${last.status}`}>{statusText(last.status)}</span>}
                </div>
              )
            })}
          </>
        )}
        {view.kind === 'form' && <TaskForm initial={view.task} onSubmit={submit} onCancel={() => setView(view.task ? { kind: 'detail', taskId: view.task.id } : { kind: 'list' })} />}
        {view.kind === 'detail' && <TaskDetail taskId={view.taskId} onEdit={() => setView({ kind: 'form', task: tasks.find((x) => x.id === view.taskId) })} onRunNow={() => { void runNow(view.taskId) }} onDelete={() => { void remove(view.taskId); setView({ kind: 'list' }) }} />}
      </div>
      {view.kind === 'list' && (
        <div className="drawer-foot">
          <button className="btn btn-primary" onClick={() => setView({ kind: 'form' })}>{t('tasks.new')}</button>
        </div>
      )}
    </div>
  )
}

function TaskDetail({ taskId, onEdit, onRunNow, onDelete }: {
  taskId: string
  onEdit: () => void
  onRunNow: () => void
  onDelete: () => void
}) {
  const { t, i18n } = useTranslation()
  const task = useTaskStore((s) => s.tasks.find((x) => x.id === taskId))
  if (!task) return <p style={{ color: 'var(--text-dim)' }}>{t('tasks.empty')}</p>
  const scheduleText =
    task.schedule.type === 'cron' ? `${task.schedule.expr}`
    : task.schedule.type === 'interval' ? `${task.schedule.minutes} ${t('common.minutes')}`
    : new Date(task.schedule.at).toLocaleString(i18n.language)
  return (
    <div>
      <dl className="kv">
        <dt>{t('tasks.name')}</dt><dd>{task.name}</dd>
        <dt>{t('tasks.prompt')}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{task.prompt}</dd>
        <dt>{t('tasks.cwd')}</dt><dd>{task.cwd}</dd>
        <dt>{t('tasks.scheduleType')}</dt><dd>{scheduleText}</dd>
        <dt>{t('tasks.permissionMode')}</dt><dd>{task.permissionMode}</dd>
        {task.model && (<><dt>{t('tasks.model')}</dt><dd>{task.model}</dd></>)}
        <dt>{t('tasks.timeout')}</dt><dd>{task.timeoutMinutes} {t('common.minutes')}</dd>
        <dt>{t('tasks.nextRun')}</dt><dd>{task.nextRunAt ? formatRelative(task.nextRunAt, i18n.language) : '—'}</dd>
      </dl>
      <div style={{ display: 'flex', gap: 8, margin: '14px 0' }}>
        <button className="btn" onClick={onRunNow}>{t('tasks.runNow')}</button>
        <button className="btn" onClick={onEdit}>{t('common.edit')}</button>
        <button className="btn btn-danger" style={{ marginLeft: 'auto' }} onClick={onDelete}>{t('common.delete')}</button>
      </div>
      <h3 style={{ fontSize: 13, color: 'var(--text-strong)' }}>{t('tasks.history')}</h3>
      {/* Task 14 接入 <RunHistory taskId={task.id} /> */}
    </div>
  )
}
```

App.tsx：把占位注释替换为真实挂载（`tasksOpen` 状态已存在）：

```tsx
      {newSessionOpen && <NewSessionModal onClose={() => setNewSessionOpen(false)} />}
      {tasksOpen && <TaskDrawer onClose={() => setTasksOpen(false)} />}
```

并删除 `<span hidden>…</span>` 中的 `{String(tasksOpen)}`。

- [ ] **Step 13.7: 测试 + 冒烟**

Run: `npm test && npm run typecheck`
Expected: 全部 passed / 0 errors。

Run: `npm run dev` 人工确认清单：
1. ⏰ 打开抽屉 → 空态文案；新建 → 表单。
2. 表单：缺名称提交 → 红字校验；cron 填 `bad` → 报错；填 `*/2 * * * *` interval 2 分钟保存成功。
3. 列表出现任务（下次运行「2 分钟内」相对时间）；Toggle 关闭再开启，nextRun 重算。
4. 详情页字段正确；「立即运行」→ 列表状态 chip 变 running →（真实 claude 约 10–60s）→ success；编辑回填正确。
5. 删除任务后回到列表。

- [ ] **Step 13.8: Commit**

```bash
git add -A
git commit -m "feat(ui): 任务抽屉——列表/详情/表单（cron·间隔·一次性、权限风险提示、校验 i18n key）"
```

---

### Task 14: 运行历史 + Transcript 回放

**Files:**
- Create: `src/renderer/src/components/tasks/RunHistory.tsx`, `src/renderer/src/components/tasks/TranscriptView.tsx`
- Modify: `src/renderer/src/components/tasks/TaskDrawer.tsx`（接入 RunHistory）、`src/renderer/src/styles/global.css`（时间线/对话流样式）

> 执行本任务前先调用 `frontend-design` skill。

- [ ] **Step 14.1: global.css 追加时间线 / 回放样式**

```css
/* ===== 运行历史时间线 ===== */
.run-item {
  border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px;
  display: flex; flex-direction: column; gap: 4px; background: var(--bg);
}
.run-item .row1 { display: flex; align-items: center; gap: 8px; }
.run-item .when { color: var(--text-dim); font-size: 11.5px; }
.run-item .result {
  color: var(--text); font-size: 12px; max-height: 40px; overflow: hidden;
  white-space: pre-wrap; word-break: break-all;
}
.run-item .link { color: var(--accent); font-size: 12px; align-self: flex-start; padding: 0; }
.run-item .link:hover { text-decoration: underline; }

/* ===== 回放对话流 ===== */
.transcript { display: flex; flex-direction: column; gap: 10px; }
.tr-bubble { border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; background: var(--bg-sidebar); }
.tr-bubble.text { white-space: pre-wrap; word-break: break-word; color: var(--text-strong); font-size: 12.5px; }
.tr-tool { display: flex; align-items: center; gap: 6px; color: var(--accent); font-size: 12px; }
.tr-tool .input { color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; font-family: monospace; }
.tr-result { border-color: var(--success); }
.tr-result.is-error { border-color: var(--danger); }
.tr-result .head { font-size: 11px; color: var(--text-dim); margin-bottom: 4px; }
.tr-result .body { white-space: pre-wrap; word-break: break-word; color: var(--text-strong); font-size: 12.5px; }
```

- [ ] **Step 14.2: 写 RunHistory.tsx**

`src/renderer/src/components/tasks/RunHistory.tsx`：

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RunRecord } from '@shared/types'
import { useTaskStore } from '@/stores/tasks'
import { formatDateTime } from '@/lib/format'
import { TranscriptView } from './TranscriptView'

function durationOf(rec: RunRecord): string | null {
  if (!rec.finishedAt) return null
  const ms = new Date(rec.finishedAt).getTime() - new Date(rec.startedAt).getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60_000)}m`
}

export function RunHistory({ taskId }: { taskId: string }) {
  const { t, i18n } = useTranslation()
  const history = useTaskStore((s) => s.history)
  const runs = history
    .filter((r) => r.taskId === taskId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const [viewing, setViewing] = useState<RunRecord | null>(null)

  if (runs.length === 0) {
    return <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>{t('transcript.empty')}</p>
  }

  const statusText = (status: string): string =>
    status === 'running' ? t('tasks.statusRunning')
    : status === 'success' ? t('tasks.statusSuccess')
    : status === 'failed' ? t('tasks.statusFailed')
    : t('tasks.statusMissed')

  return (
    <div>
      {runs.map((rec) => (
        <div key={rec.id} className="run-item">
          <div className="row1">
            <span className={`status-chip ${rec.status}`}>{statusText(rec.status)}</span>
            <span className="when">
              {formatDateTime(rec.startedAt, i18n.language)}
              {durationOf(rec) ? ` · ${durationOf(rec)}` : ''}
              {rec.exitCode !== undefined ? ` · ${t('transcript.exitCode', { code: rec.exitCode })}` : ''}
            </span>
          </div>
          {rec.resultText && <div className="result">{rec.resultText}</div>}
          {rec.status !== 'running' && (
            <button className="link" onClick={() => setViewing(rec)}>{t('tasks.viewTranscript')}</button>
          )}
        </div>
      ))}
      {viewing && <TranscriptView run={viewing} taskId={taskId} onClose={() => setViewing(null)} />}
    </div>
  )
}
```

- [ ] **Step 14.3: 写 TranscriptView.tsx**

`src/renderer/src/components/tasks/TranscriptView.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RunRecord, TranscriptItem } from '@shared/types'
import { useTaskStore } from '@/stores/tasks'
import { Modal } from '@/components/ui/Modal'

interface Props {
  run: RunRecord
  taskId: string
  onClose: () => void
}

export function TranscriptView({ run, taskId, onClose }: Props) {
  const { t } = useTranslation()
  const task = useTaskStore((s) => s.tasks.find((x) => x.id === taskId))
  const [items, setItems] = useState<TranscriptItem[] | null>(null)

  useEffect(() => {
    void window.api.tasks.transcript(run).then(setItems)
  }, [run])

  return (
    <Modal title={t('transcript.title')} onClose={onClose} width={560}>
      {task && (
        <div className="tr-bubble text" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>{t('transcript.prompt')}</div>
          {task.prompt}
        </div>
      )}
      {items === null && <p style={{ color: 'var(--text-dim)' }}>…</p>}
      {items !== null && items.length === 0 && <p style={{ color: 'var(--text-dim)' }}>{t('transcript.empty')}</p>}
      {items !== null && items.length > 0 && (
        <div className="transcript">
          {items.map((item, i) => {
            if (item.kind === 'text') {
              return <div key={i} className="tr-bubble text">{item.text}</div>
            }
            if (item.kind === 'tool') {
              return (
                <div key={i} className="tr-bubble">
                  <div className="tr-tool">
                    <span>🔧 {t('transcript.tool')}: {item.name}</span>
                    {item.input && <span className="input">{item.input}</span>}
                  </div>
                </div>
              )
            }
            return (
              <div key={i} className={`tr-bubble tr-result${item.isError ? ' is-error' : ''}`}>
                <div className="head">{t('transcript.result')}</div>
                <div className="body">{item.text}</div>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
```

- [ ] **Step 14.4: TaskDrawer 详情接入 RunHistory**

`TaskDrawer.tsx` 的 `TaskDetail` 末尾替换占位注释：

```tsx
      <h3 style={{ fontSize: 13, color: 'var(--text-strong)' }}>{t('tasks.history')}</h3>
      <RunHistory taskId={task.id} />
```

文件顶部追加 `import { RunHistory } from './RunHistory'`。

- [ ] **Step 14.5: 冒烟验证**

Run: `npm run dev`
人工确认清单：
1. 用 Task 13 冒烟留下的任务「立即运行」一次。
2. 完成后详情页历史时间线出现一条 success（时间 + 时长 + 结果摘要两行截断）。
3. 点「查看运行过程」→ 弹窗内：任务指令气泡 → 若干 text/tool 条目 → 最终结果绿框。
4. 人为制造失败（prompt 填会在 1 分钟内失败的内容或把目录权限模式设 default）→ failed 记录 + 红框 is-error 回放。

Run: `npm run typecheck` → 0 errors。

- [ ] **Step 14.6: Commit**

```bash
git add -A
git commit -m "feat(ui): 运行历史时间线 + stream-json transcript 对话流回放"
```

---

### Task 15: 系统通知 + 角标 + 下次任务卡

**Files:**
- Create: `src/main/notifyText.ts`（纯函数，无 electron 依赖，可测）、`src/main/notifications.ts`、`src/main/notifyText.test.ts`、`src/renderer/src/components/NextTaskCard.tsx`（覆盖占位）
- Modify: `src/main/index.ts`（notify 接线 + dock 角标 + 通知点击聚焦）、`src/preload/index.ts`（onOpenTasks）、`src/renderer/src/components/SessionSidebar.tsx`（onOpenTasks 透传）、`src/renderer/src/App.tsx`（传 onOpenTasks、通知点击打开抽屉）

- [ ] **Step 15.1: 写通知文案失败测试**

`src/main/notifyText.test.ts`（独立纯模块，避免 vitest node 环境加载 electron）：

```ts
import { describe, it, expect } from 'vitest'
import { notifyTexts } from './notifyText'

describe('notifyTexts', () => {
  it('zh 系 locale 输出中文', () => {
    const t = notifyTexts('zh-CN')
    expect(t.done('任务A')).toContain('任务A')
    expect(t.failed('任务A')).toContain('任务A')
    expect(t.detail.length).toBeGreaterThan(0)
  })
  it('其他 locale 输出英文且含名字', () => {
    const t = notifyTexts('en-US')
    expect(t.done('X')).toContain('X')
    expect(t.done('X')).not.toContain('「')
  })
})
```

Run: `npx vitest run src/main/notifyText.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 15.2: 实现 notifyText.ts（纯）与 notifications.ts**

`src/main/notifyText.ts`（无 electron 依赖，可被 vitest 直接加载）：

```ts
/** 通知文案（主进程侧，与 renderer i18n 资源保持同义） */
export function notifyTexts(locale: string): {
  done: (name: string) => string
  failed: (name: string) => string
  detail: string
} {
  if (locale.toLowerCase().startsWith('zh')) {
    return {
      done: (n) => `「${n}」已完成`,
      failed: (n) => `「${n}」运行失败`,
      detail: '点击查看详情'
    }
  }
  return {
    done: (n) => `"${n}" finished`,
    failed: (n) => `"${n}" failed`,
    detail: 'Click to view details'
  }
}
```

`src/main/notifications.ts`（只包 electron API）：

```ts
import { app, Notification } from 'electron'

export function initNotifications(): void {
  // Windows Toast 需要 AppUserModelID
  if (process.platform === 'win32') app.setAppUserModelId('com.agentdesk.app')
}

export function showNotification(title: string, body: string, onClick?: () => void): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body })
  if (onClick) n.on('click', onClick)
  n.show()
}

export function setDockBadge(count: number): void {
  if (process.platform === 'darwin' && typeof app.dock !== 'undefined') {
    app.dock.setBadge(count > 0 ? String(count) : '')
  }
}
```

Run: `npx vitest run src/main/notifyText.test.ts`
Expected: 2 passed。

- [ ] **Step 15.3: 主进程接线（notify + 角标 + 点击聚焦）**

`src/main/index.ts`：

1. `whenReady` 里 `initNotifications()`（在创建 TaskService 前）。
2. TaskService 构造的 deps 追加：

```ts
    notify: (rec, task) => {
      const texts = notifyTexts(app.getLocale())
      const failed = rec.status === 'failed'
      if (failed && !task.notify.onFailure) return
      if (!failed && rec.status !== 'success') return
      if (!failed && !task.notify.onComplete) return
      showNotification(failed ? texts.failed(task.name) : texts.done(task.name), texts.detail, () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show()
          mainWindow.focus()
          mainWindow.webContents.send('app:openTasks')
        }
      })
    },
```

3. `onChanged` 回调里追加角标更新：

```ts
      setDockBadge(history.filter((r) => r.status === 'running').length)
```

import 追加：`import { initNotifications, showNotification, setDockBadge } from './notifications'` 与 `import { notifyTexts } from './notifyText'`。

- [ ] **Step 15.4: preload + App 接通知点击打开抽屉**

`src/preload/index.ts` 追加：

```ts
  onOpenTasks: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('app:openTasks', listener)
    return () => ipcRenderer.removeListener('app:openTasks', listener)
  },
```

App.tsx 的 hydrate useEffect 附近追加：

```ts
  useEffect(() => {
    const off = window.api.onOpenTasks(() => setTasksOpen(true))
    return off
  }, [])
```

- [ ] **Step 15.5: NextTaskCard 实装 + Sidebar 透传**

`src/renderer/src/components/NextTaskCard.tsx`（覆盖占位）：

```tsx
import { useTranslation } from 'react-i18next'
import { useTaskStore, selectNextTask, selectRunningCount } from '@/stores/tasks'
import { formatRelative } from '@/lib/format'

export function NextTaskCard({ onOpenTasks }: { onOpenTasks: () => void }) {
  const { t, i18n } = useTranslation()
  const next = useTaskStore(selectNextTask)
  const running = useTaskStore(selectRunningCount)

  return (
    <button
      onClick={onOpenTasks}
      style={{
        width: '100%', textAlign: 'left', background: 'var(--bg-raised)',
        border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', cursor: 'pointer'
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
        {running > 0 ? t('tasks.runningCount', { count: running }) : t('tasks.summaryNext')}
      </div>
      {next ? (
        <div style={{ fontSize: 12.5, color: 'var(--text-strong)', marginTop: 2 }}>
          ⏰ {next.name}
          <span style={{ color: 'var(--accent)', marginLeft: 6 }}>
            {formatRelative(next.nextRunAt!, i18n.language)}
          </span>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 2 }}>{t('tasks.summaryNone')}</div>
      )}
    </button>
  )
}
```

`SessionSidebar.tsx`：组件签名改为 `export function SessionSidebar({ onNewSession, onOpenTasks }: { onNewSession: () => void; onOpenTasks: () => void })`，占位 `<NextTaskCard onOpenTasks={() => undefined} />` 改为 `<NextTaskCard onOpenTasks={onOpenTasks} />`。

App.tsx：`<SessionSidebar onNewSession={...} onOpenTasks={() => setTasksOpen(true)} />`。

- [ ] **Step 15.6: 冒烟验证**

Run: `npm run dev`
人工确认清单：
1. 建一个 interval 2 分钟的任务并「立即运行」→ 完成时系统通知弹出（macOS 右上角）；点通知 → 窗口前置 + 任务抽屉打开。
2. Dock 图标出现运行中角标（任务运行期间数字 1），完成后消失。
3. 侧栏底部任务卡显示「下一个任务 + 相对时间」；无任务时显示空态文案；点击卡片打开任务抽屉。

Run: `npm run typecheck` → 0 errors。

- [ ] **Step 15.7: Commit**

```bash
git add -A
git commit -m "feat(tasks): 系统通知（点击聚焦开抽屉）+ dock 运行角标 + 下次任务摘要卡"
```

---

## Phase 4 · 扩展可视化

### Task 16: frontmatter 解析 + RegistryScanner（TDD，真实 fs fixture）

**Files:**
- Create: `src/main/registry/frontmatter.ts`, `src/main/registry/RegistryScanner.ts`, `src/main/registry/RegistryScanner.test.ts`

- [ ] **Step 16.1: 写 frontmatter + 扫描器失败测试（tmpdir fixture）**

`src/main/registry/RegistryScanner.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseFrontmatter } from './frontmatter'
import { scanRegistry, createNodeScannerFs } from './RegistryScanner'

let home: string
let project: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ad-home-'))
  project = mkdtempSync(join(tmpdir(), 'ad-proj-'))
})

function write(dir: string, rel: string, content: string): void {
  const p = join(dir, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, content, 'utf8')
}

const SKILL_MD = `---
name: my-skill
description: Does something useful
---

Body ignored
`

describe('parseFrontmatter', () => {
  it('解析 key: value，去引号；无 frontmatter 返回空', () => {
    expect(parseFrontmatter(SKILL_MD)).toEqual({ name: 'my-skill', description: 'Does something useful' })
    expect(parseFrontmatter('---\nname: "q"\n---\nx')).toEqual({ name: 'q' })
    expect(parseFrontmatter('no frontmatter')).toEqual({})
  })
})

describe('scanRegistry', () => {
  it('扫描 user/project/plugin skills + agents + MCP servers', () => {
    write(home, '.claude/skills/my-skill/SKILL.md', SKILL_MD)
    write(home, '.claude/plugins/cache/official/superpowers/5.1.0/skills/sp-skill/SKILL.md',
      '---\nname: sp-skill\ndescription: from plugin\n---\n')
    write(project, '.claude/skills/proj-skill/SKILL.md', '---\nname: proj-skill\ndescription: p\n---\n')
    write(home, '.claude/agents/researcher.md', '---\nname: researcher\ndescription: finds things\ntools: Read, WebSearch\n---\n')
    write(project, '.claude/agents/proj-agent.md', '---\nname: proj-agent\ndescription: pa\n---\n')
    write(home, '.claude.json', JSON.stringify({
      mcpServers: {
        web: { command: 'npx', args: ['-y', 'web-mcp'] },
        remote: { type: 'sse', url: 'https://mcp.example/sse' }
      }
    }))
    write(project, '.mcp.json', JSON.stringify({ mcpServers: { projdb: { command: 'db-mcp' } } }))

    const snap = scanRegistry(createNodeScannerFs(), home, project)
    expect(snap.scannedAt).toBeTruthy()
    expect(snap.skills).toEqual([
      { name: 'my-skill', description: 'Does something useful', source: 'user' },
      { name: 'proj-skill', description: 'p', source: 'project' },
      { name: 'sp-skill', description: 'from plugin', source: 'plugin' }
    ])
    expect(snap.agents).toEqual([
      { name: 'proj-agent', description: 'pa', source: 'project' },
      { name: 'researcher', description: 'finds things', tools: 'Read, WebSearch', source: 'user' }
    ])
    expect(snap.mcpServers).toEqual([
      { name: 'web', transport: 'stdio', command: 'npx', scope: 'user' },
      { name: 'remote', transport: 'sse', url: 'https://mcp.example/sse', scope: 'user' },
      { name: 'projdb', transport: 'stdio', command: 'db-mcp', scope: 'project' }
    ])
  })

  it('目录不存在 / JSON 损坏 → 空列表不抛错', () => {
    write(home, '.claude.json', '{broken')
    const snap = scanRegistry(createNodeScannerFs(), home, project)
    expect(snap.skills).toEqual([])
    expect(snap.agents).toEqual([])
    expect(snap.mcpServers).toEqual([])
  })

  it('SKILL.md 缺 frontmatter 时 name 回退目录名', () => {
    write(home, '.claude/skills/bare/SKILL.md', 'just body')
    const snap = scanRegistry(createNodeScannerFs(), home, project)
    expect(snap.skills).toEqual([{ name: 'bare', description: '', source: 'user' }])
  })
})
```

Run: `npx vitest run src/main/registry/RegistryScanner.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 16.2: 实现 frontmatter.ts 与 RegistryScanner.ts**

`src/main/registry/frontmatter.ts`：

```ts
/** 极简 YAML frontmatter 子集解析：仅 key: value 字符串行 */
export function parseFrontmatter(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return result
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key) result[key] = value
  }
  return result
}
```

`src/main/registry/RegistryScanner.ts`：

```ts
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentInfo, McpServerInfo, RegistrySnapshot, SkillInfo, SkillSource } from '@shared/types'
import { parseFrontmatter } from './frontmatter'

export interface ScannerFs {
  exists(path: string): boolean
  isDir(path: string): boolean
  listDir(path: string): string[] // 目录不存在 → []
  read(path: string): string | null
  join(...parts: string[]): string
}

export function createNodeScannerFs(): ScannerFs {
  return {
    exists: existsSync,
    isDir: (p) => { try { return statSync(p).isDirectory() } catch { return false } },
    listDir: (p) => { try { return readdirSync(p) } catch { return [] } },
    read: (p) => { try { return readFileSync(p, 'utf8') } catch { return null } },
    join
  }
}

function scanSkillDirs(fs: ScannerFs, dir: string, source: SkillSource, out: SkillInfo[]): void {
  for (const entry of fs.listDir(dir)) {
    const skillDir = fs.join(dir, entry)
    const skillMd = fs.join(skillDir, 'SKILL.md')
    if (!fs.isDir(skillDir) || !fs.exists(skillMd)) continue
    const fm = parseFrontmatter(fs.read(skillMd) ?? '')
    out.push({ name: fm.name || entry, description: fm.description ?? '', source })
  }
}

/** 在 plugin cache 下递归找名为 skills 的目录（限深，防失控） */
function collectPluginSkillsDirs(fs: ScannerFs, dir: string, depth: number, out: string[]): void {
  if (depth <= 0) return
  for (const entry of fs.listDir(dir)) {
    const child = fs.join(dir, entry)
    if (!fs.isDir(child)) continue
    if (entry === 'skills') out.push(child)
    else collectPluginSkillsDirs(fs, child, depth - 1, out)
  }
}

export function scanSkills(fs: ScannerFs, home: string, project: string): SkillInfo[] {
  const out: SkillInfo[] = []
  scanSkillDirs(fs, fs.join(home, '.claude', 'skills'), 'user', out)
  scanSkillDirs(fs, fs.join(project, '.claude', 'skills'), 'project', out)
  const pluginDirs: string[] = []
  collectPluginSkillsDirs(fs, fs.join(home, '.claude', 'plugins', 'cache'), 4, pluginDirs)
  for (const d of pluginDirs) scanSkillDirs(fs, d, 'plugin', out)
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function scanAgents(fs: ScannerFs, home: string, project: string): AgentInfo[] {
  const out: AgentInfo[] = []
  const scan = (dir: string, source: 'user' | 'project'): void => {
    for (const entry of fs.listDir(dir)) {
      if (!entry.endsWith('.md')) continue
      const fm = parseFrontmatter(fs.read(fs.join(dir, entry)) ?? '')
      if (!fm.name && !fm.description) continue
      out.push({ name: fm.name || entry.replace(/\.md$/, ''), description: fm.description ?? '', tools: fm.tools, source })
    }
  }
  scan(fs.join(home, '.claude', 'agents'), 'user')
  scan(fs.join(project, '.claude', 'agents'), 'project')
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

interface RawMcpServer { type?: string; command?: string; url?: string }

export function scanMcp(fs: ScannerFs, home: string, project: string): McpServerInfo[] {
  const out: McpServerInfo[] = []
  const readConfig = (path: string, scope: 'user' | 'project'): void => {
    const text = fs.read(path)
    if (!text) return
    try {
      const servers = (JSON.parse(text) as { mcpServers?: Record<string, RawMcpServer> }).mcpServers
      if (!servers || typeof servers !== 'object') return
      for (const [name, v] of Object.entries(servers)) {
        const transport = v?.type === 'sse' ? 'sse' : v?.type === 'http' ? 'http' : 'stdio'
        out.push({ name, transport, command: v?.command, url: v?.url, scope })
      }
    } catch {
      /* 损坏配置 → 忽略该文件 */
    }
  }
  readConfig(fs.join(home, '.claude.json'), 'user')
  readConfig(fs.join(project, '.mcp.json'), 'project')
  return out
}

export function scanRegistry(fs: ScannerFs, home: string, project: string): RegistrySnapshot {
  return {
    scannedAt: new Date().toISOString(),
    skills: scanSkills(fs, home, project),
    mcpServers: scanMcp(fs, home, project),
    agents: scanAgents(fs, home, project)
  }
}
```

Run: `npx vitest run src/main/registry/RegistryScanner.test.ts`
Expected: 4 passed。

- [ ] **Step 16.3: Commit**

```bash
git add src/main/registry
git commit -m "feat(registry): frontmatter 解析 + skills/MCP/agents 只读扫描（真实 fs fixture 测试）"
```

---

### Task 17: 扩展抽屉 UI + 点击插入终端

**Files:**
- Create: `src/renderer/src/stores/registry.ts`, `src/renderer/src/components/extensions/ExtensionsDrawer.tsx`
- Modify: `src/main/ipc.ts`（registry:scan）、`src/preload/index.ts`（registry API）、`src/renderer/src/App.tsx`（挂 ExtensionsDrawer）、`src/renderer/src/styles/global.css`（分段/列表样式）

> 执行本任务前先调用 `frontend-design` skill。

- [ ] **Step 17.1: IPC + preload + store**

`src/main/ipc.ts`：`IpcDeps` 追加 `scanRegistry: () => RegistrySnapshot`（装配层传 `() => scanRegistry(createNodeScannerFs(), os.homedir(), ???)`——**项目目录取当前活跃会话的 cwd**：装配层闭包里维护 `let activeCwd = os.homedir()`，`SessionManager` 创建会话时更新（main/index.ts 中在 `sessions:create` handler 里 `activeCwd = cwd` 后再 create）。handler：

```ts
  ipcMain.handle('registry:scan', () => deps.scanRegistry())
```

`src/preload/index.ts` 的 `api` 追加：

```ts
  registry: {
    scan: (): Promise<RegistrySnapshot> => ipcRenderer.invoke('registry:scan')
  },
```

（import 追加 `RegistrySnapshot` 类型。）

`src/renderer/src/stores/registry.ts`：

```ts
import { create } from 'zustand'
import type { RegistrySnapshot } from '@shared/types'

interface RegistryState {
  snapshot: RegistrySnapshot | null
  loading: boolean
  lastScanAt: number
  scan: () => Promise<void>
}

const CACHE_MS = 60_000

export const useRegistryStore = create<RegistryState>()((set, get) => ({
  snapshot: null,
  loading: false,
  lastScanAt: 0,
  scan: async () => {
    if (get().loading) return
    if (get().snapshot && Date.now() - get().lastScanAt < CACHE_MS) return
    set({ loading: true })
    try {
      const snapshot = await window.api.registry.scan()
      set({ snapshot, lastScanAt: Date.now() })
    } finally {
      set({ loading: false })
    }
  }
}))
```

- [ ] **Step 17.2: global.css 追加分段样式**

```css
/* ===== 扩展抽屉 ===== */
.seg-tabs { display: flex; gap: 4px; margin-bottom: 10px; }
.seg-tabs button {
  flex: 1; padding: 6px 0; border-radius: 6px; font-size: 12.5px;
  color: var(--text-dim); border: 1px solid transparent;
}
.seg-tabs button.active {
  color: var(--accent); background: var(--accent-soft); border-color: var(--accent);
}
.ext-search { width: 100%; margin-bottom: 10px; }
.ext-item {
  display: flex; flex-direction: column; gap: 3px; width: 100%; text-align: left;
  padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 6px;
  background: var(--bg); cursor: pointer;
}
.ext-item:hover { border-color: var(--accent); }
.ext-item .row1 { display: flex; align-items: center; gap: 8px; }
.ext-item .name { color: var(--text-strong); font-size: 12.5px; font-weight: 600; }
.ext-item .desc { color: var(--text-dim); font-size: 11.5px; line-height: 1.4; }
.tag {
  font-size: 10px; padding: 1px 6px; border-radius: 8px; margin-left: auto;
  background: var(--accent-soft); color: var(--accent); white-space: nowrap;
}
.hint-bar {
  font-size: 11.5px; color: var(--text-dim); background: var(--bg-sidebar);
  border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; margin-bottom: 10px;
}
```

- [ ] **Step 17.3: 写 ExtensionsDrawer.tsx**

`src/renderer/src/components/extensions/ExtensionsDrawer.tsx`：

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRegistryStore } from '@/stores/registry'
import { useSessionStore } from '@/stores/sessions'

type Seg = 'skills' | 'mcp' | 'agents'

export function ExtensionsDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [seg, setSeg] = useState<Seg>('skills')
  const [query, setQuery] = useState('')
  const [inserted, setInserted] = useState<string | null>(null)
  const snapshot = useRegistryStore((s) => s.snapshot)
  const loading = useRegistryStore((s) => s.loading)
  const scan = useRegistryStore((s) => s.scan)
  const activeId = useSessionStore((s) => s.activeId)

  useEffect(() => {
    void scan()
  }, [scan])

  const insert = (text: string): void => {
    if (!activeId) return
    void window.api.sessions.write(activeId, text)
    setInserted(text)
    setTimeout(() => setInserted(null), 1200)
  }

  const sourceLabel = (s: string): string =>
    s === 'user' ? t('registry.sourceUser') : s === 'plugin' ? t('registry.sourcePlugin') : t('registry.sourceProject')

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (name: string, desc: string): boolean =>
      !q || name.toLowerCase().includes(q) || desc.toLowerCase().includes(q)
    if (seg === 'skills') {
      return (snapshot?.skills ?? [])
        .filter((x) => match(x.name, x.description))
        .map((x) => ({ key: x.name + x.source, name: x.name, desc: x.description, tag: sourceLabel(x.source), insertText: `/${x.name} ` }))
    }
    if (seg === 'agents') {
      return (snapshot?.agents ?? [])
        .filter((x) => match(x.name, x.description))
        .map((x) => ({ key: x.name + x.source, name: x.name, desc: [x.description, x.tools].filter(Boolean).join(' · '), tag: sourceLabel(x.source), insertText: `${x.name} ` }))
    }
    return (snapshot?.mcpServers ?? [])
      .filter((x) => match(x.name, ''))
      .map((x) => ({ key: x.name + x.scope, name: x.name, desc: `${t('registry.transport')}: ${x.transport}${x.command ? ` · ${x.command}` : ''}${x.url ? ` · ${x.url}` : ''}`, tag: sourceLabel(x.scope), insertText: `${x.name} ` }))
  }, [seg, query, snapshot, t])

  return (
    <div className="drawer">
      <div className="drawer-head">
        <h2>{t('registry.title')}</h2>
        <button className="btn btn-ghost" onClick={onClose} aria-label={t('common.close')}>✕</button>
      </div>
      <div className="drawer-body">
        <div className="seg-tabs">
          <button className={seg === 'skills' ? 'active' : ''} onClick={() => setSeg('skills')}>{t('registry.tabSkills')}</button>
          <button className={seg === 'mcp' ? 'active' : ''} onClick={() => setSeg('mcp')}>{t('registry.tabMcp')}</button>
          <button className={seg === 'agents' ? 'active' : ''} onClick={() => setSeg('agents')}>{t('registry.tabAgents')}</button>
        </div>
        <input className="ext-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('registry.search')} />
        <div className="hint-bar">
          {inserted ? `✓ ${t('registry.insert')}: ${inserted.trim()}` : t('registry.hint')}
        </div>
        {loading && !snapshot && <p style={{ color: 'var(--text-dim)' }}>…</p>}
        {!loading && items.length === 0 && <p style={{ color: 'var(--text-dim)' }}>{t('registry.empty')}</p>}
        {items.map((item) => (
          <button key={item.key} className="ext-item" onClick={() => insert(item.insertText)}>
            <span className="row1">
              <span className="name">{item.name}</span>
              <span className="tag">{item.tag}</span>
            </span>
            {item.desc && <span className="desc">{item.desc}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
```

App.tsx 挂载（替换 Task 13 后残留的 extOpen 占位）：

```tsx
      {extOpen && <ExtensionsDrawer onClose={() => setExtOpen(false)} />}
```

import 追加 `import { ExtensionsDrawer } from '@/components/extensions/ExtensionsDrawer'`，删除 `<span hidden>` 中的 `{String(extOpen)}`。

- [ ] **Step 17.4: 冒烟验证**

Run: `npm run dev`
人工确认清单：
1. 🧩 打开抽屉：Skills 列出本机 `~/.claude/skills` 与 plugin 里的 skill（来源标签正确）；MCP 列出已配置 server；Agents 列出 `~/.claude/agents`。
2. 搜索框过滤即时生效；60s 内重开抽屉不重扫（无 loading 闪烁）。
3. 建一个会话并激活，点一个 skill → 终端输入行出现 `/skill-name `（claude 输入框可见）；顶部提示条闪现 ✓。
4. 无活跃会话时点击无效果（不报错）。

Run: `npm run typecheck` → 0 errors。

- [ ] **Step 17.5: Commit**

```bash
git add -A
git commit -m "feat(ui): 扩展抽屉——Skills/MCP/Agents 只读可视化、搜索、点击插入终端"
```

---

## Phase 5 · 收尾

### Task 18: 设置（主题/语言/关闭行为）+ 托盘 + claude 缺失横幅

**Files:**
- Create: `src/main/store/settings.ts`, `src/main/store/settings.test.ts`, `src/main/tray.ts`, `src/renderer/src/components/SettingsModal.tsx`
- Modify: `src/main/index.ts`、`src/main/ipc.ts`、`src/preload/index.ts`、`src/renderer/src/theme/modeStore.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/global.d.ts`、`src/renderer/src/styles/global.css`

- [ ] **Step 18.1: 写 settings 失败测试**

`src/main/store/settings.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSettings, saveSettings, resolveLocale, SETTINGS_DEFAULT } from './settings'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ad-settings-')) })

describe('settings', () => {
  it('缺失 → 默认值', () => {
    expect(loadSettings(join(dir, 'settings.json'))).toEqual(SETTINGS_DEFAULT)
  })
  it('损坏 → 默认值 + 不抛错', () => {
    writeFileSync(join(dir, 'settings.json'), 'xx', 'utf8')
    expect(loadSettings(join(dir, 'settings.json'))).toEqual(SETTINGS_DEFAULT)
  })
  it('保存往返 + 部分字段合并', () => {
    const p = join(dir, 'settings.json')
    saveSettings(p, { theme: 'dark', locale: 'en', closeToTray: true })
    expect(loadSettings(p).theme).toBe('dark')
    saveSettings(p, { theme: 'light' })
    const s = loadSettings(p)
    expect(s.theme).toBe('light')
    expect(s.locale).toBe('en')
    expect(s.closeToTray).toBe(true)
  })
})

describe('resolveLocale', () => {
  it('system + zh 环境 → zh-CN；system + 其他 → en', () => {
    expect(resolveLocale('system', 'zh_CN')).toBe('zh-CN')
    expect(resolveLocale('system', 'en_US')).toBe('en')
  })
  it('显式指定优先', () => {
    expect(resolveLocale('zh-CN', 'en_US')).toBe('zh-CN')
    expect(resolveLocale('en', 'zh_CN')).toBe('en')
  })
})
```

Run: `npx vitest run src/main/store/settings.test.ts`
Expected: FAIL。

- [ ] **Step 18.2: 实现 settings.ts**

`src/main/store/settings.ts`：

```ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AppSettings } from '@shared/types'

export const SETTINGS_DEFAULT: AppSettings = { theme: 'system', locale: 'system', closeToTray: false }

export function loadSettings(path: string): AppSettings {
  try {
    if (!existsSync(path)) return { ...SETTINGS_DEFAULT }
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<AppSettings>
    return {
      theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'system',
      locale: raw.locale === 'zh-CN' || raw.locale === 'en' ? raw.locale : 'system',
      closeToTray: raw.closeToTray === true
    }
  } catch {
    return { ...SETTINGS_DEFAULT }
  }
}

export function saveSettings(path: string, patch: Partial<AppSettings>): void {
  const merged = { ...loadSettings(path), ...patch }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(merged, null, 2), 'utf8')
}

/** 'system' 时跟随应用 locale（近似系统语言） */
export function resolveLocale(pref: AppSettings['locale'], appLocale: string): 'zh-CN' | 'en' {
  if (pref === 'zh-CN' || pref === 'en') return pref
  return appLocale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}
```

Run: `npx vitest run src/main/store/settings.test.ts`
Expected: 6 passed。

- [ ] **Step 18.3: 主进程设置/托盘/关闭行为接线**

`src/main/tray.ts`：

```ts
import { app, Menu, nativeImage, Tray, BrowserWindow } from 'electron'

// 占位 16x16 图标（打包时可替换为 assets 图标）
const TRAY_ICON_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

export type TrayWithMenu = Tray & { rebuild(closeToTray: boolean): void }

export function createTray(win: BrowserWindow): TrayWithMenu {
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_B64}`)
  const tray = new Tray(icon) as TrayWithMenu
  tray.setToolTip('AgentDesk')
  tray.rebuild = (closeToTray: boolean): void => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示 AgentDesk', click: () => { win.show(); win.focus() } },
        { type: 'separator' },
        { label: closeToTray ? '退出（不保留定时任务）' : '退出', click: () => { app.quit() } }
      ])
    )
  }
  tray.rebuild(false)
  tray.on('click', () => {
    if (win.isVisible()) win.hide()
    else { win.show(); win.focus() }
  })
  return tray
}
```

（`rebuild` 直接挂在 Tray 实例上，调用方 `tray.rebuild(true)` 即可。）

`src/main/index.ts` 追加装配（`whenReady` 内、`createWindow()` 之后）：

```ts
import { loadSettings, saveSettings, resolveLocale } from './store/settings'
import { createTray } from './tray'
import { claudeCandidates } from './env'

  // ---- 设置 ----
  const settingsPath = join(app.getPath('userData'), 'store', 'settings.json')
  let settings = loadSettings(settingsPath)
  nativeTheme.themeSource = settings.theme

  // ---- 托盘 + 关闭行为 ----
  let quitting = false
  app.on('before-quit', () => { quitting = true })
  let tray: ReturnType<typeof createTray> | null = null
  const syncTray = (): void => {
    if (settings.closeToTray && !tray && mainWindow) {
      tray = createTray(mainWindow)
      tray.rebuild(true)
    }
  }
  mainWindow!.on('close', (e) => {
    if (settings.closeToTray && !quitting) {
      e.preventDefault()
      mainWindow!.hide()
    }
  })
  syncTray()
```

`src/main/ipc.ts`：`IpcDeps` 追加：

```ts
  settings: { get(): AppSettings; set(patch: Partial<AppSettings>): AppSettings }
  claudeStatus: { found: boolean; candidates: string[] }
```

handler 追加：

```ts
  ipcMain.handle('app:getSettings', () => deps.settings.get())
  ipcMain.handle('app:setSettings', (_e, patch: Partial<AppSettings>) => {
    const next = deps.settings.set(patch)
    if (patch.theme) nativeTheme.themeSource = patch.theme
    push(deps.getWindow(), 'app:settingsChanged', next)
    return next
  })
  ipcMain.handle('app:getClaudeStatus', () => deps.claudeStatus)
```

装配（main/index.ts 的 registerIpc deps 追加）：

```ts
    settings: {
      get: () => settings,
      set: (patch) => {
        settings = { ...settings, ...patch }
        saveSettings(settingsPath, patch)
        syncTray()
        return settings
      }
    },
    claudeStatus: { found: claudePath !== null, candidates: claudeCandidates(env, process.platform) },
```

（ipc.ts 需要 `import { nativeTheme } from 'electron'` 与 AppSettings 类型。）

- [ ] **Step 18.4: preload + global.d.ts 收敛 + modeStore 改造**

`src/preload/index.ts` 的 `app` 对象追加：

```ts
    getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('app:getSettings'),
    setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke('app:setSettings', patch),
    getClaudeStatus: (): Promise<{ found: boolean; candidates: string[] }> => ipcRenderer.invoke('app:getClaudeStatus')
```

并追加订阅：

```ts
  onSettingsChanged: (cb: (s: AppSettings) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, s: AppSettings) => cb(s)
    ipcRenderer.on('app:settingsChanged', listener)
    return () => ipcRenderer.removeListener('app:settingsChanged', listener)
  },
```

`src/renderer/src/global.d.ts` 简化（Task 7 的可选包装不再需要）：

```ts
import type { AgentDeskApi } from '../../preload/index'

declare global {
  interface Window {
    api: AgentDeskApi
  }
}

export {}
```

`src/renderer/src/theme/modeStore.ts` 的 `setMode` 改为持久化：

```ts
  setMode: (m) => {
    applyTheme(m)
    set({ mode: m, effective: effectiveTheme(m) })
    void window.api.app.setSettings({ theme: m }).catch(() => undefined)
  }
```

- [ ] **Step 18.5: SettingsModal + App 接线（含 claude 缺失横幅）**

global.css 追加：

```css
/* ===== 顶部横幅 ===== */
.banner-warn {
  display: flex; align-items: center; gap: 8px;
  background: var(--accent-soft); border-bottom: 1px solid var(--warn);
  color: var(--text); padding: 6px 12px; font-size: 12.5px;
}
.banner-warn button { color: var(--accent); text-decoration: underline; padding: 0; }

/* ===== 设置表单行 ===== */
.settings-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.settings-row > label { color: var(--text-dim); font-size: 12.5px; }
.candidates { margin: 4px 0 0; padding: 8px 10px 8px 20px; color: var(--text-dim); font-size: 11.5px; word-break: break-all; }
```

`src/renderer/src/components/SettingsModal.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppSettings } from '@shared/types'
import { Modal } from './ui/Modal'
import { Toggle } from './ui/Toggle'
import { useModeStore } from '@/theme/modeStore'

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const setMode = useModeStore((s) => s.setMode)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [claude, setClaude] = useState<{ found: boolean; candidates: string[] } | null>(null)

  useEffect(() => {
    void window.api.app.getSettings().then(setSettings)
    void window.api.app.getClaudeStatus().then(setClaude)
  }, [])

  const patch = async (p: Partial<AppSettings>): Promise<void> => {
    const next = await window.api.app.setSettings(p)
    setSettings(next)
    if (p.theme) setMode(next.theme)
    if (p.locale) {
      const loc = next.locale === 'system' ? (navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en') : next.locale
      void i18n.changeLanguage(loc)
    }
  }

  if (!settings) return null
  return (
    <Modal title={t('settings.title')} onClose={onClose}>
      <div className="settings-row">
        <label>{t('settings.theme')}</label>
        <select
          value={settings.theme}
          onChange={(e) => void patch({ theme: e.target.value as AppSettings['theme'] })}
        >
          <option value="system">{t('settings.themeSystem')}</option>
          <option value="light">{t('settings.themeLight')}</option>
          <option value="dark">{t('settings.themeDark')}</option>
        </select>
      </div>
      <div className="settings-row">
        <label>{t('settings.language')}</label>
        <select
          value={settings.locale}
          onChange={(e) => void patch({ locale: e.target.value as AppSettings['locale'] })}
        >
          <option value="system">{t('settings.langSystem')}</option>
          <option value="zh-CN">{t('settings.langZh')}</option>
          <option value="en">{t('settings.langEn')}</option>
        </select>
      </div>
      <div className="settings-row">
        <label>{t('settings.closeToTray')}</label>
        <Toggle checked={settings.closeToTray} onChange={(v) => void patch({ closeToTray: v })} />
      </div>
      <div className="field">
        <label>{t('settings.claudeTitle')}</label>
        {claude && !claude.found ? (
          <>
            <div style={{ color: 'var(--danger)', fontSize: 12 }}>{t('settings.claudeNotFound')}</div>
            <ul className="candidates">
              {claude.candidates.slice(0, 6).map((c) => <li key={c}>{c}</li>)}
            </ul>
          </>
        ) : (
          <div style={{ color: 'var(--success)', fontSize: 12 }}>✓ {t('settings.claudeTitle')}</div>
        )}
      </div>
    </Modal>
  )
}
```

App.tsx：
1. 挂 `{settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}`（替换占位，import，删 hidden span 残留 `{String(settingsOpen)}`）。
2. 启动时应用设置（hydrate useEffect 内追加）：

```ts
  useEffect(() => {
    void window.api.app.getSettings().then((s) => {
      useModeStore.getState().setMode(s.theme)
      const loc = s.locale === 'system'
        ? (navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en')
        : s.locale
      void i18n.changeLanguage(loc)
    })
  }, [])
```

（顶部 `import i18next from '@/i18n'`——直接用默认导出的实例调 changeLanguage。）
3. claude 缺失横幅（TitleBar 下方、有未关闭时显示）：

```tsx
  const [claudeMissing, setClaudeMissing] = useState(false)
  useEffect(() => {
    void window.api.app.getClaudeStatus().then((s) => setClaudeMissing(!s.found))
  }, [])
  // JSX：app-shell 内 TitleBar 之后插入
  {claudeMissing && (
    <div className="banner-warn">
      ⚠️ <span>{t('sessions.claudeMissingBanner')}</span>
      <button onClick={() => setSettingsOpen(true)}>{t('settings.title')}</button>
    </div>
  )}
```

（App 需 `const { t } = useTranslation()`；grid-template-rows 相应改 `auto 40px 1fr` 或直接把横幅放进 app-shell 第一个 grid row 上的普通流——实现时把 `.app-shell` 改为 `display:flex; flex-direction:column`，`.app-body` 用 `flex:1; min-height:0`。）

- [ ] **Step 18.6: 测试 + 冒烟**

Run: `npm test && npm run typecheck`
Expected: 全部通过。

Run: `npm run dev`
人工确认清单：
1. 设置 → 主题切浅色：全应用即时变浅（终端容器仍深底不变）；语言切 English 全 UI 文案切换；重启应用设置保留。
2. 开启「关闭时最小化到托盘」→ 关窗隐藏、托盘出现；托盘点图标显示/隐藏；托盘菜单退出可真正退出（退出后再开，设置仍在）。
3. 未开托盘项时关窗 = 退出。
4. （可选）临时改名 `~/.local/bin/claude` 验证顶部横幅 + 设置里的候选路径列表；恢复。

- [ ] **Step 18.7: Commit**

```bash
git add -A
git commit -m "feat(app): 设置持久化（主题/语言/托盘关闭）+ 托盘 + claude 缺失横幅与候选路径"
```

---

### Task 19: i18n 全量核对 + 打包（dmg + nsis）

**Files:**
- Create: `electron-builder.yml`
- Modify: `src/renderer/src/i18n/*`（补漏的 key，两份同步）、`package.json`（`build` 产物字段无需改，脚本已有）

- [ ] **Step 19.1: i18n 全量核对**

Run: `rg -n "[\p{Han}]" src/renderer/src/components src/renderer/src/App.tsx --pcre2 | grep -v "t('" | grep -v '\.test\.' || echo "clean"`（无 rg 时用 `grep -rn "[一-龥]" …`，BSD grep 区间不可靠则以肉眼核对兜底）
Expected: `clean`（无硬编码中文）。同法肉眼核对英文文案。

Run: `npx vitest run src/renderer/src/i18n/i18n.test.ts`
Expected: 2 passed（key 集合一致护栏）。发现缺 key → 在 `zh-CN.ts` 与 `en.ts` 同步补齐。

- [ ] **Step 19.2: 写 electron-builder.yml**

```yaml
appId: com.agentdesk.app
productName: AgentDesk
directories:
  output: release
files:
  - out/**
  - package.json
asarUnpack:
  - node_modules/node-pty/**
mac:
  target: dmg
  category: public.app-category.developer-tools
win:
  target: nsis
nsis:
  oneClick: true
  artifactName: AgentDesk-Setup-${version}.${ext}
```

- [ ] **Step 19.3: mac 打包 + 安装冒烟**

Run: `npm run dist:mac`
Expected: `release/AgentDesk-<version>-arm64.dmg` 生成（首次打包下载 Electron 二进制需数分钟）。

人工确认（安装 dmg 里的 app）：
1. 启动后新会话能跑 shell 且自动进入 claude（验证打包后 PATH 探测 + node-pty asar 解包正常）。
2. 建一个 2 分钟后的一次性任务 → 最小化到托盘 → 收到系统通知 → 点通知开抽屉看历史与回放。
3. 主题/语言切换正常；重启设置保留。

- [ ] **Step 19.4: win 交叉打包（产物校验）**

Run: `npm run dist:win`
Expected: `release/AgentDesk-Setup-<version>.exe` 生成。
（真实 Windows 运行验证需在 Windows 机器执行：安装 → 新会话（PowerShell 启动 + claude.exe 自动运行）→ 定时任务通知。在计划执行环境为 macOS 时，此步完成产物生成并在 PR/交接说明中标注「Windows 运行时验证待办」。）

- [ ] **Step 19.5: 全量回归 + Commit**

Run: `npm test && npm run typecheck && npm run build`
Expected: 全部通过、构建产物生成无错误。

```bash
git add -A
git commit -m "chore(release): electron-builder 打包配置（dmg/nsis），macOS 安装冒烟通过"
```

---

## 最终验收冒烟清单（全量）

实现完成后，在 dev 或打包版上完整走一遍：

1. **会话**：⌘T 新建（选目录）→ shell 启动 → claude 自动运行 → 斜杠命令（如 `/help`）、文件编辑权限确认弹窗均正常（CLI 能力零损失）→ 退出 claude 回到 shell 提示符。
2. **多会话**：3 个 tab 各自目录独立；⌘1-9 切换 scrollback 保留；⌘W/中键/侧栏 ✕ 关闭。
3. **定时任务**：cron `*/2 * * * *` 任务 2 分钟内自动触发；运行中再次到点被跳过（主进程日志出现 skip）；完成通知 + 历史记录 + transcript 回放；once 任务完成后自动停用；应用重启后错过的任务标记 missed。
4. **扩展**：Skills/MCP/Agents 三个分段数据正确（与 `ls ~/.claude/skills`、`.claude.json` 对比）；点击插入终端。
5. **设置**：主题三态、语言切换、托盘关闭行为、claude 候选路径展示。
6. **双主题**：系统外观切换时浅色/深色全量跟随；终端 ANSI 两套配色正确。
7. **Windows 产物**：`AgentDesk-Setup-*.exe` 可生成（运行时验证如未做，明确标注待办）。

## 计划自审记录

- **Spec 覆盖**：spec §3（架构/Electron/pty）→ T1/T3/T4/T5；§3.1-3.2（shell/PATH/claude 探测）→ T3/T5/T18；§4（任务模型/执行/调度/持久化）→ T8-T12；§5（UI/布局/快捷键/i18n）→ T2/T6/T7/T13-T15/T17/T18；§6（RegistryScanner）→ T16/T17；§7（错误处理：claude 缺失横幅/会话退出保留/store 恢复/超时）→ T5/T7/T8/T11/T18；§8（测试策略）→ 各 TDD 任务 + T11 集成 + T19 冒烟；§9（范围外）未越界。
- **占位符扫描**：无 TBD/TODO；NextTaskCard 占位（T7）在 T15 实装；RunHistory 占位注释（T13）在 T14 接入；ext/settings 占位在 T17/T18 接入——均有时序闭环。
- **类型一致性**：`ScheduledTask`/`RunRecord`/`TaskInput`/`SessionSummary`/`AppSettings`/`RegistrySnapshot`/`TranscriptItem` 定义于 `@shared/types`（T2），`startRun`/`TaskService`/`SessionManager`/IPC/preload 引用同名签名；`nextOf` 返回 `string | undefined`（ISO）与 `nextRunAt` 字段一致。

## 计划自审记录（第 2 轮，人工逐段重读后修正）

1. **SessionManager 广播时序 bug（严重）**：原 `onData/onExit` 只给已存在会话挂回调，而 IPC 广播在启动时（零会话）注册 → 永远收不到数据。已改为类级监听器 Set（T4）。
2. **CSP 移除**：`index.html` 的 CSP `script-src 'self'` 会拦掉 vite dev 的 react-refresh inline script，已移除并注明理由（T1）。
3. **渲染进程无 `process`**：T5 冒烟命令与 T6 临时 App 里的 `process.env.HOME`/`process.cwd()` 改为 `'/tmp'`（T5/T6）。
4. **TaskService 测试时区断言**：删去两条非 UTC 机器必失败的 `.toBe('…Z')` 字符串断言（统一毫秒差断言）；修正 interval 前进断言的 `-1000` 算术错误；missed 断言改为与 fixture 字面一致（T12）。
5. **vitest 加载 electron 风险**：`notifyTexts` 拆到无 electron 依赖的 `src/main/notifyText.ts`，测试只 import 纯模块（T15）。
6. **tray.ts 返回值**：原返回 `{ tray, rebuild }` 包装对象，改为把 `rebuild` 挂在 Tray 实例上返回 `TrayWithMenu`（T18）。
7. **xterm 6 主题切换**：`options.theme.set(…)` 改为整体赋值 `options.theme = …`（公开 API 保证）（T6）。
8. **T19 CJK 扫描命令**：BSD grep 的 `[一-龥]` 区间不可靠，改用 `rg --pcre2 "[\p{Han}]"` + 兜底说明。

（第 1 轮自审在写作过程中完成：`TranscriptItem` 上移 `@shared/types`、`$SHELL -l -i -c env` 参数化、skipped 不产生 RunRecord 等。）





---

## 执行结果（2026-09-19，subagent-driven 完成）

**19/19 任务完成**，每任务经规格评审 + 质量评审 + 修复循环。最终：109/109 测试、typecheck 0 错误、
dmg（arm64）+ nsis exe 产物生成。评审共发现并修复 **10 个 Critical/Important 级真实缺陷**，包括：
SessionManager 广播注册时序 bug（终端永无输出）、TaskService 过期 once 任务三扇"擅自补跑"门、
tick 循环无错误隔离、transcript 写流无 error 监听（磁盘满崩整个应用）、probeUserEnv 挂起（rc 守护进程占管道）、
存储层形状错误静默丢数据、主题 watcher 回归（系统切换不生效）、macOS ⌘W 被原生菜单抢占、
通知点击在已销毁窗口上崩溃、close-guard 不跟随窗口重建。另有 5 处计划文档代码 bug 在实现中被抓出修正。

### 已文档化、按计划 deferred 的跟进项

1. claude 子进程进程组 kill（RunHandle.kill 已具备，未接入 before-quit 清理）
2. tasks:transcript 改按 runId 查找（现信任渲染端传入的 transcriptPath）
3. 渲染端 notify.* i18n key 为死键（主进程 notifyText 同义维护）
4. 崩溃退出后遗留的 running 历史记录不清扫（角标可能虚高）
5. 托盘 1x1 占位图标（打包前应换真实 assets 图标）
6. 抽屉互斥仅覆盖 TitleBar 切换路径（通知点击/侧栏路径仍可叠放）
7. 扩展扫描的 project 目录仅在 sessions:create 时更新（多项目切换不重定向）
8. Windows x64 安装包须在 Windows 宿主/CI 上执行 `npm run dist:win`（node-pty 交叉源码构建不支持）
9. macOS 浅色主题下终端容器深色边环（spec 设计决策，最终视觉验收可复议）
