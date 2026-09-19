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
// 单一事实来源：zod schema 在 ./schemas.ts；此处 re-export 保持向后兼容。
// zod 运行时校验：setSettings handler 接 patch 时 parse。
export type { AppSettings } from './schemas'

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
