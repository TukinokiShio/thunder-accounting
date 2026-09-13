/**
 * 安卓端 `StoragePort` 实现 —— **启动期 hydrate + 内存副本 + 写合并队列**。
 *
 * ## 为什么必须这样设计
 * `saveDb()` 是**同步**的（`main-process/main.ts:72-79` 的 `will-quit` 没有 flush 时机，改成
 * async 会丢最后一批写），而 Capacitor 的 `Filesystem` 插件**全是异步 API**。二者不能直接对接，
 * 因此拆成两半：
 * - **同步读/写**：全部落在内存 `Map` 上（`hydrate()` 期由异步 IO 预装），满足 StoragePort 的同步签名；
 * - **异步落盘**：`writeDbFile` 只同步更新内存并打 dirty 标记，由 flush 队列按 path 合并后异步写。
 *
 * ## 关键安全性质（fail-loud，绝不静默丢数据）
 * 1. **未 hydrate 就调用读/写/存在性/复制 → 明确抛错**。这一点是致命的：若「未预热」被当成
 *    「库为空」，紧接着的 `saveDb()` 会用空库覆盖用户真实数据。宁可启动失败也不可静默清库。
 * 2. hydrate 期任一文件读取失败 → **抛错**（不跳过），启动即失败。
 * 3. flush 失败 → 记录到 `lastFlushError()` 且 `console.error`，**不吞掉**。
 *
 * ## 路径语义
 * Android 没有用户可见的绝对路径，故用**虚拟路径**：`VIRTUAL_DATA_DIR = '/thunder-accounting'`，
 * 它等价于 `Directory.Data` 里的相对目录 `thunder-accounting/`（虚拟路径 = `'/' + 相对路径`）。
 * 该值只在主进程/渲染进程内部传递，不呈现给用户，也不用于 `Share`（分享用的是真实 `file://` uri）。
 */
import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { App } from '@capacitor/app'
import type { DbBytes, StoragePort } from '../../main-process/database/storage'

/**
 * 虚拟数据目录。**不是真实文件系统路径** —— 仅作为 StoragePort 内部的路径字符串前缀；
 * 真实落点 = `Directory.Data` 下的 `thunder-accounting/`（Android 内部存储 + 应用私有）。
 */
export const VIRTUAL_DATA_DIR = '/thunder-accounting'

/** 写合并防抖窗口（毫秒）：吸收同一 tick 内的连续写，避免 9.27MB 全库被反复落盘（S2 实测） */
const DEFAULT_DEBOUNCE_MS = 30

export class AndroidStorageNotHydratedError extends Error {
  readonly code = 'android_storage_not_hydrated'

  constructor(method: string) {
    super(
      `安卓 StoragePort 尚未 hydrate()，拒绝执行 ${method}：` +
        '未预热时内存副本为空，任何读/写都可能被误解为「库为空」而覆盖用户真实数据'
    )
    this.name = 'AndroidStorageNotHydratedError'
  }
}

// ─── 文件后端（可注入，便于测试） ──────────────────

/**
 * 数据目录的文件后端。路径参数一律是**相对 `Directory.Data` 的路径**（如 `thunder-accounting/x.db`）。
 * 默认实现 = `@capacitor/filesystem`；测试注入内存实现。
 */
export interface AndroidDbBackend {
  /** 确保目录存在（等价 mkdirp，目录已存在不算失败） */
  ensureDir(dirRelative: string): Promise<void>
  /** 列出目录下的**文件名**（目录不存在时返回空数组） */
  list(dirRelative: string): Promise<string[]>
  /** 读取文件内容（base64） */
  read(relativePath: string): Promise<string>
  /** 写入文件（base64，覆盖写） */
  write(relativePath: string, base64: string): Promise<void>
}

/** 默认后端：Capacitor Filesystem（Android = 应用私有内部存储） */
export function createCapacitorDbBackend(): AndroidDbBackend {
  return {
    ensureDir: async (dirRelative) => {
      try {
        await Filesystem.mkdir({ path: dirRelative, directory: Directory.Data, recursive: true })
      } catch (e) {
        // mkdirp 语义：目录已存在不算失败（Capacitor 在递归创建时仍可能抛 DirectoryExists）
        if (!/exist/i.test(String((e as Error)?.message ?? e))) throw e
      }
    },
    list: async (dirRelative) => {
      try {
        const { files } = await Filesystem.readdir({ path: dirRelative, directory: Directory.Data })
        return files.filter((f) => f.type === 'file').map((f) => f.name)
      } catch (e) {
        // 目录尚不存在 ⇒ 空数据集（首次启动）。其余错误必须抛出，不得当成「空库」。
        if (/exist|not found|no such/i.test(String((e as Error)?.message ?? e))) return []
        throw e
      }
    },
    read: async (relativePath) => {
      const { data } = await Filesystem.readFile({ path: relativePath, directory: Directory.Data })
      if (typeof data !== 'string') {
        // Android 原生返回 base64 字符串；Web/Blob 变体不在支持范围内（本 App 只跑安卓原生）
        throw new Error('Filesystem.readFile 返回了非字符串数据（仅支持安卓原生的 base64 返回）')
      }
      return data
    },
    write: async (relativePath, base64) => {
      await Filesystem.writeFile({ path: relativePath, directory: Directory.Data, data: base64 })
    }
  }
}

// ─── base64 ⇄ 字节（WebView 无 Buffer，用 atob/btoa） ──

/** 每块字节数：过大会撑爆 `String.fromCharCode` 的参数栈 */
const BASE64_CHUNK = 0x2000

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK))
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// ─── 虚拟路径工具（不引入 node:path） ───────────────

function joinPathOf(...segments: string[]): string {
  const joined = segments
    .filter((s) => s.length > 0)
    .join('/')
    .replace(/\/{2,}/g, '/')
  return joined.startsWith('/') ? joined : `/${joined}`
}

function dirnameOf(filePath: string): string {
  const index = filePath.lastIndexOf('/')
  if (index < 0) return ''
  return index === 0 ? '/' : filePath.slice(0, index)
}

/** 虚拟路径 → 相对 `Directory.Data` 的路径（虚拟路径 = `'/' + 相对路径`） */
function toRelative(virtualPath: string): string {
  if (virtualPath !== VIRTUAL_DATA_DIR && !virtualPath.startsWith(`${VIRTUAL_DATA_DIR}/`)) {
    throw new Error(`安卓 StoragePort 只支持虚拟数据目录内的路径：${virtualPath}`)
  }
  return virtualPath.replace(/^\/+/, '')
}

function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e))
}

// ─── 端口 ──────────────────────────────────────────

export interface AndroidStoragePort extends StoragePort {
  /** 异步预热：确保目录存在 + 把已有 DB 读进内存。**必须先 await 成功再 setStoragePort()** */
  hydrate(): Promise<void>
  /** 等待所有待落盘数据写完（测试用；正常不需要手动调） */
  flush(): Promise<void>
  /** 最近一次 flush 失败（null = 无失败）。**错误不静默**：供 UI 提示与测试断言 */
  lastFlushError(): Error | null
}

export interface AndroidStoragePortOptions {
  /** 文件后端，默认 `@capacitor/filesystem` */
  backend?: AndroidDbBackend
  /** 后台/退出时强制落盘；默认在原生平台注册 `App.addListener('appStateChange')` */
  registerBackgroundFlush?: (flush: () => Promise<void>) => void
  /** 写合并防抖窗口（毫秒） */
  debounceMs?: number
}

/** 默认：切后台/退出时强制落盘（Android 不会给 WebView 可靠的 beforeunload） */
function defaultRegisterBackgroundFlush(flush: () => Promise<void>): void {
  if (!Capacitor.isNativePlatform()) return
  try {
    void App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) void flush()
    })
  } catch (e) {
    // 监听注册失败不能静默：否则用户可能以为「切后台就会保存」
    console.error('[AndroidStorage] 注册后台落盘监听失败：', e)
  }
}

export function createAndroidStoragePort(options: AndroidStoragePortOptions = {}): AndroidStoragePort {
  const backend = options.backend ?? createCapacitorDbBackend()
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const registerBackgroundFlush = options.registerBackgroundFlush ?? defaultRegisterBackgroundFlush

  /** 内存副本：虚拟路径 → 字节（hydrate 期预装，写操作同步更新） */
  const files = new Map<string, DbBytes>()
  /** 待落盘快照：虚拟路径 → 最新字节（**合并**：同一 path 只保留最后一次写） */
  const pending = new Map<string, DbBytes>()

  let hydrated = false
  let lastError: Error | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  /** flush 串行链：保证同一 path 的落盘不乱序、重复 flush 不并发 */
  let flushChain: Promise<void> = Promise.resolve()

  function requireHydrated(method: string): void {
    if (!hydrated) throw new AndroidStorageNotHydratedError(method)
  }

  async function flushOnce(): Promise<void> {
    while (pending.size > 0) {
      // 取走快照（清空 pending），期间新到的写会落到 pending，由下一轮处理
      const snapshot = [...pending.entries()]
      pending.clear()
      for (const [virtualPath, bytes] of snapshot) {
        try {
          await backend.write(toRelative(virtualPath), bytesToBase64(bytes))
        } catch (e) {
          lastError = asError(e)
          // 绝不静默：失败必须可见（用户数据可能未落盘）
          console.error(`[AndroidStorage] 落盘失败（${virtualPath}）：`, e)
        }
      }
    }
  }

  function flush(): Promise<void> {
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer)
      debounceTimer = undefined
    }
    flushChain = flushChain.then(() =>
      flushOnce().catch((e) => {
        lastError = asError(e)
        console.error('[AndroidStorage] flush 异常：', e)
      })
    )
    return flushChain
  }

  function scheduleFlush(): void {
    if (debounceTimer !== undefined) return
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined
      void flush()
    }, debounceMs)
  }

  return {
    // ── 异步预热 ──
    hydrate: async () => {
      if (hydrated) return
      const dirRelative = toRelative(VIRTUAL_DATA_DIR)
      await backend.ensureDir(dirRelative)
      const names = await backend.list(dirRelative)
      for (const name of names) {
        if (!name.endsWith('.db')) continue
        const virtualPath = joinPathOf(VIRTUAL_DATA_DIR, name)
        files.set(virtualPath, base64ToBytes(await backend.read(toRelative(virtualPath))))
      }
      hydrated = true
      registerBackgroundFlush(flush)
    },

    flush,

    lastFlushError: () => lastError,

    // ── StoragePort：纯字符串方法 ──
    getDataDir: () => VIRTUAL_DATA_DIR,
    joinPath: joinPathOf,
    dirname: dirnameOf,
    /**
     * 目录创建是**异步**的（Capacitor 只有异步 mkdir），已由 `hydrate()` 统一保证。
     * DB 文件的全部路径都来自 `joinPath(getDataDir(), <文件名>)`，与数据目录同层，
     * 故此处为 no-op；真正的目录问题会在 flush 时以明确错误暴露（见 lastFlushError）。
     */
    mkdirp: () => {},

    // ── StoragePort：内存副本（同步，未 hydrate 即 fail-loud） ──
    exists: (filePath) => {
      requireHydrated('exists')
      return files.has(filePath)
    },

    readDbFile: (filePath) => {
      requireHydrated('readDbFile')
      const bytes = files.get(filePath)
      if (!bytes) throw new Error(`安卓 StoragePort 内存副本中不存在：${filePath}`)
      // 返回副本，与桌面 fs.readFileSync（每次返回新 buffer）语义一致，避免调用方改到缓存
      return bytes.slice()
    },

    writeDbFile: (filePath, data) => {
      requireHydrated('writeDbFile')
      files.set(filePath, data)
      pending.set(filePath, data)
      scheduleFlush()
    },

    copyFile: (from, to) => {
      requireHydrated('copyFile')
      const source = files.get(from)
      if (!source) throw new Error(`安卓 StoragePort copyFile 源不存在：${from}`)
      const copy = source.slice()
      files.set(to, copy)
      pending.set(to, copy)
      scheduleFlush()
    }
  }
}
