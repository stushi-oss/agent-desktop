import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { posix as posixPath, win32 as win32Path } from 'node:path'

/** 按目标平台选择路径拼接规则（纯函数需与宿主 OS 解耦） */
function pathFor(platform: NodeJS.Platform) {
  return platform === 'win32' ? win32Path : posixPath
}

/** GUI 进程环境探测：macOS 需要登录 shell 的 PATH；其他平台直接用 process.env */
export function buildProbeCommand(
  platform: NodeJS.Platform,
  shell: string | undefined
): { file: string; args: string[] } | null {
  if (platform !== 'darwin' || !shell) return null
  return { file: shell, args: ['-l', '-i', '-c', 'env'] }
}

export function parseEnvOutput(output: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const line of output.split('\n')) {
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1)
    if (key && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) env[key] = value
  }
  return env
}

/** 异步探测用户登录环境（macOS）；失败或非 macOS 返回 null */
export function probeUserEnv(
  platform: NodeJS.Platform,
  shell: string | undefined,
  timeoutMs = 5000
): Promise<NodeJS.ProcessEnv | null> {
  const cmd = buildProbeCommand(platform, shell)
  if (!cmd) return Promise.resolve(null)
  return new Promise((resolve) => {
    // 兜底竞速：execFile 的 timeout 只 SIGTERM shell 本身，'close' 还要等 stdout 管道关闭——
    // 若 rc 文件 spawn 了继承 stdout 的守护进程（ssh-agent 等），回调永不触发，到点强制 resolve
    const timer = setTimeout(() => resolve(null), timeoutMs + 1000)
    const child = execFile(
      cmd.file,
      cmd.args,
      { timeout: timeoutMs, env: { TERM: 'dumb' } as NodeJS.ProcessEnv, windowsHide: true },
      (err, stdout) => {
        clearTimeout(timer)
        if (err && !stdout) {
          console.warn('[env] probe failed:', err instanceof Error ? err.message : err)
          resolve(null)
          return
        }
        const probed = parseEnvOutput(stdout)
        resolve(Object.keys(probed).length > 0 ? probed : null)
      }
    )
    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
  })
}

/** 合成会话/子进程环境：探测结果优先，回退 GUI 进程环境 */
export function mergedEnv(base: NodeJS.ProcessEnv, probed: NodeJS.ProcessEnv | null): NodeJS.ProcessEnv {
  if (!probed) return { ...base }
  return { ...base, ...probed, PATH: probed.PATH ?? base.PATH ?? '' }
}

export function resolveClaudePath(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  exists: (p: string) => boolean = existsSync
): string | null {
  const home = env.HOME ?? env.USERPROFILE
  if (!home) return null
  const exe = platform === 'win32' ? 'claude.exe' : 'claude'
  const sep = platform === 'win32' ? ';' : ':'
  const { join } = pathFor(platform)
  const candidates = [join(home, '.local', 'bin', exe)]
  for (const dir of (env.PATH ?? '').split(sep)) {
    if (dir) candidates.push(join(dir, exe))
  }
  return candidates.find((p) => exists(p)) ?? null
}

/** 供设置页展示的探测候选（去重） */
export function claudeCandidates(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const home = env.HOME ?? env.USERPROFILE
  const exe = platform === 'win32' ? 'claude.exe' : 'claude'
  const sep = platform === 'win32' ? ';' : ':'
  const { join } = pathFor(platform)
  const out: string[] = []
  if (home) out.push(join(home, '.local', 'bin', exe))
  for (const dir of (env.PATH ?? '').split(sep)) if (dir) out.push(join(dir, exe))
  return [...new Set(out)]
}
