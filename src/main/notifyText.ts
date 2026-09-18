/** 通知文案（主进程侧，与 renderer i18n 资源保持同义） */
export function notifyTexts(locale: string): {
  done: (name: string) => string
  failed: (name: string) => string
  detail: string
} {
  if (locale.toLowerCase().startsWith('zh')) {
    return {
      done: (n) => `「${n}」已完成`,
      failed: (n) => `「${n}」运行失败`,
      detail: '点击查看详情'
    }
  }
  return {
    done: (n) => `"${n}" finished`,
    failed: (n) => `"${n}" failed`,
    detail: 'Click to view details'
  }
}
