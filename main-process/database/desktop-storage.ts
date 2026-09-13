/**
 * StoragePort 的桌面（Electron 主进程）实现。
 *
 * 这是**唯一**允许把 `electron` / `fs` / `path` / `Buffer` 带进持久化链路的文件；
 * 安卓侧另有一份实现（`mobile/bridge/android-storage.ts`）。DB 共享逻辑不得依赖本文件。
 *
 * 行为等价性说明（对照改造前的 `database/index.ts`）：
 * - `getDataDir()` ≡ `app.getPath('userData')`（每次调用现取，与原实现一致）
 * - `readDbFile()` ≡ `fs.readFileSync`（返回值 `Buffer` 是 `Uint8Array` 子类，字节不变）
 * - `writeDbFile()` ≡ `fs.writeFileSync`（原实现为 `Buffer.from(export())`——`Buffer` 仅
 *   为字节载体，写成 `Uint8Array` 落盘字节逐位相同，故不再需要 `Buffer.from`）
 * - `mkdirp()` ≡ `if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })`
 */
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { DbBytes, StoragePort } from './storage'

export function createDesktopStoragePort(): StoragePort {
  return {
    getDataDir: () => app.getPath('userData'),
    joinPath: (...segments) => path.join(...segments),
    dirname: (filePath) => path.dirname(filePath),
    readDbFile: (filePath) => fs.readFileSync(filePath),
    writeDbFile: (filePath, data: DbBytes) => fs.writeFileSync(filePath, data),
    exists: (filePath) => fs.existsSync(filePath),
    copyFile: (from, to) => fs.copyFileSync(from, to),
    mkdirp: (dir) => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    }
  }
}
