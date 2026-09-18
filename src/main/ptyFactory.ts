import { spawn as ptySpawn } from 'node-pty'
import type { PtyFactory } from './session/SessionManager'

/** 真实 node-pty 工厂（N-API prebuilds，无需 electron-rebuild） */
export const nodePtyFactory: PtyFactory = (opts) => {
  const pty = ptySpawn(opts.file, opts.args, {
    cwd: opts.cwd,
    env: opts.env,
    cols: opts.cols,
    rows: opts.rows,
    name: 'xterm-256color'
  })
  return {
    write: (data) => pty.write(data),
    resize: (cols, rows) => pty.resize(cols, rows),
    kill: (signal) => pty.kill(signal),
    onData: (cb) => pty.onData(cb),
    // node-pty 的退出事件是 { exitCode, signal }，这里适配成 SessionManager 期望的 code
    onExit: (cb) => pty.onExit(({ exitCode }) => cb(exitCode))
  }
}
