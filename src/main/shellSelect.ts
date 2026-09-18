export interface ShellChoice {
  file: string
  args: string[]
  label: string
}

const PWSH = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'

export function defaultShellFor(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): ShellChoice {
  if (platform === 'win32') {
    return pickWindowsShell(() => false, env.ComSpec ?? 'C:\\Windows\\system32\\cmd.exe')
  }
  const file = env.SHELL ?? (platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  return { file, args: ['-l'], label: file.split('/').pop() ?? file }
}

/**
 * Windows shell 探测。exists 回调由装配层实现（扫描常见安装位置），
 * 保证本函数纯逻辑可测。
 */
export function pickWindowsShell(exists: (absPath: string) => boolean, comspec: string): ShellChoice {
  if (exists(PWSH)) return { file: PWSH, args: [], label: 'pwsh' }
  if (exists(POWERSHELL)) return { file: POWERSHELL, args: [], label: 'powershell' }
  return { file: comspec, args: [], label: 'cmd' }
}

/** 装配层：在真实文件系统上解析 Windows shell */
export function resolveWindowsShell(env: NodeJS.ProcessEnv, existsSyncFn: (p: string) => boolean): ShellChoice {
  return pickWindowsShell((p) => existsSyncFn(p), env.ComSpec ?? 'C:\\Windows\\system32\\cmd.exe')
}
