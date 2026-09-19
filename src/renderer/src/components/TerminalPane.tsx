import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { SessionSummary } from '@shared/types'
import { effectiveTheme } from '@/theme/theme'
import { xtermThemeFor } from '@/theme/xtermThemes'

interface Props {
  session: SessionSummary
  active: boolean
  themeMode: 'light' | 'dark'
}

export function TerminalPane({ session, active, themeMode }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  // 修复：主题变化时实时更新已挂载终端的 theme（不重建实例，保住 scrollback）
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = xtermThemeFor(effectiveTheme(themeMode))
    }
  }, [themeMode])

  // 生命周期：一个 session 一个 Terminal 实例（保住 scrollback）
  useEffect(() => {
    const term = new Terminal({
      fontSize: 14,
      fontFamily: '"SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10000,
      theme: xtermThemeFor(effectiveTheme(themeMode))
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current!)
    // 放行应用级快捷键（⌘/Ctrl+T、W、1-9；不含 alt/shift 组合）到应用层
    term.attachCustomKeyEventHandler((ev) => {
      if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey && ev.type === 'keydown') {
        const k = ev.key.toLowerCase()
        if (k === 't' || k === 'w' || (k >= '1' && k <= '9')) return false
      }
      return true
    })
    const offData = window.api.onSessionData((ev) => {
      if (ev.id === session.id) term.write(ev.data)
    })
    term.onData((d) => window.api.sessions.write(session.id, d))
    termRef.current = term
    fitRef.current = fit
    const syncSize = () => {
      try {
        fit.fit()
        void window.api.sessions.resize(session.id, term.cols, term.rows)
      } catch {
        /* host 不可见时 fit 会抛错，忽略 */
      }
    }
    // 多阶段 fit：rAF 一次 + 100ms 后再 fit 一次 + 500ms 后保险一次
    // 处理 StrictMode 双挂载 + 主进程 IPC hydrate 之前的初始尺寸塌陷
    requestAnimationFrame(syncSize)
    const t100 = setTimeout(syncSize, 100)
    const t500 = setTimeout(syncSize, 500)
    const ro = new ResizeObserver(() => {
      if (hostRef.current?.offsetParent !== null) syncSize()
    })
    ro.observe(hostRef.current!)
    return () => {
      clearTimeout(t100)
      clearTimeout(t500)
      ro.disconnect()
      offData()
      term.dispose()
      termRef.current = null
    }
  }, [session.id])

  // 激活时 refit + 聚焦
  useEffect(() => {
    if (!active) return
    requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
        const t = termRef.current
        if (t) void window.api.sessions.resize(session.id, t.cols, t.rows)
      } catch {
        /* ignore */
      }
      termRef.current?.focus()
    })
  }, [active, session.id])

  return <div ref={hostRef} className={`terminal-host${active ? '' : ' is-hidden'}`} />
}
