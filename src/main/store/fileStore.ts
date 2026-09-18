import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'

export function writeAtomic(filePath: string, data: unknown): void {
  const tmp = join2(dirname(filePath), `.${basename(filePath)}.tmp-${process.pid}-${Date.now()}`)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, filePath)
}

// 避免与 node:path.join 命名冲突的本地 join
function join2(dir: string, name: string): string {
  return dir.endsWith('/') || dir.endsWith('\\') ? dir + name : `${dir}/${name}`
}

export type ReadJsonResult<T> = { ok: true; data: T } | { ok: false; reason: 'missing' | 'corrupt' }

export function readJson<T>(filePath: string): ReadJsonResult<T> {
  if (!existsSync(filePath)) return { ok: false, reason: 'missing' }
  try {
    return { ok: true, data: JSON.parse(readFileSync(filePath, 'utf8')) as T }
  } catch {
    return { ok: false, reason: 'corrupt' }
  }
}

export function backupCorrupt(filePath: string): string | null {
  if (!existsSync(filePath)) return null
  const bak = `${filePath}.corrupt-${Date.now()}`
  copyFileSync(filePath, bak)
  return bak
}
