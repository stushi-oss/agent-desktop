import { describe, it, expect } from 'vitest'
import { defaultShellFor, pickWindowsShell } from './shellSelect'

describe('defaultShellFor', () => {
  it('darwin 用 $SHELL，缺省 zsh', () => {
    expect(defaultShellFor('darwin', { SHELL: '/bin/zsh' })).toEqual({ file: '/bin/zsh', args: ['-l'], label: 'zsh' })
    expect(defaultShellFor('darwin', {})).toEqual({ file: '/bin/zsh', args: ['-l'], label: 'zsh' })
  })
  it('linux 用 $SHELL，缺省 bash', () => {
    expect(defaultShellFor('linux', {})).toEqual({ file: '/bin/bash', args: ['-l'], label: 'bash' })
  })
})

describe('pickWindowsShell 优先级 pwsh → powershell → cmd', () => {
  const pwsh = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
  const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  const comspec = 'C:\\Windows\\system32\\cmd.exe'
  it('pwsh 存在则用 pwsh', () => {
    expect(pickWindowsShell(() => true, comspec)).toEqual({ file: pwsh, args: [], label: 'pwsh' })
  })
  it('pwsh 不存在用 powershell', () => {
    const r = pickWindowsShell((p) => !p.includes('PowerShell\\7'), comspec)
    expect(r).toEqual({ file: powershell, args: [], label: 'powershell' })
  })
  it('都不存在用 cmd（ComSpec）', () => {
    expect(pickWindowsShell(() => false, comspec)).toEqual({ file: comspec, args: [], label: 'cmd' })
  })
})
