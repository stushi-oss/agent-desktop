// src/shared/errors.ts

export const ErrorKind = {
  SettingsIoFailure: 'settings.io_failure',
  TranscriptLoadFailed: 'transcript.load_failed',
  TaskCancelled: 'task.cancelled'
} as const
export type ErrorKind = typeof ErrorKind[keyof typeof ErrorKind]

/** renderer 端 i18n key 映射（en/zh-CN） */
export const ERROR_MESSAGES: Record<ErrorKind, { en: string; zh: string }> = {
  'settings.io_failure': { en: 'Failed to save settings', zh: '保存设置失败' },
  'transcript.load_failed': { en: 'Failed to load transcript', zh: '加载 transcript 失败' },
  'task.cancelled': { en: 'Task cancelled', zh: '任务已取消' }
}