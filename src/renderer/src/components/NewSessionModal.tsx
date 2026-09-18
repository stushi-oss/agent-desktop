import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from './ui/Modal'
import { useSessionStore } from '@/stores/sessions'

export function NewSessionModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const createAndActivate = useSessionStore((s) => s.createAndActivate)
  const [cwd, setCwd] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.api.app.pickDirectory().then((dir) => {
      if (!dir) onClose()
      else setCwd(dir)
    })
  }, [onClose])

  const confirm = async (): Promise<void> => {
    if (!cwd || busy) return
    setBusy(true)
    const s = await createAndActivate(cwd)
    setBusy(false)
    if (s) onClose()
  }

  return (
    <Modal title={t('sessions.new')} onClose={onClose}>
      <div className="field">
        <label>{t('tasks.cwd')}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={cwd ?? ''} readOnly style={{ flex: 1 }} />
          <button className="btn" onClick={() => void window.api.app.pickDirectory().then((d) => d && setCwd(d))}>
            {t('tasks.pickDir')}
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn btn-primary" disabled={!cwd || busy} onClick={() => void confirm()}>
          {t('sessions.new')}
        </button>
      </div>
    </Modal>
  )
}
