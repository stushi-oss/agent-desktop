import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
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

  it('project === home 时不重复扫描 project 维度（首启场景）', () => {
    write(home, '.claude/skills/only/SKILL.md', SKILL_MD)
    const snap = scanRegistry(createNodeScannerFs(), home, home)
    expect(snap.skills).toEqual([{ name: 'my-skill', description: 'Does something useful', source: 'user' }])
  })

  it('SKILL.md 缺 frontmatter 时 name 回退目录名', () => {
    write(home, '.claude/skills/bare/SKILL.md', 'just body')
    const snap = scanRegistry(createNodeScannerFs(), home, project)
    expect(snap.skills).toEqual([{ name: 'bare', description: '', source: 'user' }])
  })

  it('symlink 目录下的 SKILL.md 不被扫描（plugin cache 攻击面防护）', () => {
    // 攻击场景：恶意插件在 ~/.claude/plugins/cache 下放 symlink 引诱 scanner
    // 读 attacker-controlled 文件 → Extensions 一键插入 shell
    write(home, '.claude/skills/real-skill/SKILL.md',
      '---\nname: real-skill\ndescription: from real dir\n---\n')

    // 把 attacker-controlled 真实目录放在 home 之外（不是 home 子树），用 symlink 引诱进去
    const attackerDir = mkdtempSync(join(tmpdir(), 'attacker-'))
    mkdirSync(join(attackerDir, 'evil-skill'), { recursive: true })
    writeFileSync(join(attackerDir, 'evil-skill', 'SKILL.md'),
      '---\nname: evil-skill\ndescription: from symlink target\n---\n', 'utf8')

    // 在 ~/.claude/skills 下放置 symlink → attacker dir
    const linkPath = join(home, '.claude', 'skills', 'evil-link')
    mkdirSync(join(home, '.claude', 'skills'), { recursive: true })
    symlinkSync(attackerDir, linkPath)

    const snap = scanRegistry(createNodeScannerFs(), home, project)
    expect(snap.skills.map(s => s.name)).toEqual(['real-skill'])
    // 关键断言：通过 symlink 引入的 skill 一定不能出现
    expect(snap.skills.find(s => s.name === 'evil-skill')).toBeUndefined()
  })

  it('plugins/cache 下 symlink 子目录不被 walk 进去', () => {
    // 攻击场景：~/.claude/plugins/cache/official/evil → /tmp/attacker
    write(home, '.claude/plugins/cache/official/good/1.0/skills/good-skill/SKILL.md',
      '---\nname: good-skill\ndescription: legitimate\n---\n')

    const attackerDir = mkdtempSync(join(tmpdir(), 'attacker-'))
    mkdirSync(join(attackerDir, 'skills', 'evil-skill'), { recursive: true })
    writeFileSync(join(attackerDir, 'skills', 'evil-skill', 'SKILL.md'),
      '---\nname: evil-skill\ndescription: smuggled\n---\n', 'utf8')

    // 在 plugins/cache 下放 symlink 引诱 walk 进去
    const linkPath = join(home, '.claude', 'plugins', 'cache', 'official', 'evil')
    mkdirSync(join(home, '.claude', 'plugins', 'cache', 'official'), { recursive: true })
    symlinkSync(attackerDir, linkPath)

    const snap = scanRegistry(createNodeScannerFs(), home, project)
    expect(snap.skills.map(s => s.name)).toEqual(['good-skill'])
    expect(snap.skills.find(s => s.name === 'evil-skill')).toBeUndefined()
  })

  it('agents 目录下的 symlink .md 文件不被读取', () => {
    // 攻击场景：~/.claude/agents/researcher.md → /tmp/attacker/agent.md
    write(home, '.claude/agents/legit.md',
      '---\nname: legit\ndescription: real agent\n---\n')

    const attackerDir = mkdtempSync(join(tmpdir(), 'attacker-'))
    writeFileSync(join(attackerDir, 'agent.md'),
      '---\nname: evil-agent\ndescription: smuggled\n---\n', 'utf8')

    const linkPath = join(home, '.claude', 'agents', 'evil.md')
    mkdirSync(join(home, '.claude', 'agents'), { recursive: true })
    symlinkSync(join(attackerDir, 'agent.md'), linkPath)

    const snap = scanRegistry(createNodeScannerFs(), home, project)
    expect(snap.agents.map(a => a.name).sort()).toEqual(['legit'])
    expect(snap.agents.find(a => a.name === 'evil-agent')).toBeUndefined()
  })
})
