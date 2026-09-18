# Agent Desktop 设计文档

**日期**：2026-09-18
**状态**：已与用户确认

## 1. 目标与定位

将 Claude Code CLI 封装为跨平台桌面应用（macOS + Windows）：

- **能力零损失**：内嵌终端运行真实 claude CLI，交互体验与命令行完全一致（斜杠命令、权限确认、MCP、文件 watch 等）。
- **新增定时任务能力**：以 headless 模式（`claude -p`）按 cron / 间隔 / 一次性计划后台执行 prompt，结果存历史、桌面通知提醒、可回放完整过程。
- **Skill / MCP / Agent 只读可视化**：扫描本机配置，现代 UI 展示 + 搜索 + 一键插入终端。
- **现代化 UI**：专业双主题（VS Code / GitHub Desktop 质感），深浅主题跟随系统，终端深底常驻；Dashboard 抽屉布局。

## 2. 核心决策记录

| 决策点 | 结论 | 备选与否决理由 |
|---|---|---|
| 产品形态 | 内嵌终端 + 任务面板 + 自动化 + 扩展可视化 | GUI 聊天界面（能力复刻有损、工作量大）被否决 |
| 技术栈 | Electron + React + TypeScript + Vite | Tauri（pty/调度需 Rust 实现，周期长）；纯 Web（无法常驻调度） |
| 定时任务执行 | 后台 headless（`claude -p` + stream-json） | 新终端交互执行（人不在场失去意义） |
| 可视化深度 | 只读展示 + 搜索 + 插入终端 | 增删改管理（写配置风险高、工作量大），架构预留 |
| 会话模型 | 多 tab 多会话，各自独立工作目录 | — |
| 界面语言 | 跟随系统，内置 zh-CN / en（i18next） | — |
| 目标平台 | macOS + Windows（代码不设 Linux 障碍，不打 Linux 包） | — |
| 视觉风格 | 专业双主题（深 GitHub Dark Dimmed / 浅 GitHub Light 质感），单强调色（深色橙 #f78166 / 浅色蓝 #316dca），终端深底常驻 | 深色科技风、极简明亮风被否决 |
| 导航布局 | Dashboard 抽屉式：左栏固定会话列表 + 底部任务摘要卡；任务/扩展为右侧滑出抽屉 | VS Code 活动栏式被否决 |

## 3. 总体架构

```
┌─────────────────────────────────────────────────┐
│ Electron 主进程 (Node.js)                        │
│                                                 │
│  SessionManager   — 管理 N 个 pty 会话生命周期    │
│  TaskScheduler    — cron 解析 + 到点触发         │
│  TaskRunner       — spawn claude -p (headless)  │
│  RegistryScanner  — 扫描 skills/MCP/agents      │
│  TaskStore        — JSON 持久化 (任务+历史)      │
│  NotificationCenter — 系统通知 + 未读角标        │
└──────────────┬──────────────────────────────────┘
               │ IPC (contextBridge)
┌──────────────┴──────────────────────────────────┐
│ 渲染进程 (React 18 + TS + Vite)                  │
│                                                 │
│  左栏: 会话列表 + 下次任务摘要卡                  │
│  顶栏: 终端 tab 栏 + 任务/扩展抽屉入口 + 主题切换  │
│  主区: 终端 (xterm.js) — 深底常驻                 │
│  抽屉: 任务抽屉 / 扩展抽屉 (右侧 420px 滑出)      │
└─────────────────────────────────────────────────┘
```

**技术选型**：Electron 33+ / React 18 / TypeScript / Vite / xterm.js（@xterm/addon-fit）/ node-pty / electron-builder（dmg + nsis）/ i18next / vitest。

### 3.1 终端会话（能力零损失的关键）

- 每个 tab 通过 node-pty 启动**用户默认 shell**，工作目录由建会话时选择，启动后自动执行 `claude`。
- 退出 claude 后回到普通 shell 提示符——与真实终端行为一致。
- **macOS shell**：`$SHELL`（zsh 默认）。
- **Windows shell 按优先级探测**：`pwsh.exe`（PS7+，若装）→ `powershell.exe`（PS 5.1，默认兜底）→ `cmd.exe`；设置里可选 PowerShell / PowerShell 7 / cmd / Git Bash（探测到 `C:\Program Files\Git\bin\bash.exe` 才显示）。
- node-pty 在 Windows 走 ConPTY（Win10 1809+）。

### 3.2 GUI 环境的 PATH 问题（macOS 关键坑）

- macOS GUI 应用不继承登录 shell 的 PATH，可能找不到 `claude`。
- 方案：首次启动用登录 shell（`zsh -l -i -c env`）探测用户环境，缓存 PATH 等变量，供 pty 与 headless 子进程使用。
- Windows GUI 应用继承注册表系统+用户 PATH，直接用 `process.env`；仅保留 `%USERPROFILE%\.local\bin\claude.exe` 显式兜底。
- **claude 探测顺序**：`~/.local/bin/claude(.exe)` → 探测缓存 PATH 中查找 → 找不到时 UI 横幅引导（不阻塞普通 shell 会话）。

## 4. 定时任务

### 4.1 数据模型

```ts
interface ScheduledTask {
  id: string
  name: string
  prompt: string                    // 发给 claude 的任务指令
  cwd: string                       // 工作目录
  schedule: { type: 'cron', expr: string }          // 5 段 cron，本地时区
             | { type: 'interval', minutes: number }
             | { type: 'once', at: string }         // 一次性 ISO 时间
  enabled: boolean
  permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions'
  model?: string                    // 可选覆盖模型
  timeoutMinutes: number            // 默认 30
  notify: { onComplete: boolean; onFailure: boolean }  // 默认都开
  createdAt: string
  lastRun?: RunRecord
  nextRunAt?: string
}

interface RunRecord {
  taskId: string
  startedAt: string
  finishedAt?: string
  status: 'running' | 'success' | 'failed' | 'missed'
  exitCode?: number
  transcriptPath?: string   // stream-json 落盘文件
  resultText?: string       // 最后一条 assistant 文本
}
```

### 4.2 执行流程

1. TaskScheduler 每 30s tick；启动时即计算各任务 nextRunAt。
2. 到点 → 创建 RunRecord(running) → UI 实时显示。
3. TaskRunner spawn：`claude -p "<prompt>" --output-format stream-json --verbose --permission-mode <mode>`，cwd = 任务目录，env = 探测缓存的用户环境。
4. stdout 逐行解析 stream-json：原始事件落盘 `userData/runs/<taskId>/<runId>.jsonl`；提取最后一条 assistant 文本为 resultText。
5. exit 0 → success；非 0 / spawn 失败 → failed；超时（默认 30 分钟，任务级可配）杀进程记 failed。
6. 结束更新 RunRecord → 系统通知（macOS Notification / Windows Toast）→ 左栏任务卡与角标更新。

### 4.3 调度语义

- **错过的任务**：应用未运行期间到点的任务，启动时标记 `missed`（不自动补跑；可手动"立即运行"）。
- **并发防抖**：同一任务上次仍在 running 时不重复触发（记 skipped 日志，不算 failure）；不同任务并行无全局上限。

### 4.4 持久化

- 位置：`userData/store/tasks.json`（定义）+ `store/history.json`（最近 200 条 RunRecord，滚动淘汰）+ `runs/`（transcript jsonl）。
- 仅主进程读写，渲染进程走 IPC；原子写（tmp + rename）。
- store 损坏：启动解析失败 → 备份坏文件 → 重建空 store → 通知用户。

## 5. UI 设计

### 5.1 视觉

- **专业双主题**：浅色 GitHub Light 质感（#fff 底 / #f8f9fb 侧栏 / #316dca 强调）；深色 GitHub Dark Dimmed 质感（#0d1117 终端底 / #161b22 侧栏 / #f78166 强调）。跟随系统，可手动切换。
- **终端深底常驻**：不随 UI 主题反转；按主题切换两套 ANSI 配色。

### 5.2 布局（Dashboard 抽屉式）

```
┌──────────────────────────────────────────────┐
│ 顶栏: [tab: agent-desktop] [tab: my-project] [+]   ⏰任务 🧩扩展 🌓 │
├────────┬─────────────────────────────────────┤
│ 会话列表 │                                     │
│ ● proj │        终端 (xterm.js)                │
│ ● proj │        深底常驻                       │
│ [＋新]  │                                     │
│ ┌────┐ │                                     │
│ │下次 │ │                                     │
│ │任务 │ │                                     │
│ └────┘ │                                     │
└────────┴─────────────────────────────────────┘
      右侧滑出: 任务抽屉 / 扩展抽屉 (420px)
```

- **顶栏**：tab 栏（工作目录名 + 状态点）＋ 任务/扩展入口（角标）＋ 主题切换。
- **左栏**：会话列表（点击切换 / × 关闭 / 右键菜单：重命名、复制路径、关闭）＋ 下次任务摘要卡（倒计时，点击开任务抽屉）＋ 新会话按钮。
- **任务抽屉**：任务列表（启用开关、下次运行、最近状态）→ 任务详情（编辑表单 + 运行历史时间线 + transcript 回放，jsonl 渲染为对话流）。新任务表单：名称 / prompt / 目录选择 / 调度类型 / 权限模式（含风险提示）/ 通知开关 / 超时。
- **扩展抽屉**：三分段——Skills / MCP / Agents，搜索框，点击条目插入终端输入。

### 5.3 交互

- 快捷键：⌘/Ctrl+T 新 tab、⌘/Ctrl+W 关 tab、⌘/Ctrl+1-9 切换。
- 窗口关闭：默认退出；设置可选最小化到托盘（托盘菜单：显示主窗 / 新任务 / 退出）。

### 5.4 i18n

i18next，zh-CN / en 两套资源，跟随 `app.getLocale()`，设置中可手动切换。

## 6. RegistryScanner（只读）

- **Skills**：`~/.claude/skills/*/SKILL.md` + `~/.claude/plugins/cache/**/skills/*/SKILL.md` + 项目 `.claude/skills/`（解析 frontmatter name/description，标注来源）。
- **MCP**：项目 `.mcp.json` + `~/.claude.json` 注册的 servers（仅配置元数据：名称、传输类型、命令；**不连接**，显示"已配置"而非连接状态）。
- **Agents**：`~/.claude/agents/*.md` + 项目 `.claude/agents/*.md`（frontmatter: name/description/tools）。
- 打开抽屉时扫描（缓存 60s）；异常（目录缺失/JSON 损坏）降级空列表 + 提示条。

## 7. 错误处理

| 场景 | 处理 |
|---|---|
| claude 未找到 | 启动横幅引导（显示探测路径列表），不阻塞 shell 会话 |
| pty 崩溃/会话退出 | tab 保留退出输出，状态点变灰，可一键重启 |
| headless 超时 | 默认 30 分钟杀进程记 failed |
| store 损坏 | 备份 + 重建空 store + 通知 |
| 扫描异常 | 降级空列表 + 提示条 |

## 8. 测试策略

- **单元（vitest）**：nextRunAt 计算与错过判定（cron/interval/once）、stream-json 解析（多轮 tool_use/文本提取）、原子写 store、frontmatter 解析（fixture 目录）。
- **集成（vitest，真实 spawn）**：TaskRunner 用 `echo` 假 CLI（可执行脚本输出预置 stream-json）验证状态机 running→success/failed/timeout。
- **手动/E2E 冒烟**：打包后真实跑 `claude -p "say hi"` 验证 PATH 探测与通知。

## 9. 范围外（明确不做）

MCP/skill 增删改管理、任务编排/依赖链、云端同步、自动更新、Linux 打包（代码不故意留平台障碍）。架构上为可视化管理能力预留接口（扫描器输出统一 schema）。
