import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RunRecord, TranscriptItem } from '@shared/types'
import { useTaskStore } from '@/stores/tasks'
import { Modal } from '@/components/ui/Modal'
import { ErrorKind, ERROR_MESSAGES } from '@shared/errors'

type ViewState = 'loading' | 'loaded' | 'empty' | 'error'

interface Props {
  run: RunRecord
  onClose: () => void
}

/** 渲染端 locale 检测：zh-* → 'zh'，否则 'en'。匹配 ERROR_MESSAGES 的键 */
function pickLocale(): 'en' | 'zh' {
  try {
    const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en'
    return lang.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  } catch {
    return 'en'
  }
}

export function TranscriptView({ run, onClose }: Props) {
  const { t } = useTranslation()
  const task = useTaskStore((s) => s.tasks.find((x) => x.id === run.taskId))
  const [items, setItems] = useState<TranscriptItem[]>([])
  const [viewState, setViewState] = useState<ViewState>('loading')
  const [errorMsg, setErrorMsg] = useState<string>('')
  const locale = pickLocale()

  useEffect(() => {
    let cancelled = false
    setViewState('loading')
    // 修复 #1：不再传 renderer-supplied transcriptPath；用 runId 让 main 端拼路径
    window.api.tasks.transcript({ taskId: run.taskId, runId: run.id })
      .then((list) => {
        if (cancelled) return
        setItems(list)
        setViewState(list.length === 0 ? 'empty' : 'loaded')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setErrorMsg(err instanceof Error ? err.message : String(err))
        setViewState('error')
      })
    return () => { cancelled = true }
  }, [run.taskId, run.id])

  const errorTitle = ERROR_MESSAGES[ErrorKind.TranscriptLoadFailed][locale]

  return (
    <Modal title={t('transcript.title')} onClose={onClose} width={560}>
      {task && (
        <div className="tr-bubble text" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>{t('transcript.prompt')}</div>
          {task.prompt}
        </div>
      )}
      {viewState === 'loading' && (
        <p style={{ color: 'var(--text-dim)' }}>Loading transcript...</p>
      )}
      {viewState === 'error' && (
        <div className="transcript-error" role="alert" style={{ color: 'var(--danger, #c00)' }}>
          <strong>{errorTitle}</strong>
          <p style={{ marginTop: 4 }}>{errorMsg}</p>
        </div>
      )}
      {viewState === 'empty' && (
        <p style={{ color: 'var(--text-dim)' }}>{t('transcript.empty')}</p>
      )}
      {viewState === 'loaded' && (
        <div className="transcript">
          {items.map((item, i) => {
            if (item.kind === 'text') {
              return <div key={i} className="tr-bubble text">{item.text}</div>
            }
            if (item.kind === 'tool') {
              return (
                <div key={i} className="tr-bubble">
                  <div className="tr-tool">
                    <span>🔧 {t('transcript.tool')}: {item.name}</span>
                    {item.input && <span className="input">{item.input}</span>}
                  </div>
                </div>
              )
            }
            return (
              <div key={i} className={`tr-bubble tr-result${item.isError ? ' is-error' : ''}`}>
                <div className="head">{t('transcript.result')}</div>
                <div className="body">{item.text}</div>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}