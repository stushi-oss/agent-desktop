// src/shared/security.ts
import { z } from 'zod'
import { resolve } from 'node:path'
import { lstatSync } from 'node:fs'

export class SecurityError extends Error {
  constructor(msg: string) {
    super(`security: ${msg}`)
    this.name = 'SecurityError'
  }
}

export function safeAbsPath(p: unknown): string {
  if (typeof p !== 'string' || !p) {
    throw new SecurityError('path must be non-empty string')
  }
  const resolved = resolve(p)
  if (!resolved.startsWith('/')) {
    throw new SecurityError('path must be absolute')
  }
  return resolved
}

export function pathWithinParents(p: string, parents: string[]): void {
  const resolved = resolve(p)
  for (const parent of parents) {
    const pr = resolve(parent)
    if (resolved.startsWith(pr + '/') || resolved === pr) return
  }
  throw new SecurityError(`path not under any of: ${parents.join(', ')}`)
}

export function assertRealDir(p: string): void {
  const stat = lstatSync(p)
  if (stat.isSymbolicLink()) {
    throw new SecurityError('symlinks not allowed')
  }
  if (!stat.isDirectory()) {
    throw new SecurityError('not a directory')
  }
}

const SENSITIVE_ENV_PATTERNS = [
  /^ANTHROPIC_API_KEY$/i,
  /^ANTHROPIC_AUTH_TOKEN$/i,
  /^AWS_ACCESS_KEY_ID$/i,
  /^AWS_SECRET_ACCESS_KEY$/i,
  /^AWS_SESSION_TOKEN$/i,
  /^GITHUB_TOKEN$/i,
  /^OPENAI_API_KEY$/i,
  /_TOKEN$/i,
  /_KEY$/i,
  /_SECRET$/i,
  /_PASSWORD$/i,
  /PRIVATE/i
]

/** 显式允许的 ANTHROPIC/AWS non-secret 配置（即使前缀匹配也不过滤） */
const ALLOWED_NON_SECRET_OVERRIDES: ReadonlySet<string> = new Set([
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_CUSTOM_HEADERS_PROVIDER',
  'AWS_REGION',
  'AWS_PROFILE',
  'AWS_DEFAULT_REGION',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX'
])

export function filterSensitiveEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(env)) {
    if (ALLOWED_NON_SECRET_OVERRIDES.has(k)) {
      out[k] = v
      continue
    }
    if (SENSITIVE_ENV_PATTERNS.some((re) => re.test(k))) continue
    out[k] = v
  }
  return out
}

export const CwdSchema = z.string().min(1).max(4096)

export const TranscriptRequestSchema = z.object({
  taskId: z.string().uuid(),
  runId: z.string().uuid()
})
