import { describe, it, expect, beforeAll } from 'vitest'
import { chmodSync, existsSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startRun, type RunContext } from '@main/tasks/TaskRunner'
import type { ScheduledTask } from '@shared/types'

const FIXTURE = join(__dirname, '../fixtures/fake-claude.sh')

beforeAll(() => chmodSync(FIXTURE, 0o755))

const task = (over: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id: 't1', name: 'n', prompt: 'do it', cwd: tmpdir(),
  schedule: { type: 'interval', minutes: 5 }, enabled: true,
  permissionMode: 'default', timeoutMinutes: 30,
  notify: { onComplete: true, onFailure: true }, createdAt: '2026-01-01T00:00:00.000Z', ...over
})

// 注意：helper 命名为 makeCtx——若叫 ctx，`const { ctx } = ctx()` 会因 TDZ 报 Cannot access before initialization
function makeCtx(env: NodeJS.ProcessEnv = {}): { ctx: RunContext; runsDir: string } {
  const runsDir = mkdtempSync(join(tmpdir(), 'ad-runs-'))
  return { ctx: { claudePath: FIXTURE, env: { ...process.env, ...env }, runsDir }, runsDir }
}

describe('TaskRunner（真实 spawn 假 CLI）', () => {
  it('成功：status=success、exitCode=0、resultText、transcript 落盘', async () => {
    const { ctx, runsDir } = makeCtx()
    const handle = startRun(task(), ctx)
    const rec = await handle.promise
    expect(rec.status).toBe('success')
    expect(rec.exitCode).toBe(0)
    expect(rec.resultText).toBe('fake answer')
    expect(rec.transcriptPath).toBeDefined()
    expect(existsSync(rec.transcriptPath!)).toBe(true)
    expect(rec.transcriptPath!.startsWith(runsDir)).toBe(true)
    const lines = readFileSync(rec.transcriptPath!, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(JSON.parse(lines[0]).type).toBe('system')
  })

  it('失败：EXIT_CODE=1 → status=failed', async () => {
    const { ctx } = makeCtx({ EXIT_CODE: '1' })
    const rec = await startRun(task(), ctx).promise
    expect(rec.status).toBe('failed')
    expect(rec.exitCode).toBe(1)
  })

  it('超时：timeoutMs 后杀进程 → failed + error 含 timeout', async () => {
    const { ctx } = makeCtx({ SLOW_SEC: '3' })
    const handle = startRun(task({ timeoutMinutes: 30 }), ctx, { timeoutMs: 300 })
    const rec = await handle.promise
    expect(rec.status).toBe('failed')
    expect(rec.error).toContain('timeout')
  })

  it('spawn 失败（不存在的 claudePath）→ failed + error', async () => {
    const { ctx } = makeCtx()
    const rec = await startRun(task(), { ...ctx, claudePath: '/nonexistent/claude' }, {}).promise
    expect(rec.status).toBe('failed')
    expect(rec.error).toBeTruthy()
  })
})
