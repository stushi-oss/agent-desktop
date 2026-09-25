type WriteFn = (data: string) => void

const writers = new Map<string, WriteFn>()
let off: (() => void) | null = null

/**
 * 注册一个 terminal 的 write 回调。首个注册时建立全局唯一的
 * onSessionData 订阅，之后所有 pty chunk 只走这一次 listener，
 * 按 id 路由到对应 terminal（修复 N 个 pane = N 倍分发开销）。
 */
export function registerTerminal(id: string, write: WriteFn): () => void {
  if (!off) {
    off = window.api.onSessionData((ev) => {
      writers.get(ev.id)?.(ev.data)
    })
  }
  writers.set(id, write)
  return () => {
    writers.delete(id)
  }
}

/** 测试隔离用：清空模块级单例状态 */
export function _resetForTests(): void {
  writers.clear()
  off = null
}
