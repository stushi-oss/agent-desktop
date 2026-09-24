import { describe, it, expect } from 'vitest'
import { buildProbeCommand, claudeCandidates, mergedEnv, parseEnvOutput, resolveClaudePath } from './env'
import { filterSensitiveEnv } from '@shared/security'

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

describe('mergedEnv', () => {
  it('probed 为 null 时返回 base 的副本', () => {
    const base = { PATH: '/usr/bin', HOME: '/Users/u' }
    const merged = mergedEnv(base, null)
    expect(merged).toEqual(base)
    expect(merged).not.toBe(base)
  })
  it('probed 有 PATH 时 probed 优先覆盖，PATH 取 probed.PATH', () => {
    const merged = mergedEnv(
      { PATH: '/usr/bin', HOME: '/Users/u' },
      { PATH: '/opt/homebrew/bin', FOO: 'bar' }
    )
    expect(merged.PATH).toBe('/opt/homebrew/bin')
    expect(merged.FOO).toBe('bar')
    expect(merged.HOME).toBe('/Users/u')
  })
  it('probed 无 PATH 时回退 base.PATH', () => {
    const merged = mergedEnv({ PATH: '/usr/bin', HOME: '/Users/u' }, { FOO: 'bar' })
    expect(merged.PATH).toBe('/usr/bin')
    expect(merged.FOO).toBe('bar')
  })
})

describe('claudeCandidates', () => {
  it('home 候选排首位，PATH 目录依序跟随', () => {
    const list = claudeCandidates({ HOME: '/Users/u', PATH: '/usr/bin:/opt/homebrew/bin' }, 'darwin')
    expect(list).toEqual(['/Users/u/.local/bin/claude', '/usr/bin/claude', '/opt/homebrew/bin/claude'])
  })
  it('PATH 重复目录及与 home 重复的候选去重', () => {
    const list = claudeCandidates({ HOME: '/Users/u', PATH: '/Users/u/.local/bin:/usr/bin:/usr/bin' }, 'darwin')
    expect(list).toEqual(['/Users/u/.local/bin/claude', '/usr/bin/claude'])
  })
})

describe('probeUserEnv + filterSensitiveEnv', () => {
  it('probeUserEnv 输出应被 filterSensitiveEnv 过滤 ANTHROPIC_* secrets', () => {
    // 直接对 filterSensitiveEnv 行为断言——它就是 probeUserEnv 用来清洗 stdout 解析结果的工具。
    // 实际集成（spawn login shell → parseEnvOutput → filterSensitiveEnv）见 probeUserEnv 异步路径。
    const rawProbe = { ANTHROPIC_API_KEY: 'sk-...', PATH: '/usr/bin', HOME: '/home/u' }
    const filtered = filterSensitiveEnv(rawProbe)
    expect(filtered).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(filtered.PATH).toBe('/usr/bin')
    expect(filtered.HOME).toBe('/home/u')
  })
})

describe('mergedEnv + filterSensitiveEnv', () => {
  it('mergedEnv 不暴露 probed 的敏感 env vars', () => {
    const probed = { ANTHROPIC_API_KEY: 'leaked', AWS_SECRET_KEY: 'k', LANG: 'en' }
    const result = mergedEnv({ LANG: 'xx' }, probed)
    expect(result).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(result).not.toHaveProperty('AWS_SECRET_KEY')
    expect(result.LANG).toBe('en')  // probed 覆盖 base，但非敏感
  })

  it('mergedEnv 无 probed 时返回 base', () => {
    expect(mergedEnv({ X: 'y' }, null)).toEqual({ X: 'y' })
  })

  it('mergedEnv 仍正确合成 PATH（probed 优先，回退 base）', () => {
    const merged = mergedEnv(
      { PATH: '/usr/bin', HOME: '/Users/u' },
      { PATH: '/opt/homebrew/bin', ANTHROPIC_API_KEY: 'leak' }
    )
    expect(merged.PATH).toBe('/opt/homebrew/bin')
    expect(merged.HOME).toBe('/Users/u')
    expect(merged).not.toHaveProperty('ANTHROPIC_API_KEY')
  })
})
