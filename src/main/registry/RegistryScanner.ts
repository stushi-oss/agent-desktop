import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
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

/**
 * Node 实现：用 lstatSync（不 follow symlink）防止恶意插件用 symlink
 * 引诱 scanner 读 attacker-controlled 文件 → Extensions 一键插入 shell。
 *  - isDir: symlink 一律视为 not-dir（walk 不跟进）
 *  - read:  symlink 一律返回 null（不读 symlink 指向的内容）
 */
export function createNodeScannerFs(): ScannerFs {
  return {
    exists: existsSync,
    isDir: (p) => { try { return lstatSync(p).isDirectory() } catch { return false } },
    listDir: (p) => { try { return readdirSync(p) } catch { return [] } },
    read: (p) => {
      try {
        if (lstatSync(p).isSymbolicLink()) return null
        return readFileSync(p, 'utf8')
      } catch { return null }
    },
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

export function scanSkills(fs: ScannerFs, home: string, project?: string): SkillInfo[] {
  const out: SkillInfo[] = []
  scanSkillDirs(fs, fs.join(home, '.claude', 'skills'), 'user', out)
  if (project && project !== home) scanSkillDirs(fs, fs.join(project, '.claude', 'skills'), 'project', out)
  const pluginDirs: string[] = []
  collectPluginSkillsDirs(fs, fs.join(home, '.claude', 'plugins', 'cache'), 4, pluginDirs)
  for (const d of pluginDirs) scanSkillDirs(fs, d, 'plugin', out)
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function scanAgents(fs: ScannerFs, home: string, project?: string): AgentInfo[] {
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
  if (project && project !== home) scan(fs.join(project, '.claude', 'agents'), 'project')
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

interface RawMcpServer { type?: string; command?: string; url?: string }

export function scanMcp(fs: ScannerFs, home: string, project?: string): McpServerInfo[] {
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
  if (project && project !== home) readConfig(fs.join(project, '.mcp.json'), 'project')
  return out
}

export function scanRegistry(fs: ScannerFs, home: string, project: string): RegistrySnapshot {
  // project === home（首启无会话时 activeCwd=home）会使用户级条目以 user+project
  // 双重出现——跳过 project 维度
  const proj = project === home ? undefined : project
  return {
    scannedAt: new Date().toISOString(),
    skills: scanSkills(fs, home, proj),
    mcpServers: scanMcp(fs, home, proj),
    agents: scanAgents(fs, home, proj)
  }
}
