import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/global.css'
import { applyTheme } from './theme/theme'

// 首帧绘制前同步设置主题，避免浅色系统用户启动时出现深→浅闪变（FOUC）
applyTheme('system')

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
