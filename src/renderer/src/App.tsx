import { useEffect, useState } from 'react'
import './i18n'
import { effectiveTheme, watchSystemTheme } from '@/theme/theme'
import { useModeStore } from '@/theme/modeStore'
import { useSessionStore } from '@/stores/sessions'
import { useTaskStore, selectRunningCount } from '@/stores/tasks'
import { TitleBar } from '@/components/TitleBar'
import { SessionSidebar } from '@/components/SessionSidebar'
import { NewSessionModal } from '@/components/NewSessionModal'
import { TerminalPane } from '@/components/TerminalPane'
import { TaskDrawer } from '@/components/tasks/TaskDrawer'

export default function App() {
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
  // Task 17/18 接入扩展抽屉与设置弹窗；先保留开关状态
  const [tasksOpen, setTasksOpen] = useState(false)
  const [extOpen, setExtOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    const off = watchSystemTheme(() => {
      if (useModeStore.getState().mode === 'system') {
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

  return (
    <div className="app-shell">
      <TitleBar
        onNewSession={() => setNewSessionOpen(true)}
        onOpenTasks={() => setTasksOpen((v) => !v)}
        onOpenExtensions={() => setExtOpen((v) => !v)}
        onOpenSettings={() => setSettingsOpen(true)}
        tasksRunning={tasksRunning}
      />
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
      {/* Task 17/18: {extOpen && <ExtensionsDrawer/>} {settingsOpen && <SettingsModal/>} */}
      <span hidden>{`${extOpen}${settingsOpen}`}</span>
    </div>
  )
}
