English | [简体中文](./README.zh-CN.md)

# AgentDesk

> A desktop companion for Claude Code — multi-session terminals · scheduled tasks · Extensions view

An Electron desktop wrapper for the Claude Code CLI: work with Claude Code in real terminals, hand repetitive work to scheduled tasks, and keep every run's result and full transcript on record.

## Features

### Terminal Sessions

- Real terminals powered by node-pty + xterm.js, fully preserving Claude Code's interactive UI
- Multi-session management: create / rename / close from the sidebar; resize-aware rendering (rAF-coalesced, stays smooth under high-throughput output)
- Working directories picked via the native directory dialog and validated before a session is created

### Scheduled Tasks

- Three schedule types: fixed interval / cron expression / one-shot
- Per-task configuration: prompt, working directory, model, permission mode, timeout, success/failure notifications
- Results delivered through system notifications; run history keeps the most recent 200 entries, each run's full transcript replayable
- Home view shows the next task about to fire

### Extensions

- Scans installed Skills / Agents / MCP servers under `~/.claude`
- Insert into the terminal with one click; the scanner never follows symlinks, blocking poisoned plugin content

### More

- Theme switching; UI language: 简体中文 / English / follow system
- System tray, native menu, system notifications
- API environment variable passthrough (e.g. `ANTHROPIC_BASE_URL`, `AWS_REGION`) for relay and Bedrock/Vertex deployments

## Security Design

The desktop treats the CLI subprocess as a capability boundary and hardens every layer:

| Layer | Measure |
|--------|---------|
| IPC | Channel names centrally enumerated; every input validated with zod; full handler-level test coverage |
| Filesystem | Session and transcript paths confined to allowed roots; path traversal and directory substitution rejected |
| Process env | Secret-class environment variables filtered before spawn, keeping API keys from shell configs out of child processes |
| Registry scan | `lstat` without following symlinks, blocking malicious content injection |

## Tech Stack

| Layer | Choice |
|--------|--------|
| Framework | Electron 44 + electron-vite 5 |
| UI | React 19 + TypeScript 5.9 |
| State | zustand 5 |
| Terminal | node-pty + @xterm/xterm 6 |
| Boundary validation | zod 4 |
| Scheduling | cron-parser |
| i18n | i18next + react-i18next |
| Testing | vitest + Testing Library |

## Getting Started

Prerequisites:

- macOS or Windows
- Node.js ≥ 20.19 (22+ recommended)
- Claude Code CLI installed and logged in:

  ```bash
  npm install -g @anthropic-ai/claude-code
  claude   # complete login on first run
  ```

- If macOS triggers a source build of node-pty, Xcode Command Line Tools are required (`xcode-select --install`)

```bash
git clone https://github.com/stushi-oss/agent-desktop.git
cd agent-desktop
npm install
npm run dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev mode (HMR) |
| `npm run build` | Build artifacts to `out/` |
| `npm test` | Run the full test suite (vitest) |
| `npm run typecheck` | Type-check both node and web tsconfigs |
| `npm run dist:mac` | Package macOS DMG |
| `npm run dist:win` | Package Windows NSIS installer |

## Project Structure

```
src/
├── main/            # Electron main process
│   ├── session/     #   PTY session lifecycle
│   ├── tasks/       #   scheduled task runner & service
│   ├── registry/    #   ~/.claude Skills / Agents / MCP scanning
│   ├── store/       #   persistence (atomic writes + history trimming)
│   └── ipc.ts       #   all IPC handlers (zod boundary)
├── renderer/        # React renderer
│   ├── components/  #   terminal / tasks / extensions / settings
│   ├── stores/      #   zustand (sessions, tasks, settings, toasts)
│   └── i18n/        #   zh-CN / en
└── shared/          # shared across processes: channels / schemas / security / streamEvents
```

## License

[MIT](./LICENSE)
