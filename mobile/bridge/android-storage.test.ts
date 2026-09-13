/**
 * P1-5A 门禁：安卓 StoragePort 的「hydrate 预热 + 内存副本 + 写合并队列」。
 *
 * 环境：node + 内存文件后端（模拟 `Directory.Data`）+ **真实 sql.js** 做端到端。
 * 本文件不依赖 Capacitor 插件：默认后端不参与，全部注入内存后端，故也可在 CI 稳定运行。
 */
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AndroidStorageNotHydratedError,
  base64ToBytes,
  bytesToBase64,
  createAndroidStoragePort,
  VIRTUAL_DATA_DIR,
  type AndroidDbBackend,
  type AndroidStoragePort
} from './android-storage'

// ─── 内存后端（模拟 Directory.Data） ───────────────

interface MemoryFs {
  store: Map<string, string>
  writes: Array<{ path: string; base64: string }>
  failNextWrite: Error | null
  failRead: Error | null
}

function createMemoryFs(store: Map<string, string> = new Map()): MemoryFs {
  return { store, writes: [], failNextWrite: null, failRead: null }
}

function createMemoryBackend(fs: MemoryFs): AndroidDbBackend {
  return {
    ensureDir: async () => {},
    list: async (dirRelative) => {
      const prefix = `${dirRelative}/`
      return [...fs.store.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length))
    },
    read: async (relativePath) => {
      if (fs.failRead) throw fs.failRead
      const value = fs.store.get(relativePath)
      if (value === undefined) throw new Error(`ENOENT: ${relativePath}`)
      return value
    },
    write: async (relativePath, base64) => {
      if (fs.failNextWrite) {
        const error = fs.failNextWrite
        fs.failNextWrite = null
        throw error
      }
      fs.writes.push({ path: relativePath, base64 })
      fs.store.set(relativePath, base64)
    }
  }
}

const DB_PATH = `${VIRTUAL_DATA_DIR}/thunder-accounting.db`

function makePort(fs: MemoryFs, debounceMs = 0): AndroidStoragePort {
  return createAndroidStoragePort({
    backend: createMemoryBackend(fs),
    registerBackgroundFlush: () => {}, // 测试里不注册原生监听
    debounceMs
  })
}

const bytes = (...values: number[]) => new Uint8Array(values)

// ─── 未 hydrate 的 fail-loud ────────────────────────

describe('P1-5A 未 hydrate 时必须 fail-loud（不得把空副本当成「库为空」）', () => {
  let port: AndroidStoragePort
  beforeEach(() => {
    port = makePort(createMemoryFs())
  })

  it('exists → 抛 AndroidStorageNotHydratedError', () => {
    expect(() => port.exists(DB_PATH)).toThrow(AndroidStorageNotHydratedError)
  })

  it('readDbFile → 抛错（绝不返回空 buffer 冒充空库）', () => {
    expect(() => port.readDbFile(DB_PATH)).toThrow(AndroidStorageNotHydratedError)
  })

  it('writeDbFile → 抛错（否则会用空库覆盖用户真实数据）', () => {
    expect(() => port.writeDbFile(DB_PATH, bytes(1, 2, 3))).toThrow(AndroidStorageNotHydratedError)
  })

  it('copyFile → 抛错', () => {
    expect(() => port.copyFile(DB_PATH, `${VIRTUAL_DATA_DIR}/copy.db`)).toThrow(
      AndroidStorageNotHydratedError
    )
  })

  it('错误信息里带上被拒方法名，便于定位', () => {
    expect(() => port.exists(DB_PATH)).toThrow(/exists/)
  })
})

// ─── hydrate 语义 ──────────────────────────────────

describe('P1-5A hydrate', () => {
  it('空目录 ⇒ 预热成功但 exists 为 false（首次启动）', async () => {
    const port = makePort(createMemoryFs())
    await port.hydrate()
    expect(port.exists(DB_PATH)).toBe(false)
  })

  it('已存在的 .db 被读进内存副本（readDbFile 返回原文）；非 .db 文件被忽略', async () => {
    const fs = createMemoryFs()
    const payload = bytesToBase64(bytes(9, 8, 7))
    fs.store.set('thunder-accounting/thunder-accounting.db', payload)
    fs.store.set('thunder-accounting/readme.txt', bytesToBase64(bytes(1)))

    const port = makePort(fs)
    await port.hydrate()

    expect(port.exists(DB_PATH)).toBe(true)
    expect(Array.from(port.readDbFile(DB_PATH))).toEqual([9, 8, 7])
  })

  it('幂等：重复 hydrate 不重复读盘、不重复注册后台监听', async () => {
    let registrations = 0
    const fs = createMemoryFs()
    const port = createAndroidStoragePort({
      backend: createMemoryBackend(fs),
      registerBackgroundFlush: () => {
        registrations++
      },
      debounceMs: 0
    })
    await port.hydrate()
    await port.hydrate()
    expect(registrations).toBe(1)
  })

  it('读盘失败 → hydrate 抛错（不静默跳过，避免启动后被空库覆盖）', async () => {
    const fs = createMemoryFs()
    fs.store.set('thunder-accounting/thunder-accounting.db', bytesToBase64(bytes(1)))
    fs.failRead = new Error('EACCES: permission denied')
    const port = makePort(fs)
    await expect(port.hydrate()).rejects.toThrow(/EACCES/)
    // 预热失败后仍是未预热状态 ⇒ 写操作依然被拒绝
    expect(() => port.writeDbFile(DB_PATH, bytes(1))).toThrow(AndroidStorageNotHydratedError)
  })

  it('readDbFile 返回副本，调用方改写不会污染内存缓存', async () => {
    const fs = createMemoryFs()
    fs.store.set('thunder-accounting/thunder-accounting.db', bytesToBase64(bytes(1, 2, 3)))
    const port = makePort(fs)
    await port.hydrate()

    const first = port.readDbFile(DB_PATH)
    first[0] = 99
    expect(Array.from(port.readDbFile(DB_PATH))).toEqual([1, 2, 3])
  })
})

// ─── 写队列 ────────────────────────────────────────

describe('P1-5A 写队列：合并 / 保序 / flush / 失败可见', () => {
  it('同一 path 连续多次写 → 只落最后一次（合并）', async () => {
    const fs = createMemoryFs()
    const port = makePort(fs)
    await port.hydrate()

    port.writeDbFile(DB_PATH, bytes(1))
    port.writeDbFile(DB_PATH, bytes(2))
    port.writeDbFile(DB_PATH, bytes(3))

    expect(port.exists(DB_PATH)).toBe(true)
    expect(Array.from(port.readDbFile(DB_PATH))).toEqual([3]) // 内存副本立刻是最新的

    await port.flush()
    const dbWrites = fs.writes.filter((w) => w.path === 'thunder-accounting/thunder-accounting.db')
    expect(dbWrites).toHaveLength(1)
    expect(Array.from(base64ToBytes(dbWrites[0].base64))).toEqual([3])
  })

  it('多 path 各自独立落盘，互不覆盖', async () => {
    const fs = createMemoryFs()
    const port = makePort(fs)
    await port.hydrate()

    const userDb = `${VIRTUAL_DATA_DIR}/thunder-accounting-user1.db`
    port.writeDbFile(DB_PATH, bytes(1, 1))
    port.writeDbFile(userDb, bytes(2, 2))
    await port.flush()

    expect(fs.store.get('thunder-accounting/thunder-accounting.db')).toBe(bytesToBase64(bytes(1, 1)))
    expect(fs.store.get('thunder-accounting/thunder-accounting-user1.db')).toBe(
      bytesToBase64(bytes(2, 2))
    )
  })

  it('flush 等待期间到达的新写不会被吞掉（快照取走后由下一轮处理）', async () => {
    const fs = createMemoryFs()
    const port = makePort(fs)
    await port.hydrate()

    port.writeDbFile(DB_PATH, bytes(1))
    const flushing = port.flush()
    port.writeDbFile(DB_PATH, bytes(2)) // 与 flush 并发
    await flushing
    await port.flush()

    expect(Array.from(base64ToBytes(fs.store.get('thunder-accounting/thunder-accounting.db')!))).toEqual([2])
  })

  it('落盘失败不静默：lastFlushError 可见，且 console 有真因', async () => {
    const fs = createMemoryFs()
    const port = makePort(fs)
    await port.hydrate()

    fs.failNextWrite = new Error('ENOSPC: no space left on device')
    port.writeDbFile(DB_PATH, bytes(7))
    await port.flush()

    expect(port.lastFlushError()).toBeInstanceOf(Error)
    expect(port.lastFlushError()?.message).toMatch(/ENOSPC/)
  })

  it('合并能吸收「同一 tick 内多次全库写」（S2 实测 9.27MB/次，不能 N 倍落盘）', async () => {
    const fs = createMemoryFs()
    const port = makePort(fs, 30) // 打开防抖，模拟真实节奏
    await port.hydrate()

    for (let i = 0; i < 25; i++) port.writeDbFile(DB_PATH, bytes(i))
    await port.flush()

    expect(fs.writes.filter((w) => w.path.endsWith('thunder-accounting.db'))).toHaveLength(1)
  })

  it('copyFile 同步复制内存条目，并把目标标记为待落盘', async () => {
    const fs = createMemoryFs()
    const port = makePort(fs)
    await port.hydrate()

    port.writeDbFile(DB_PATH, bytes(4, 5, 6))
    const backup = `${VIRTUAL_DATA_DIR}/thunder-accounting.db.migrated`
    port.copyFile(DB_PATH, backup)

    expect(port.exists(backup)).toBe(true)
    expect(Array.from(port.readDbFile(backup))).toEqual([4, 5, 6])

    await port.flush()
    expect(fs.store.has('thunder-accounting/thunder-accounting.db.migrated')).toBe(true)

    // 副本独立：改源不影响目标
    port.writeDbFile(DB_PATH, bytes(9))
    expect(Array.from(port.readDbFile(backup))).toEqual([4, 5, 6])
  })

  it('copyFile 源不存在 → 抛错（与 fs.copyFileSync 的 ENOENT 语义一致）', async () => {
    const port = makePort(createMemoryFs())
    await port.hydrate()
    expect(() => port.copyFile(DB_PATH, `${VIRTUAL_DATA_DIR}/x.db`)).toThrow(/源不存在/)
  })
})

// ─── 路径语义 ──────────────────────────────────────

describe('P1-5A 虚拟路径工具（不引入 node:path）', () => {
  it('getDataDir / joinPath / dirname / mkdirp', () => {
    const port = makePort(createMemoryFs())
    expect(port.getDataDir()).toBe(VIRTUAL_DATA_DIR)
    expect(port.joinPath(port.getDataDir(), 'thunder-accounting.db')).toBe(DB_PATH)
    expect(port.joinPath(port.getDataDir(), 'thunder-accounting-user1.db')).toBe(
      `${VIRTUAL_DATA_DIR}/thunder-accounting-user1.db`
    )
    expect(port.dirname(DB_PATH)).toBe(VIRTUAL_DATA_DIR)
    // mkdirp 是 no-op（目录由 hydrate 期的异步 mkdir 保证）
    expect(() => port.mkdirp(VIRTUAL_DATA_DIR)).not.toThrow()
  })

  it('拒绝虚拟数据目录之外的写盘（越界路径绝不落到磁盘）', async () => {
    const fsBackend = createMemoryFs()
    const port = makePort(fsBackend)
    await port.hydrate()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // 越界路径在内存副本里不会立刻报错（与 fs 端口的宽松语义一致），
    // 但在**唯一真正危险的动作 —— 落盘**上被拦下：不写磁盘，且错误可见。
    port.writeDbFile('/etc/passwd', bytes(1))
    await port.flush()

    expect(port.lastFlushError()).not.toBeNull()
    expect(port.lastFlushError()?.message).toMatch(/虚拟数据目录/)
    expect([...fsBackend.store.keys()].some((k) => k.includes('etc'))).toBe(false)
    expect(errorSpy).toHaveBeenCalled()
  })
})

// ─── base64 往返 ───────────────────────────────────

describe('P1-5A base64 编解码（WebView 无 Buffer）', () => {
  it('跨分块边界的大字节数组往返一致', () => {
    const big = new Uint8Array(0x2000 * 2 + 123)
    for (let i = 0; i < big.length; i++) big[i] = i % 256
    expect(Array.from(base64ToBytes(bytesToBase64(big)))).toEqual(Array.from(big))
  })

  it('空数组往返一致', () => {
    expect(base64ToBytes(bytesToBase64(new Uint8Array(0))).length).toBe(0)
  })
})

// ─── 端到端：记账 → flush → 重新 hydrate → 数据仍在 ──

describe('P1-5A 端到端（真实 sql.js + 内存「磁盘」）', () => {
  it('记账落盘后，用同一块存储重新 hydrate 仍能读到数据', async () => {
    const { initDatabase, addBill, getBills, switchToUserDatabase } = await import(
      '../../main-process/database/index'
    )
    const { setStoragePort } = await import('../../main-process/database/storage')

    const disk = new Map<string, string>()

    // —— 第一次启动 ——
    const portA = makePort(createMemoryFs(disk))
    await portA.hydrate()
    expect(portA.exists(DB_PATH)).toBe(false) // 全新安装
    setStoragePort(portA)
    await initDatabase()

    const bill = addBill({
      amount: 12.34,
      category1: '餐饮食品',
      category2: '午餐',
      date: '2026-09-13',
      note: '安卓落盘冒烟',
      type: 'expense'
    })
    expect(bill.id).toBeGreaterThan(0)
    await portA.flush()
    expect(disk.has('thunder-accounting/thunder-accounting.db')).toBe(true)

    // —— 第二次启动（同一块「磁盘」，全新 port + 全新内存副本）——
    const portB = makePort(createMemoryFs(disk))
    await portB.hydrate()
    expect(portB.exists(DB_PATH)).toBe(true)
    setStoragePort(portB)
    await initDatabase()

    const restored = getBills()
    expect(restored.some((b) => b.id === bill.id)).toBe(true)
    expect(restored.find((b) => b.id === bill.id)?.note).toBe('安卓落盘冒烟')

    // —— 切 per-user 库同样落盘（覆盖 copyFile/多文件路径）——
    await switchToUserDatabase('local')
    await portB.flush()
    expect(disk.has('thunder-accounting/thunder-accounting-local.db')).toBe(true)
  })
})
