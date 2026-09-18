import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RunRecord, TranscriptItem } from '@shared/types'
import { useTaskStore } from '@/stores/tasks'
import { Modal } from '@/components/ui/Modal'

interface Props {
  run: RunRecord
  taskId: string
  onClose: () => void
}

export function TranscriptView({ run, taskId, onClose }: Props) {
  const { t } = useTranslation()
  const task = useTaskStore((s) => s.tasks.find((x) => x.id === taskId))
  const [items, setItems] = useState<TranscriptItem[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.tasks.transcript(run)
      .then((list) => { if (!cancelled) setItems(list) })
      .catch(() => { if (!cancelled) setItems([]) })
    return () => { cancelled = true }
  }, [run])

  return (
    <Modal title={t('transcript.title')} onClose={onClose} width={560}>
      {task && (
        <div className="tr-bubble text" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>{t('transcript.prompt')}</div>
          {task.prompt}
        </div>
      )}
      {items === null && <p style={{ color: 'var(--text-dim)' }}>…</p>}
      {items !== null && items.length === 0 && <p style={{ color: 'var(--text-dim)' }}>{t('transcript.empty')}</p>}
      {items !== null && items.length > 0 && (
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
