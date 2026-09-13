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
  /** 注入 readdir 失败（模拟瞬时 IO 错误 / 目录被移除等不一致状态） */
  failList: Error | null
  /** 注入 mkdir 失败（按契约解释：只有「已存在」且确实已存在才幂等放行） */
  failEnsureDir: Error | null
  /** 目录是否已存在（ensureDir 成功后会置 true） */
  dirExists: boolean
  ensureDirCalls: number
  listCalls: number
  /** remove 调用次数（「非空目录不得发生探测」的断言依据） */
  removeCalls: number
  failRemove: Error | null
  /**
   * 模拟 acc3 设备实测到的上游缺陷：`File.listFiles() === null` 被静默变成空列表。
   * 置 true 时 list 永远**看不到探测文件**（但写入仍然成功）—— 即危险的「能写但列不出来」。
   */
  hideProbeFromList: boolean
}

function createMemoryFs(store: Map<string, string> = new Map()): MemoryFs {
  return {
    store,
    writes: [],
    failNextWrite: null,
    failRead: null,
    failList: null,
    failEnsureDir: null,
    dirExists: true,
    ensureDirCalls: 0,
    listCalls: 0,
    removeCalls: 0,
    failRemove: null,
    hideProbeFromList: false
  }
}

function createMemoryBackend(fs: MemoryFs): AndroidDbBackend {
  return {
    ensureDir: async () => {
      fs.ensureDirCalls++
      const error = fs.failEnsureDir
      if (!error) {
        fs.dirExists = true
        return
      }
      // 与生产后端同契约：只有「目录已存在」允许幂等放行，且目录必须**确实已存在**。
      // 声称「已存在」但实际不存在 ⇒ 不一致状态 ⇒ 必须抛出（不得当成首次启动）。
      if (!/exist/i.test(error.message) || !fs.dirExists) throw error
    },
    list: async (dirRelative) => {
      fs.listCalls++
      if (fs.failList) throw fs.failList
      const prefix = `${dirRelative}/`
      return [...fs.store.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length))
        .filter((name) => !(fs.hideProbeFromList && name === PROBE_FILE_NAME))
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
    },
    remove: async (relativePath) => {
      fs.removeCalls++
      if (fs.failRemove) throw fs.failRemove
      fs.store.delete(relativePath)
    }
  }
}

/**
 * 探测文件名**写死字面量**（不从生产代码 import）：这个名字是安全相关的线上契约 ——
 * 它必须「以 . 开头且不以 .db 结尾」，否则可能被 `hydrate()` 的 `.db` 过滤当成数据库读进来。
 * 写死可以让任何改名都在这里打红，而不是悄悄生效。
 */
const PROBE_FILE_NAME = '.hydrate-probe'
const PROBE_RELATIVE = `thunder-accounting/${PROBE_FILE_NAME}`
/** 探测内容（base64 of ASCII "probe"）：与生产代码一致，故意非空 */
const PROBE_BASE64 = 'cHJvYmU='

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

// ─── P0 数据安全：严格 hydrate（绝不把「读失败」当成「空库」） ──

describe('P0 严格 hydrate：ensureDir 成功后 readdir 的任何失败都必须抛出', () => {
  it('瞬时 readdir 失败（EIO）→ hydrate rejects；exists 绝不静默返回 false', async () => {
    const fs = createMemoryFs()
    fs.store.set('thunder-accounting/thunder-accounting.db', bytesToBase64(bytes(1, 2, 3)))
    fs.failList = new Error('EIO: i/o error, readdir')

    const port = makePort(fs)
    await expect(port.hydrate()).rejects.toThrow(/EIO/)

    // 关键断言：失败后**不能**出现「空副本」这条路径。
    // 若 exists 返回 false，下游 initDatabase 就会建空库并 saveDb() 覆写真实数据。
    expect(() => port.exists(DB_PATH)).toThrow(AndroidStorageNotHydratedError)
    expect(() => port.readDbFile(DB_PATH)).toThrow(AndroidStorageNotHydratedError)
    expect(() => port.writeDbFile(DB_PATH, bytes(9))).toThrow(AndroidStorageNotHydratedError)
    // 且绝没有把「读失败」写进磁盘
    await expect(port.flush()).resolves.toBeUndefined()
    expect(fs.store.get('thunder-accounting/thunder-accounting.db')).toBe(bytesToBase64(bytes(1, 2, 3)))
    expect(fs.writes).toHaveLength(0)
  })

  it('readdir 以「目录不存在」文案失败 → 仍须 throw（因为 ensureDir 刚成功）', async () => {
    const fs = createMemoryFs()
    // Capacitor 在目录缺失时的真实文案形态
    fs.failList = new Error("Directory does not exist at '/data/user/0/x/files/thunder-accounting/'")

    const port = makePort(fs)
    await expect(port.hydrate()).rejects.toThrow(/does not exist/)
    expect(() => port.exists(DB_PATH)).toThrow(AndroidStorageNotHydratedError)
    expect(fs.listCalls).toBe(1)
    expect(fs.ensureDirCalls).toBe(1)
  })

  it('mkdir 因「目录已存在」失败且目录确实存在 → 幂等放行，继续 hydrate', async () => {
    const fs = createMemoryFs()
    fs.store.set('thunder-accounting/thunder-accounting.db', bytesToBase64(bytes(7, 7)))
    fs.dirExists = true
    fs.failEnsureDir = new Error(
      "Directory at '/data/user/0/com.thunder.accounting/files/thunder-accounting/' already exists, cannot be overwritten."
    )

    const port = makePort(fs)
    await expect(port.hydrate()).resolves.toBeUndefined()
    expect(port.exists(DB_PATH)).toBe(true)
    expect(Array.from(port.readDbFile(DB_PATH))).toEqual([7, 7])
  })

  it('mkdir 声称「已存在」但目录其实不存在 → 仍须抛出（不一致状态，不得当首次启动）', async () => {
    const fs = createMemoryFs()
    fs.dirExists = false
    fs.failEnsureDir = new Error("Directory at '/data/.../thunder-accounting/' already exists.")
    const port = makePort(fs)
    await expect(port.hydrate()).rejects.toThrow(/already exists/)
    expect(fs.listCalls).toBe(0)
    expect(() => port.exists(DB_PATH)).toThrow(AndroidStorageNotHydratedError)
  })

  it('mkdir 因非「已存在」原因失败 → 立刻抛出（不当作首次启动）', async () => {
    const fs = createMemoryFs()
    fs.failEnsureDir = new Error('EACCES: permission denied')
    const port = makePort(fs)
    await expect(port.hydrate()).rejects.toThrow(/EACCES/)
    // mkdir 都没成功，绝不能去 readdir
    expect(fs.listCalls).toBe(0)
    expect(() => port.exists(DB_PATH)).toThrow(AndroidStorageNotHydratedError)
  })

  it('hydrate 中途（第二个文件）失败 → 不留半份副本，且重试时可完整重读', async () => {
    const fs = createMemoryFs()
    fs.store.set('thunder-accounting/a.db', bytesToBase64(bytes(1)))
    fs.store.set('thunder-accounting/b.db', bytesToBase64(bytes(2)))
    // 让第二次 read 失败（第一次成功）
    const originalRead = createMemoryBackend(fs).read
    let reads = 0
    const flakyBackend: AndroidDbBackend = {
      ...createMemoryBackend(fs),
      read: async (p) => {
        reads++
        if (reads === 2) throw new Error('EIO: i/o error, read')
        return originalRead(p)
      }
    }
    const port = createAndroidStoragePort({
      backend: flakyBackend,
      registerBackgroundFlush: () => {},
      debounceMs: 0
    })

    await expect(port.hydrate()).rejects.toThrow(/EIO/)
    // 半份副本必须被丢弃：a.db 不能残留成「唯一存在的库」
    expect(() => port.exists(`${VIRTUAL_DATA_DIR}/a.db`)).toThrow(AndroidStorageNotHydratedError)

    // 重试（这次不再失败）应能完整读到两个库
    reads = 0
    const port2 = createAndroidStoragePort({
      backend: createMemoryBackend(fs),
      registerBackgroundFlush: () => {},
      debounceMs: 0
    })
    await port2.hydrate()
    expect(port2.exists(`${VIRTUAL_DATA_DIR}/a.db`)).toBe(true)
    expect(port2.exists(`${VIRTUAL_DATA_DIR}/b.db`)).toBe(true)
  })
})

// ─── P0 数据安全：空目录必须被「正面证明」（上游会把列不出来静默变成空列表） ──

describe('P0 空目录正面证明：readdir 返回空不等于「首次启动」', () => {
  it('(a) 空目录 + 健康 ⇒ 放行，且探测文件「已写、已列出、已删」不留残留', async () => {
    const fs = createMemoryFs()
    const port = makePort(fs)

    await expect(port.hydrate()).resolves.toBeUndefined()

    // 放行 = 真·首次启动（存在性为 false，且此时**已经**是 hydrated 状态，不是抛错）
    expect(port.exists(DB_PATH)).toBe(false)
    expect(port.lastFlushError()).toBeNull()
    // 探测确实执行过：唯一一次写就是探测文件，内容是空字节
    expect(fs.writes).toEqual([{ path: PROBE_RELATIVE, base64: PROBE_BASE64 }])
    // 探测文件已从磁盘删除（不留垃圾）
    expect(fs.store.has(PROBE_RELATIVE)).toBe(false)
    expect(fs.removeCalls).toBe(1)
    // 两次 list：一次判空、一次复核探测文件是否出现
    expect(fs.listCalls).toBe(2)
  })

  it('(b) 空目录 + 探测写入失败（EACCES）⇒ hydrate rejects，绝不当作首次启动', async () => {
    const fs = createMemoryFs()
    fs.failNextWrite = new Error("'writeFile' failed with: Permission denied")
    const port = makePort(fs)

    await expect(port.hydrate()).rejects.toThrow(/Permission denied/)

    // 写失败 ⇒ 不能放行：下游一旦拿到「空副本」就会建空库并 saveDb() 覆写真实数据
    expect(() => port.exists(DB_PATH)).toThrow(AndroidStorageNotHydratedError)
    expect(() => port.readDbFile(DB_PATH)).toThrow(AndroidStorageNotHydratedError)
    expect(() => port.writeDbFile(DB_PATH, bytes(9))).toThrow(AndroidStorageNotHydratedError)
    // 没写成功过任何东西
    expect(fs.writes).toHaveLength(0)
  })

  it('(c) 空目录 + 写得进却列不出来 ⇒ hydrate rejects（acc3 实测的危险组合）', async () => {
    const fs = createMemoryFs()
    // 上游把 File.listFiles()===null 静默变成 []：写入成功，但列表里永远看不到探测文件
    fs.hideProbeFromList = true
    const port = makePort(fs)

    await expect(port.hydrate()).rejects.toThrow(/不一致状态/)

    // 这条路径若放行，就是「读到空 + 写盘成功」⇒ 空库覆写真实数据（P0 的原始后果）
    expect(() => port.exists(DB_PATH)).toThrow(AndroidStorageNotHydratedError)
    expect(() => port.readDbFile(DB_PATH)).toThrow(AndroidStorageNotHydratedError)
    expect(() => port.writeDbFile(DB_PATH, bytes(9))).toThrow(AndroidStorageNotHydratedError)
    // 关键：写**是成功的**（这正是危险之处，也是普通「写失败」用例覆盖不到的）
    expect(fs.writes).toEqual([{ path: PROBE_RELATIVE, base64: PROBE_BASE64 }])
    // 收尾仍尽力删除（删除与否不影响上面的判定）
    expect(fs.removeCalls).toBe(1)
  })

  it('(d) 非空目录 ⇒ 不得发生任何探测（零额外插件调用）', async () => {
    const fs = createMemoryFs()
    const payload = bytesToBase64(bytes(4, 5, 6))
    fs.store.set('thunder-accounting/thunder-accounting.db', payload)

    const port = makePort(fs)
    await port.hydrate()

    expect(Array.from(port.readDbFile(DB_PATH))).toEqual([4, 5, 6])
    // 探测的三步（写 / 再列举 / 删）一步都没发生
    expect(fs.writes).toHaveLength(0)
    expect(fs.removeCalls).toBe(0)
    expect(fs.listCalls).toBe(1)
  })

  it('残留探测文件（上次删不掉）不会让探测被永久跳过；且它不会被当成 .db 读入', async () => {
    const fs = createMemoryFs()
    // 上次启动删失败留下的残留：目录里只有它
    fs.store.set(PROBE_RELATIVE, bytesToBase64(bytes(0xff)))
    const port = makePort(fs)

    await expect(port.hydrate()).resolves.toBeUndefined()

    // 仍然走了完整探测（覆盖写同一名字 + 复核 + 删除），所以残留被顺手清掉
    expect(fs.writes).toEqual([{ path: PROBE_RELATIVE, base64: PROBE_BASE64 }])
    expect(fs.store.has(PROBE_RELATIVE)).toBe(false)
    expect(port.exists(DB_PATH)).toBe(false)
  })

  it('删除失败不影响判定：探测已证明成功后仍放行（残留由下次探测清理）', async () => {
    const fs = createMemoryFs()
    fs.failRemove = new Error("'deleteFile' failed with: Permission denied")
    const port = makePort(fs)

    await expect(port.hydrate()).resolves.toBeUndefined()
    expect(port.exists(DB_PATH)).toBe(false)
    // 残留存在，但下次探测会剔除它再判空 —— 见上一条用例
    expect(fs.store.has(PROBE_RELATIVE)).toBe(true)
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
