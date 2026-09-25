import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppSettings } from '@shared/types'
import { Modal } from './ui/Modal'
import { Toggle } from './ui/Toggle'
import { useModeStore } from '@/theme/modeStore'
import { useToastStore } from '@/stores/toast'
import i18next from '@/i18n'

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const setMode = useModeStore((s) => s.setMode)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [claude, setClaude] = useState<{ found: boolean; candidates: string[] } | null>(null)

  useEffect(() => {
    void window.api.app.getSettings().then(setSettings)
    void window.api.app.getClaudeStatus().then(setClaude)
  }, [])

  const patch = async (p: Partial<AppSettings>): Promise<void> => {
    try {
      const next = await window.api.app.setSettings(p)
      setSettings(next)
      if (p.theme) setMode(next.theme)
      if (p.locale) {
        const loc = next.locale === 'system'
          ? (navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en')
          : next.locale
        void i18next.changeLanguage(loc)
      }
    } catch {
      // 保存失败：toast 提示 + 重拉真实状态，消除受控 select 的视觉漂移（#8）
      useToastStore.getState().show(t('errors.settingsSaveFailed'))
      void window.api.app.getSettings().then(setSettings)
    }
  }

  if (!settings) return null
  return (
    <Modal title={t('settings.title')} onClose={onClose}>
      <div className="settings-row">
        <label>{t('settings.theme')}</label>
        <select value={settings.theme} onChange={(e) => void patch({ theme: e.target.value as AppSettings['theme'] })}>
          <option value="system">{t('settings.themeSystem')}</option>
          <option value="light">{t('settings.themeLight')}</option>
          <option value="dark">{t('settings.themeDark')}</option>
        </select>
      </div>
      <div className="settings-row">
        <label>{t('settings.language')}</label>
        <select value={settings.locale} onChange={(e) => void patch({ locale: e.target.value as AppSettings['locale'] })}>
          <option value="system">{t('settings.langSystem')}</option>
          <option value="zh-CN">{t('settings.langZh')}</option>
          <option value="en">{t('settings.langEn')}</option>
        </select>
      </div>
      <div className="settings-row">
        <label>{t('settings.closeToTray')}</label>
        <Toggle checked={settings.closeToTray} onChange={(v) => void patch({ closeToTray: v })} />
      </div>
      <div className="field">
        <label>{t('settings.claudeTitle')}</label>
        {claude && !claude.found ? (
          <>
            <div style={{ color: 'var(--danger)', fontSize: 12 }}>{t('settings.claudeNotFound')}</div>
            <ul className="candidates">
              {claude.candidates.slice(0, 6).map((c) => <li key={c}>{c}</li>)}
            </ul>
          </>
        ) : (
          <div style={{ color: 'var(--success)', fontSize: 12 }}>
            ✓ {t('settings.claudeFound')} {claude?.candidates[0] ?? ''}
          </div>
        )}
      </div>
    </Modal>
  )
}
