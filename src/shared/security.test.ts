import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  safeAbsPath, pathWithinParents, assertRealDir,
  filterSensitiveEnv, CwdSchema, TranscriptRequestSchema, SecurityError
} from './security'

describe('safeAbsPath', () => {
  it('接受绝对路径', () => {
    expect(safeAbsPath('/tmp/foo')).toBe('/tmp/foo')
  })
  it('拒绝空字符串', () => {
    expect(() => safeAbsPath('')).toThrow(SecurityError)
  })
  it('拒绝非字符串', () => {
    expect(() => safeAbsPath(123)).toThrow(SecurityError)
    expect(() => safeAbsPath(null)).toThrow(SecurityError)
  })
  it('解析相对路径为绝对路径', () => {
    const r = safeAbsPath('relative/foo')
    expect(r.startsWith('/')).toBe(true)
  })
})

describe('pathWithinParents', () => {
  it('白名单内路径通过', () => {
    expect(() => pathWithinParents('/home/user/Downloads', ['/home/user'])).not.toThrow()
  })
  it('白名单外路径拒绝', () => {
    expect(() => pathWithinParents('/etc/passwd', ['/home/user'])).toThrow(SecurityError)
  })
  it('白名单边界等于父路径通过', () => {
    expect(() => pathWithinParents('/home/user', ['/home/user'])).not.toThrow()
  })
})

describe('assertRealDir', () => {
  let tmp: string
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'sec-')) })
  it('真实目录通过', () => {
    expect(() => assertRealDir(tmp)).not.toThrow()
  })
  it('symlink 拒绝', () => {
    const link = join(tmpdir(), `sec-symlink-${Date.now()}`)
    symlinkSync(tmp, link)
    expect(() => assertRealDir(link)).toThrow(SecurityError)
  })
  it('文件拒绝（不是目录）', () => {
    const f = join(tmp, 'file.txt')
    writeFileSync(f, 'x')
    expect(() => assertRealDir(f)).toThrow(SecurityError)
  })
})

describe('filterSensitiveEnv', () => {
  it('ANTHROPIC_API_KEY 被过滤', () => {
    const out = filterSensitiveEnv({ ANTHROPIC_API_KEY: 'secret', PATH: '/usr/bin' })
    expect(out).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(out.PATH).toBe('/usr/bin')
  })
  it('*TOKEN 后缀被过滤', () => {
    const out = filterSensitiveEnv({ GITHUB_TOKEN: 'x', MY_TOKEN: 'y', HOME: '/home/u' })
    expect(out).not.toHaveProperty('GITHUB_TOKEN')
    expect(out).not.toHaveProperty('MY_TOKEN')
    expect(out.HOME).toBe('/home/u')
  })
  it('*KEY / *SECRET / *PASSWORD 被过滤', () => {
    const out = filterSensitiveEnv({ AWS_SECRET_KEY: 'k', DB_PASSWORD: 'p', LANG: 'en' })
    expect(out).not.toHaveProperty('AWS_SECRET_KEY')
    expect(out).not.toHaveProperty('DB_PASSWORD')
    expect(out.LANG).toBe('en')
  })
  it('大小写不敏感', () => {
    const out = filterSensitiveEnv({ 'anthropic_api_key': 'x', 'PATH': '/y' })
    expect(out).not.toHaveProperty('anthropic_api_key')
    expect(out.PATH).toBe('/y')
  })
  it('ANTHROPIC_BASE_URL / ANTHROPIC_MODEL 保留（Bedrock / Vertex 配置）', () => {
    const out = filterSensitiveEnv({
      ANTHROPIC_BASE_URL: 'https://bedrock-runtime.us-east-1.amazonaws.com',
      ANTHROPIC_MODEL: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
      ANTHROPIC_API_KEY: 'leaked',
      PATH: '/usr/bin'
    })
    expect(out.ANTHROPIC_BASE_URL).toBe('https://bedrock-runtime.us-east-1.amazonaws.com')
    expect(out.ANTHROPIC_MODEL).toBe('us.anthropic.claude-sonnet-4-20250514-v1:0')
    expect(out).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(out.PATH).toBe('/usr/bin')
  })
  it('AWS_REGION / AWS_PROFILE 保留（非 secret）', () => {
    const out = filterSensitiveEnv({
      AWS_REGION: 'us-east-1',
      AWS_PROFILE: 'dev',
      AWS_ACCESS_KEY_ID: 'AKIA...',
      AWS_SECRET_ACCESS_KEY: 'secret',
      HOME: '/home/u'
    })
    expect(out.AWS_REGION).toBe('us-east-1')
    expect(out.AWS_PROFILE).toBe('dev')
    expect(out).not.toHaveProperty('AWS_ACCESS_KEY_ID')
    expect(out).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
    expect(out.HOME).toBe('/home/u')
  })
})

describe('CwdSchema', () => {
  it('非空字符串通过', () => {
    expect(() => CwdSchema.parse('/home/user')).not.toThrow()
  })
  it('空字符串拒绝', () => {
    expect(() => CwdSchema.parse('')).toThrow()
  })
  it('非字符串拒绝', () => {
    expect(() => CwdSchema.parse(123)).toThrow()
  })
  it('超长字符串拒绝（>4096）', () => {
    expect(() => CwdSchema.parse('a'.repeat(5000))).toThrow()
  })
})

describe('TranscriptRequestSchema', () => {
  it('合法 uuid 通过', () => {
    expect(() => TranscriptRequestSchema.parse({
      taskId: '11111111-1111-4111-8111-111111111111',
      runId: '22222222-2222-4222-8222-222222222222'
    })).not.toThrow()
  })
  it('非法 uuid 拒绝', () => {
    expect(() => TranscriptRequestSchema.parse({ taskId: 'x', runId: 'y' })).toThrow()
  })
})
