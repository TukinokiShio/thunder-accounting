/**
 * P0 门禁：**真实 Capacitor 后端**（`createCapacitorDbBackend`）的严格语义。
 *
 * 与 `android-storage.test.ts` 的分工：那边用注入的内存后端验 `hydrate()` 的编排逻辑；
 * 这边 mock 掉 `@capacitor/filesystem`，直接钉住**默认后端本身**的行为。
 *
 * 回归的是这次发现的 P0 数据安全缺口：旧实现里
 *   `list()` 把 `/exist|not found|no such/i` 的错误 catch 成 `[]`
 * 于是「一次瞬时 readdir 失败」会被 `hydrate()` 解释成「首次启动」→
 * `exists()` 返回 false → `main-process/database/index.ts:66-71` 建空库 →
 * 紧接着 `saveDb()` **覆写掉用户真实数据**（不可逆）。
 *
 * 新契约（文件头安全性质 3/4/5）：
 * - `ensureDir` 成功后目录必然存在 ⇒ `list()` **任何**失败都必须抛出，空数组只能表示「真为空」；
 * - **但上游不守约**：acc3 设备实测 + 反编译证明 `io.ionic.libs:ionfilesystemlib:1.1.0` 的
 *   `IONFILEDirectoriesHelper.listDirectory` 在 `File.listFiles()===null`（不可读 / IO 错误）时
 *   静默返回 `success + emptyList()` ⇒ 光靠 `list()` 无法区分「真空」与「读不到」。
 *   故 `hydrate()` 在「无真实文件」时执行**正面写探测**（写 → 再列举并断言出现 → 尽力删除）；
 * - `read()` 只读 `list()` 已列出的文件 ⇒ not-found 属不一致状态，同样必须抛出。
 */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AndroidStorageNotHydratedError,
  createAndroidStoragePort,
  createCapacitorDbBackend
} from './android-storage'

const mocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  deleteFile: vi.fn()
}))

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA', Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    mkdir: mocks.mkdir,
    readdir: mocks.readdir,
    readFile: mocks.readFile,
    writeFile: mocks.writeFile,
    deleteFile: mocks.deleteFile
  }
}))

const DIR = 'thunder-accounting'
const DB_RELATIVE = `${DIR}/thunder-accounting.db`
/** 与生产代码同名的探测文件（见 `android-storage.test.ts` 里为何写死字面量） */
const PROBE_NAME = '.hydrate-probe'
const PROBE_RELATIVE = `${DIR}/${PROBE_NAME}`

beforeEach(() => {
  mocks.mkdir.mockReset().mockResolvedValue(undefined)
  mocks.readdir.mockReset().mockResolvedValue({ files: [] })
  mocks.readFile.mockReset().mockResolvedValue({ data: 'AAEC' })
  mocks.writeFile.mockReset().mockResolvedValue(undefined)
  mocks.deleteFile.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('P0 默认后端 ensureDir：只有「已存在」才允许幂等放行', () => {
  it('mkdir 抛 DirectoryExists（already exists）→ 放行', async () => {
    mocks.mkdir.mockRejectedValue(
      new Error(
        "Directory at '/data/user/0/com.thunder.accounting/files/thunder-accounting/' " +
          'already exists, cannot be overwritten.'
      )
    )
    await expect(createCapacitorDbBackend().ensureDir(DIR)).resolves.toBeUndefined()
  })

  it('mkdir 抛 EACCES → 抛出（不得当作「目录已就绪」）', async () => {
    mocks.mkdir.mockRejectedValue(new Error('EACCES: permission denied'))
    await expect(createCapacitorDbBackend().ensureDir(DIR)).rejects.toThrow(/EACCES/)
  })

  it('调用参数锁定：recursive=true + Directory.Data（目录必然存在的语义前提）', async () => {
    await createCapacitorDbBackend().ensureDir(DIR)
    expect(mocks.mkdir).toHaveBeenCalledWith({ path: DIR, directory: 'DATA', recursive: true })
  })
})

describe('P0 默认后端 list：绝不吞错（旧实现会吞成 []）', () => {
  it('readdir 抛瞬时 IO 错误（EIO）→ 抛出，不返回空数组', async () => {
    mocks.readdir.mockRejectedValue(new Error('EIO: i/o error, readdir'))
    await expect(createCapacitorDbBackend().list(DIR)).rejects.toThrow(/EIO/)
  })

  it('readdir 抛「目录不存在」文案 → 仍然抛出（这是本次缺口的回归点）', async () => {
    mocks.readdir.mockRejectedValue(
      new Error("Directory does not exist at '/data/user/0/x/files/thunder-accounting/'")
    )
    // 旧实现：/not found|no such|exist/ 命中 ⇒ 返回 []  ⇒ P0。
    // 新实现：ensureDir 刚成功，目录不可能不存在 ⇒ 必须抛。
    await expect(createCapacitorDbBackend().list(DIR)).rejects.toThrow(/does not exist/)
  })

  it('readdir 抛 OS-PLUG-FILE-0010（already exists 文案）→ 同样抛出，不当作空目录', async () => {
    mocks.readdir.mockRejectedValue(
      new Error("Directory at '/data/.../thunder-accounting/' already exists, cannot be overwritten.")
    )
    await expect(createCapacitorDbBackend().list(DIR)).rejects.toThrow(/already exists/)
  })

  it('成功时只取 type=file 的名字（目录项被过滤掉）', async () => {
    mocks.readdir.mockResolvedValue({
      files: [
        { name: 'thunder-accounting.db', type: 'file' },
        { name: 'sub', type: 'directory' }
      ]
    })
    await expect(createCapacitorDbBackend().list(DIR)).resolves.toEqual(['thunder-accounting.db'])
  })

  it('真·空目录 ⇒ 返回 []（这是唯一合法的「空」来源）', async () => {
    mocks.readdir.mockResolvedValue({ files: [] })
    await expect(createCapacitorDbBackend().list(DIR)).resolves.toEqual([])
  })
})

describe('P0 默认后端 read：not-found 不是「可以跳过」', () => {
  it('readFile 抛 not found → 抛出并带上路径上下文（不返回空串冒充空库）', async () => {
    mocks.readFile.mockRejectedValue(new Error("File does not exist at '/x/thunder-accounting.db'"))
    await expect(createCapacitorDbBackend().read(`${DIR}/thunder-accounting.db`)).rejects.toThrow(
      /读取失败（thunder-accounting\/thunder-accounting\.db）/
    )
  })

  it('readFile 返回非字符串（Web/Blob 变体）→ 抛出（本 App 只支持安卓原生 base64）', async () => {
    mocks.readFile.mockResolvedValue({ data: new Blob([]) })
    await expect(createCapacitorDbBackend().read(`${DIR}/thunder-accounting.db`)).rejects.toThrow(
      /非字符串数据/
    )
  })

  it('成功时原样返回 base64 字符串', async () => {
    mocks.readFile.mockResolvedValue({ data: 'U1FMaXRlIGZvcm1hdCAz' })
    await expect(createCapacitorDbBackend().read(`${DIR}/x.db`)).resolves.toBe('U1FMaXRlIGZvcm1hdCAz')
  })
})

describe('P0 组合：默认后端 + readdir 失败 ⇒ 端口保持 fail-loud，不存在「空库」路径', () => {
  it('hydrate rejects，且之后所有读写都抛 NotHydrated（绝不静默 exists=false）', async () => {
    mocks.readdir.mockRejectedValue(new Error('EIO: i/o error, readdir'))
    const port = createAndroidStoragePort({
      backend: createCapacitorDbBackend(),
      registerBackgroundFlush: () => {},
      debounceMs: 0
    })

    await expect(port.hydrate()).rejects.toThrow(/EIO/)
    expect(() => port.exists('/thunder-accounting/thunder-accounting.db')).toThrow(
      AndroidStorageNotHydratedError
    )
    expect(() => port.writeDbFile('/thunder-accounting/thunder-accounting.db', new Uint8Array([1]))).toThrow(
      AndroidStorageNotHydratedError
    )
    // 没有写穿透到磁盘
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('目录真为空（readdir 成功返回 []，且探测文件能列出来）⇒ 合法「首次启动」：exists=false 但不抛', async () => {
    // 第一次 readdir（判空）返回空；第二次（复核探测）能看到刚写入的探测文件
    mocks.readdir
      .mockResolvedValueOnce({ files: [] })
      .mockResolvedValueOnce({ files: [{ name: PROBE_NAME, type: 'file' }] })
    const port = createAndroidStoragePort({
      backend: createCapacitorDbBackend(),
      registerBackgroundFlush: () => {},
      debounceMs: 0
    })
    await expect(port.hydrate()).resolves.toBeUndefined()
    expect(port.exists('/thunder-accounting/thunder-accounting.db')).toBe(false)

    // 探测三步都真的发生了，且参数正确（写入非空探测内容 + 用完即删）
    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
    expect(mocks.writeFile).toHaveBeenCalledWith({
      path: PROBE_RELATIVE,
      directory: 'DATA',
      data: 'cHJvYmU='
    })
    expect(mocks.deleteFile).toHaveBeenCalledTimes(1)
    expect(mocks.deleteFile).toHaveBeenCalledWith({ path: PROBE_RELATIVE, directory: 'DATA' })
  })

  it('★ 写得进却列不出来（readdir 永远 []，模拟 listFiles()===null 被静默吞）⇒ hydrate rejects', async () => {
    // 这是 acc3 设备实测复现的上游缺陷：目录不可读时 Capacitor 返回 success + []，
    // 所以「空列表」无法区分「真空」与「完全读不到」。只有写探测能挡住它。
    mocks.readdir.mockResolvedValue({ files: [] })
    const port = createAndroidStoragePort({
      backend: createCapacitorDbBackend(),
      registerBackgroundFlush: () => {},
      debounceMs: 0
    })

    await expect(port.hydrate()).rejects.toThrow(/不一致状态/)
    expect(() => port.exists('/thunder-accounting/thunder-accounting.db')).toThrow(
      AndroidStorageNotHydratedError
    )
    expect(() => port.writeDbFile('/thunder-accounting/thunder-accounting.db', new Uint8Array([1]))).toThrow(
      AndroidStorageNotHydratedError
    )
    // 探测写**成功了**（这正是危险组合：能写 + 列不出来），但绝不放行
    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
  })

  it('非空目录不得发生探测：writeFile/deleteFile 一次都不调用', async () => {
    mocks.readdir.mockResolvedValue({ files: [{ name: 'thunder-accounting.db', type: 'file' }] })
    mocks.readFile.mockResolvedValue({ data: 'AAEC' })
    const port = createAndroidStoragePort({
      backend: createCapacitorDbBackend(),
      registerBackgroundFlush: () => {},
      debounceMs: 0
    })

    await expect(port.hydrate()).resolves.toBeUndefined()
    expect(port.exists('/thunder-accounting/thunder-accounting.db')).toBe(true)
    expect(mocks.writeFile).not.toHaveBeenCalled()
    expect(mocks.deleteFile).not.toHaveBeenCalled()
    expect(mocks.readdir).toHaveBeenCalledTimes(1)
    expect(mocks.readFile).toHaveBeenCalledWith({ path: DB_RELATIVE, directory: 'DATA' })
  })
})
