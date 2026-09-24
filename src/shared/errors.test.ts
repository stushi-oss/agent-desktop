import { describe, it, expect } from 'vitest'
import { ErrorKind, ERROR_MESSAGES } from './errors'

describe('@shared/errors', () => {
  it('ErrorKind enum 值稳定', () => {
    expect(ErrorKind.SettingsIoFailure).toBe('settings.io_failure')
    expect(ErrorKind.TranscriptLoadFailed).toBe('transcript.load_failed')
    expect(ErrorKind.TaskCancelled).toBe('task.cancelled')
  })

  it('ERROR_MESSAGES 双语映射完整', () => {
    for (const kind of Object.values(ErrorKind)) {
      expect(ERROR_MESSAGES[kind]).toBeDefined()
      expect(ERROR_MESSAGES[kind].en).toBeTypeOf('string')
      expect(ERROR_MESSAGES[kind].zh).toBeTypeOf('string')
    }
  })
})