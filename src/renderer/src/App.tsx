import { useEffect, useState } from 'react'
import './i18n'
import { useTranslation } from 'react-i18next'
import i18next from '@/i18n'
import { applyTheme, effectiveTheme, watchSystemTheme } from '@/theme/theme'
import { useModeStore } from '@/theme/modeStore'
import { useSessionStore } from '@/stores/sessions'
import { useTaskStore, selectRunningCount } from '@/stores/tasks'
import { TitleBar } from '@/components/TitleBar'
import { SessionSidebar } from '@/components/SessionSidebar'
import { NewSessionModal } from '@/components/NewSessionModal'
import { TerminalPane } from '@/components/TerminalPane'
import { TaskDrawer } from '@/components/tasks/TaskDrawer'
import { ExtensionsDrawer } from '@/components/extensions/ExtensionsDrawer'
import { SettingsModal } from '@/components/SettingsModal'

export default function App() {
  const { t } = useTranslation()
  const effective = useModeStore((s) => s.effective)
  const sessions = useSessionStore((s) => s.sessions)
  const activeId = useSessionStore((s) => s.activeId)
  const hydrate = useSessionStore((s) => s.hydrate)
  const markExited = useSessionStore((s) => s.markExited)
  const activate = useSessionStore((s) => s.activate)
  const hydrateTasks = useTaskStore((s) => s.hydrate)
  const refreshFromPush = useTaskStore((s) => s.refreshFromPush)
  const tasksRunning = useTaskStore(selectRunningCount)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [tasksOpen, setTasksOpen] = useState(false)
  const [extOpen, setExtOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [claudeMissing, setClaudeMissing] = useState(false)

  // 启动恢复持久化设置（主题/语言）；setMode 会回写一次相同值，无害
  useEffect(() => {
    void window.api.app.getSettings().then((s) => {
      useModeStore.getState().setMode(s.theme)
      const loc = s.locale === 'system'
        ? (navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en')
        : s.locale
      void i18next.changeLanguage(loc)
    })
  }, [])

  // claude 缺失横幅
  useEffect(() => {
    void window.api.app.getClaudeStatus().then((s) => setClaudeMissing(!s.found))
  }, [])

  useEffect(() => {
    // macOS 红绿灯藏在 titlebar 左侧，留出空间避免遮挡品牌
    if (window.api.app.platform === 'darwin') {
      document.documentElement.classList.add('platform-darwin')
    }
    const off = watchSystemTheme(() => {
      if (useModeStore.getState().mode === 'system') {
        // 先更新 data-theme 再同步 store（store 只驱动终端重渲染，不触发 applyTheme）
        applyTheme('system')
        useModeStore.setState({ effective: effectiveTheme('system') })
      }
    })
    return off
  }, [])

  useEffect(() => {
    void hydrate()
    void hydrateTasks()
    const offExit = window.api.onSessionExit((ev) => markExited(ev.id, ev.code))
    const offTasks = window.api.onTasksChanged((p) => refreshFromPush(p.tasks, p.history))
    return () => { offExit(); offTasks() }
  }, [hydrate, hydrateTasks, markExited, refreshFromPush])

  useEffect(() => {
    const off = window.api.onShortcut(({ key }) => {
      if (key === 't') setNewSessionOpen(true)
      else if (key === 'w') {
        const id = useSessionStore.getState().activeId
        if (id) void useSessionStore.getState().close(id)
      } else {
        const idx = Number(key) - 1
        const s = useSessionStore.getState().sessions[idx]
        if (s) activate(s.id)
      }
    })
    return off
  }, [activate])

  // 系统通知点击 → 打开任务抽屉
  useEffect(() => {
    const off = window.api.onOpenTasks(() => setTasksOpen(true))
    return off
  }, [])

  return (
    <div className="app-shell">
      <TitleBar
        onNewSession={() => setNewSessionOpen(true)}
        onOpenTasks={() => setTasksOpen((v) => !v)}
        onOpenExtensions={() => setExtOpen((v) => !v)}
        onOpenSettings={() => setSettingsOpen(true)}
        tasksRunning={tasksRunning}
      />
      {claudeMissing && (
        <div className="banner-warn">
          ⚠️ <span>{t('sessions.claudeMissingBanner')}</span>
          <button onClick={() => setSettingsOpen(true)}>{t('settings.title')}</button>
        </div>
      )}
      <div className="app-body">
        <SessionSidebar onNewSession={() => setNewSessionOpen(true)} onOpenTasks={() => setTasksOpen(true)} />
        <main className="terminal-area">
          {sessions.map((s) => (
            <TerminalPane key={s.id} session={s} active={s.id === activeId} themeMode={effective} />
          ))}
        </main>
      </div>
      {newSessionOpen && <NewSessionModal onClose={() => setNewSessionOpen(false)} />}
      {tasksOpen && <TaskDrawer onClose={() => setTasksOpen(false)} />}
      {extOpen && <ExtensionsDrawer onClose={() => setExtOpen(false)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
