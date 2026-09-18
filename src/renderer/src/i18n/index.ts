import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { zhCN } from './zh-CN'
import { en } from './en'

export function detectLocale(): 'zh-CN' | 'en' {
  const nav = (navigator.language || 'en').toLowerCase()
  return nav.startsWith('zh') ? 'zh-CN' : 'en'
}

void i18next.use(initReactI18next).init({
  resources: { 'zh-CN': { translation: zhCN }, en: { translation: en } },
  lng: detectLocale(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

export default i18next
