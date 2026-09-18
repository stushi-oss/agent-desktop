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
