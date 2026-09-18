export const zhCN = {
  common: {
    close: '关闭', cancel: '取消', save: '保存', delete: '删除', edit: '编辑',
    back: '返回', confirm: '确认', details: '详情', minutes: '分钟'
  },
  sessions: {
    title: '终端会话', new: '新会话', empty: '暂无会话，点击「新会话」开始',
    exited: '已退出', restart: '重启会话', closeSession: '关闭会话',
    rename: '重命名', copyPath: '复制路径',
    claudeMissingBanner: '未找到 claude 可执行文件，会话将以纯 shell 启动（详情见设置）'
  },
  tabs: { newTab: '新标签页' },
  tasks: {
    title: '定时任务', new: '新建任务', empty: '还没有定时任务', list: '任务列表',
    name: '名称', prompt: '任务指令', cwd: '工作目录', pickDir: '选择目录',
    scheduleType: '调度方式', cron: 'Cron 表达式', interval: '间隔（分钟）', once: '执行时间',
    permissionMode: '权限模式', pmDefault: '默认（每次询问）', pmAcceptEdits: '接受文件编辑',
    pmBypass: '跳过所有权限', pmRisk: '跳过权限意味着 Claude 可不经确认执行命令/写文件，仅用于完全可信的任务。',
    model: '模型（可选，留空用默认）', timeout: '超时（分钟）',
    notifyComplete: '完成时通知', notifyFailure: '失败时通知', enabled: '启用',
    nextRun: '下次运行', lastStatus: '最近状态', runNow: '立即运行', history: '运行历史',
    viewTranscript: '查看运行过程',
    statusRunning: '运行中', statusSuccess: '成功', statusFailed: '失败', statusMissed: '已错过',
    vNameRequired: '请填写名称', vPromptRequired: '请填写任务指令', vCwdRequired: '请选择工作目录',
    vCronInvalid: 'Cron 表达式无效（应为 5 段）', vIntervalPositive: '间隔必须大于 0',
    vOnceFuture: '执行时间必须在未来', saveFailed: '保存失败，请检查输入或稍后重试',
    summaryNext: '下一个任务', summaryNone: '无待触发任务', summaryMore: '另有 {{count}} 个任务',
    runningCount: '{{count}} 个任务运行中'
  },
  registry: {
    title: '扩展', tabSkills: 'Skills', tabMcp: 'MCP', tabAgents: 'Agents',
    search: '搜索…', empty: '未发现任何条目',
    hint: '只读展示本机 Claude 配置，点击条目可插入当前终端',
    sourceUser: '用户', sourcePlugin: '插件', sourceProject: '项目',
    transport: '传输', insert: '插入终端'
  },
  settings: {
    title: '设置', theme: '主题', themeSystem: '跟随系统', themeLight: '浅色', themeDark: '深色',
    language: '语言', langSystem: '跟随系统', langZh: '中文', langEn: 'English',
    closeToTray: '关闭窗口时最小化到托盘（保证定时任务后台运行）',
    claudeTitle: 'claude 可执行文件', claudeNotFound: '未找到，已尝试：'
  },
  notify: { done: '「{{name}}」已完成', failed: '「{{name}}」运行失败', clickDetail: '点击查看详情' },
  transcript: {
    title: '运行过程', prompt: '任务指令', tool: '工具调用', result: '最终结果',
    empty: '该次运行没有输出', exitCode: '退出码 {{code}}'
  }
} as const

/** as const 会把值收窄为字面量类型，en.ts 无法赋值；放宽回 string，仅保留结构（key 一一对应）校验 */
type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> }

export type TranslationShape = Widen<typeof zhCN>
