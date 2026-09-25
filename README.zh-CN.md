[English](./README.md) | 简体中文

# AgentDesk

> Claude Code 的桌面伴侣 —— 多会话终端 · 定时任务 · Extensions 视图

Claude Code CLI 的 Electron 桌面封装：在真实终端里与 Claude Code 交互，把重复性工作交给定时任务自动执行，运行结果与完整 transcript 留档可查。

## 功能

### 终端会话

- 基于 node-pty + xterm.js 的真实终端，完整保留 Claude Code 的交互式 UI
- 多会话管理：侧边栏新建 / 重命名 / 关闭；窗口 resize 自适应（rAF 合帧，高吞吐输出不卡顿）
- 工作目录经原生目录选择器选定，通过路径校验后才创建会话

### 定时任务

- 三种调度：固定间隔（interval）/ cron 表达式 / 一次性（once）
- 每任务独立配置：prompt、工作目录、模型、权限模式、超时、完成/失败通知
- 执行结果通过系统通知提醒；运行历史保留最近 200 条，每次运行的完整 transcript 可回看
- 首页展示下一个即将执行的任务

### Extensions

- 扫描 `~/.claude` 下已安装的 Skills / Agents / MCP servers
- 一键插入终端复用；扫描不跟进符号链接，防止恶意插件投毒

### 其他

- 主题切换；界面语言：简体中文 / English / 跟随系统
- 系统托盘、原生菜单、系统通知
- API 环境变量透传（如 `ANTHROPIC_BASE_URL`、`AWS_REGION`），兼容中转与 Bedrock/Vertex 部署

## 安全设计

桌面端将 CLI 子进程视为能力边界，逐层加固：

| 层 | 措施 |
|----|------|
| IPC | 通道名集中枚举管理，全部输入经 zod 校验，handler 层测试全覆盖 |
| 文件系统 | 会话与 transcript 路径限定在允许根内，拒绝路径穿越与目录替换 |
| 进程环境 | spawn 前过滤密钥类环境变量，避免 shell 配置中的 API key 泄入子进程 |
| 注册表扫描 | `lstat` 不跟进 symlink，防恶意内容借道注入 |

## 技术栈

| 层 | 选型 |
|----|------|
| 框架 | Electron 44 + electron-vite 5 |
| UI | React 19 + TypeScript 5.9 |
| 状态 | zustand 5 |
| 终端 | node-pty + @xterm/xterm 6 |
| 边界校验 | zod 4 |
| 调度 | cron-parser |
| i18n | i18next + react-i18next |
| 测试 | vitest + Testing Library |

## 快速开始

前置要求：

- macOS 或 Windows
- Node.js ≥ 20.19（推荐 22+）
- Claude Code CLI 已安装并完成登录：

  ```bash
  npm install -g @anthropic-ai/claude-code
  claude   # 首次运行完成登录
  ```

- macOS 若触发 node-pty 源码编译，需 Xcode Command Line Tools（`xcode-select --install`）

```bash
git clone https://github.com/stushi-oss/agent-desktop.git
cd agent-desktop
npm install
npm run dev
```

## 常用脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发模式（HMR） |
| `npm run build` | 构建产物到 `out/` |
| `npm test` | 运行全部测试（vitest） |
| `npm run typecheck` | node + web 两套 tsconfig 类型检查 |
| `npm run dist:mac` | 打包 macOS DMG |
| `npm run dist:win` | 打包 Windows NSIS 安装包 |

## 项目结构

```
src/
├── main/            # Electron 主进程
│   ├── session/     #   PTY 会话生命周期
│   ├── tasks/       #   定时任务调度与运行
│   ├── registry/    #   ~/.claude Skills / Agents / MCP 扫描
│   ├── store/       #   持久化（原子写 + 历史裁剪）
│   └── ipc.ts       #   全部 IPC handler（zod 边界）
├── renderer/        # React 渲染进程
│   ├── components/  #   终端 / 任务 / Extensions / 设置
│   ├── stores/      #   zustand（会话、任务、设置、toast）
│   └── i18n/        #   zh-CN / en
└── shared/          # 双进程共享：channels / schemas / security / streamEvents
```

## 许可证

[MIT](./LICENSE)
