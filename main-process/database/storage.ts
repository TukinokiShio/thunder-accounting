/**
 * 持久化端口（StoragePort）—— DB 逻辑与「最后一跳」落盘/读盘的解耦点。
 *
 * 设计约束（不可回退）：
 * 1. **同步签名**：`saveDb()` 必须保持同步（`main-process/main.ts:72-79` 的 `will-quit`
 *    只做 `unregisterAll`，没有 flush 时机），因此写盘类方法一律同步。
 * 2. **不含平台依赖**：本文件与 `database/index.ts` 都**不得** import `electron` / `fs` /
 *    `path` / `Buffer` —— 安卓 WebView 没有这些。路径拼接由端口提供（`joinPath` /
 *    `dirname`），以免 DB 模块退回 `node:path`。
 * 3. **端口由平台入口安装**：桌面在 `main-process/main.ts` 安装
 *    `createDesktopStoragePort()`。
 *    ⚠ 安卓侧端口**尚未实现**（见 `task_plan.md` P1-5）：`mobile/main.tsx` 目前**不会**调用
 *    `setStoragePort`，因此在安卓上 `initDatabase()` 会以明确错误失败（fail-loud，不静默丢数据）。
 *    实现方式为「同步入队 + 异步 flush」写队列 —— Capacitor 的 Filesystem/Preferences 插件
 *    全是异步 API，满足不了 `saveDb()` 的同步签名（见上方第 1 条）。
 *    共享 DB 模块自身不引用任何平台实现。
 *
 * ⚠ 数据目录语义（两套，必须保留）：
 * - per-user 库：`<dataDir>/thunder-accounting-<userId>.db`
 * - admin/旧版共享库：`<dataDir>/thunder-accounting.db`
 *   两者只是同一目录下的不同文件名，文件名由 `database/index.ts` 决定。
 */

/** 文件字节的通用载体：`Uint8Array`（桌面实现返回的 `Buffer` 是其子类，见 `sql.js.d.ts`） */
export type DbBytes = Uint8Array

export interface StoragePort {
  /** 应用数据目录绝对路径（桌面 = `app.getPath('userData')`） */
  getDataDir(): string
  /** 路径拼接（桌面 = `node:path.join`），用于在不引入 `node:path` 的前提下生成与原值逐字符相同的路径 */
  joinPath(...segments: string[]): string
  /** 取父目录（桌面 = `node:path.dirname`） */
  dirname(filePath: string): string
  /** 读取文件字节；调用方须先用 `exists` 判断存在性 */
  readDbFile(filePath: string): DbBytes
  /** 写入文件字节（覆盖写） */
  writeDbFile(filePath: string, data: DbBytes): void
  /** 文件是否存在 */
  exists(filePath: string): boolean
  /** 复制文件 */
  copyFile(from: string, to: string): void
  /** 递归创建目录（目录已存在时静默返回，与 `fs.mkdirSync(..., {recursive:true})` 一致） */
  mkdirp(dir: string): void
}

let activePort: StoragePort | undefined

/**
 * 安装当前平台的持久化端口。
 * 每个平台入口只调用一次：桌面 `main.ts`、安卓 `mobile/main.tsx`。
 */
export function setStoragePort(port: StoragePort): void {
  activePort = port
}

/**
 * 取当前端口。未安装时**明确报错**而不是回退到某个隐式默认实现 ——
 * 静默回退会让「安卓误用桌面 `fs`」这类错误在真机上才暴露。
 */
export function getStoragePort(): StoragePort {
  if (!activePort) {
    throw new Error(
      'StoragePort 未安装：平台入口须先调用 setStoragePort()（桌面 main-process/main.ts，安卓 mobile/main.tsx）'
    )
  }
  return activePort
}
