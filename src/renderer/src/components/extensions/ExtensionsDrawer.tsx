import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRegistryStore } from '@/stores/registry'
import { useSessionStore } from '@/stores/sessions'

type Seg = 'skills' | 'mcp' | 'agents'

interface ExtItem {
  key: string
  name: string
  desc: string
  tag: string
  insertText: string
}

export function ExtensionsDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [seg, setSeg] = useState<Seg>('skills')
  const [query, setQuery] = useState('')
  const [inserted, setInserted] = useState<string | null>(null)
  const snapshot = useRegistryStore((s) => s.snapshot)
  const loading = useRegistryStore((s) => s.loading)
  const scan = useRegistryStore((s) => s.scan)
  const activeId = useSessionStore((s) => s.activeId)

  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void scan()
  }, [scan])

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current)
    }
  }, [])

  const insert = (text: string): void => {
    if (!activeId) return
    void window.api.sessions.write(activeId, text)
    setInserted(text)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setInserted(null), 1200)
  }

  const items = useMemo<ExtItem[]>(() => {
    const sourceLabel = (s: string): string =>
      s === 'user'
        ? t('registry.sourceUser')
        : s === 'plugin'
          ? t('registry.sourcePlugin')
          : t('registry.sourceProject')
    const q = query.trim().toLowerCase()
    const match = (name: string, desc: string): boolean =>
      !q || name.toLowerCase().includes(q) || desc.toLowerCase().includes(q)
    if (seg === 'skills') {
      return (snapshot?.skills ?? [])
        .filter((x) => match(x.name, x.description))
        .map((x) => ({
          key: `${x.name}-${x.source}`,
          name: x.name,
          desc: x.description,
          tag: sourceLabel(x.source),
          insertText: `/${x.name} `
        }))
    }
    if (seg === 'agents') {
      return (snapshot?.agents ?? [])
        .filter((x) => match(x.name, x.description))
        .map((x) => ({
          key: `${x.name}-${x.source}`,
          name: x.name,
          desc: [x.description, x.tools].filter(Boolean).join(' · '),
          tag: sourceLabel(x.source),
          insertText: `${x.name} `
        }))
    }
    return (snapshot?.mcpServers ?? [])
      .filter((x) => match(x.name, ''))
      .map((x) => ({
        key: `${x.name}-${x.scope}`,
        name: x.name,
        desc: `${t('registry.transport')}: ${x.transport}${x.command ? ` · ${x.command}` : ''}${x.url ? ` · ${x.url}` : ''}`,
        tag: sourceLabel(x.scope),
        insertText: `${x.name} `
      }))
  }, [seg, query, snapshot, t])

  return (
    <div className="drawer">
      <div className="drawer-head">
        <h2>{t('registry.title')}</h2>
        <button className="btn btn-ghost" onClick={onClose} aria-label={t('common.close')}>✕</button>
      </div>
      <div className="drawer-body">
        <div className="seg-tabs">
          <button className={seg === 'skills' ? 'active' : ''} onClick={() => setSeg('skills')}>{t('registry.tabSkills')}</button>
          <button className={seg === 'mcp' ? 'active' : ''} onClick={() => setSeg('mcp')}>{t('registry.tabMcp')}</button>
          <button className={seg === 'agents' ? 'active' : ''} onClick={() => setSeg('agents')}>{t('registry.tabAgents')}</button>
        </div>
        <input className="ext-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('registry.search')} />
        <div className="hint-bar">
          {inserted ? `✓ ${t('registry.insert')}: ${inserted.trim()}` : t('registry.hint')}
        </div>
        {loading && !snapshot && <p style={{ color: 'var(--text-dim)' }}>…</p>}
        {!loading && items.length === 0 && <p style={{ color: 'var(--text-dim)' }}>{t('registry.empty')}</p>}
        {items.map((item) => (
          <button key={item.key} className="ext-item" onClick={() => insert(item.insertText)}>
            <span className="row1">
              <span className="name">{item.name}</span>
              <span className="tag">{item.tag}</span>
            </span>
            {item.desc && <span className="desc">{item.desc}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
