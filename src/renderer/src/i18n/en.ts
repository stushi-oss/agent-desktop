import type { TranslationShape } from './zh-CN'

export const en: TranslationShape = {
  common: {
    close: 'Close', cancel: 'Cancel', save: 'Save', delete: 'Delete', edit: 'Edit',
    back: 'Back', confirm: 'Confirm', details: 'Details', minutes: 'min'
  },
  sessions: {
    title: 'Terminal Sessions', new: 'New Session', empty: 'No terminal sessions open yet',
    exited: 'Exited', restart: 'Restart Session', closeSession: 'Close Session',
    rename: 'Rename', copyPath: 'Copy Path',
    claudeMissingBanner: 'claude executable not found; sessions will start as plain shell (see Settings)'
  },
  tabs: { newTab: 'New Tab' },
  tasks: {
    title: 'Scheduled Tasks', new: 'New Task', empty: 'No scheduled tasks yet', list: 'Tasks',
    name: 'Name', prompt: 'Prompt', cwd: 'Working Directory', pickDir: 'Choose…',
    scheduleType: 'Schedule', cron: 'Cron Expression', interval: 'Interval (minutes)', once: 'Run At',
    permissionMode: 'Permission Mode', pmDefault: 'Default (ask)', pmAcceptEdits: 'Accept Edits',
    pmBypass: 'Bypass all permissions', pmRisk: 'Bypassing permissions lets Claude run commands and write files without confirmation. Only for fully trusted tasks.',
    model: 'Model (optional, blank = default)', timeout: 'Timeout (minutes)',
    notifyComplete: 'Notify on complete', notifyFailure: 'Notify on failure', enabled: 'Enabled',
    nextRun: 'Next Run', lastStatus: 'Last Status', runNow: 'Run Now', history: 'Run History', noHistory: 'No runs yet',
    viewTranscript: 'View Transcript',
    statusRunning: 'Running', statusSuccess: 'Success', statusFailed: 'Failed', statusMissed: 'Missed',
    vNameRequired: 'Name is required', vPromptRequired: 'Prompt is required', vCwdRequired: 'Choose a working directory',
    vCronInvalid: 'Invalid cron expression (5 fields)', vIntervalPositive: 'Interval must be > 0',
    vOnceFuture: 'Time must be in the future', saveFailed: 'Save failed — check input or try again',
    summaryNext: 'Next Task', summaryNone: 'No upcoming task', summaryMore: '{{count}} more tasks',
    runningCount: '{{count}} running'
  },
  registry: {
    title: 'Extensions', tabSkills: 'Skills', tabMcp: 'MCP', tabAgents: 'Agents',
    search: 'Search…', empty: 'Nothing found',
    hint: 'Read-only view of local Claude config. Click an item to insert into the active terminal.',
    sourceUser: 'User', sourcePlugin: 'Plugin', sourceProject: 'Project',
    transport: 'Transport', insert: 'Insert'
  },
  settings: {
    title: 'Settings', theme: 'Theme', themeSystem: 'System', themeLight: 'Light', themeDark: 'Dark',
    language: 'Language', langSystem: 'System', langZh: '中文', langEn: 'English',
    closeToTray: 'Minimize to tray on close (keeps scheduled tasks running)',
    claudeTitle: 'claude executable', claudeNotFound: 'Not found. Tried:', claudeFound: 'Found: '
  },
  notify: { done: '"{{name}}" finished', failed: '"{{name}}" failed', clickDetail: 'Click to view details' },
  transcript: {
    title: 'Transcript', prompt: 'Prompt', tool: 'Tool Call', result: 'Result',
    empty: 'No output for this run', exitCode: 'Exit code {{code}}'
  },
  errors: {
    sessionCreateFailed: 'Failed to create session',
    settingsSaveFailed: 'Failed to save settings',
    taskDeleteFailed: 'Failed to delete task'
  }
}
