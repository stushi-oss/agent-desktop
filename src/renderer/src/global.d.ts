import type { AgentDeskApi } from '../../preload/index'

declare global {
  interface Window {
    api: AgentDeskApi
  }
}

export {}
