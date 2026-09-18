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
