/**
 * P1-5B 门禁：文件通道（无原生模态对话框的替代路径）。
 *
 * 安卓没有 Electron 的 `dialog.showSaveDialog/showOpenDialog`，故复用桌面 UI 的既有调用序列：
 *   `exportCSV/exportBackup` → `showSaveDialog` → `writeFile`（写入 cache + 系统分享面板）
 *   `showOpenDialog` → `importBackup`
 *
 * 本文件锁定四条不可退让的语义：
 * 1. `showSaveDialog` 返回**虚拟**分享路径（`share://`），不是真实文件系统路径；
 * 2. `writeFile` 只在「cache 写入成功 **且** 分享面板成功拉起」时才返回 true —— 任一环节失败必须 false；
 * 3. `writeFile` 拒绝非分享通道路径（如桌面传来的绝对路径），绝不谎报写入成功；
 * 4. `showOpenDialog` 用户取消 → `null`（既有合法语义）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Directory, Encoding } from '@capacitor/filesystem'
import { androidAdapter, SHARE_PATH_SCHEME } from './android-adapter'

// hoisted：vi.mock 工厂会被提到 import 之前执行，必须用 vi.hoisted 装载可变实现
const mocks = vi.hoisted(() => ({
  writeFile: vi.fn(),
  getUri: vi.fn(),
  share: vi.fn()
}))

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE', Data: 'DATA' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    writeFile: mocks.writeFile,
    getUri: mocks.getUri
  }
}))

vi.mock('@capacitor/share', () => ({
  Share: { share: mocks.share }
}))

beforeEach(() => {
  mocks.writeFile.mockReset().mockResolvedValue(undefined)
  mocks.getUri.mockReset().mockResolvedValue({ uri: 'file:///cache/out.json' })
  mocks.share.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('P1-5B showSaveDialog：生成虚拟分享路径', () => {
  it('返回 share:// 前缀 + 原文件名（虚拟路径，非真实落点）', async () => {
    const filePath = await androidAdapter.showSaveDialog('ThunderBooks_Backup.json')
    expect(filePath).toBe(`${SHARE_PATH_SCHEME}ThunderBooks_Backup.json`)
  })

  it('桌面传来的绝对路径只取 basename（不能把目录带进 cache 落点）', async () => {
    await expect(androidAdapter.showSaveDialog('/tmp/exports/账单.csv')).resolves.toBe(
      `${SHARE_PATH_SCHEME}账单.csv`
    )
    await expect(androidAdapter.showSaveDialog('C:\\Users\\me\\导出\\账单.csv')).resolves.toBe(
      `${SHARE_PATH_SCHEME}账单.csv`
    )
  })

  it('过滤文件系统非法字符', async () => {
    await expect(androidAdapter.showSaveDialog('a<b>c:d|e?f*g.json')).resolves.toBe(
      `${SHARE_PATH_SCHEME}abcdefg.json`
    )
  })

  it('无法得到合法文件名 → null（调用方按「已取消」处理，不写空文件）', async () => {
    await expect(androidAdapter.showSaveDialog('   ')).resolves.toBeNull()
    await expect(androidAdapter.showSaveDialog('...')).resolves.toBeNull()
    await expect(androidAdapter.showSaveDialog('')).resolves.toBeNull()
  })
})

describe('P1-5B writeFile：写 cache → 拉起系统分享；失败必须 false', () => {
  it('成功路径：先写 cache（UTF8）→ 取 uri → 分享 → 返回 true', async () => {
    const ok = await androidAdapter.writeFile(`${SHARE_PATH_SCHEME}out.json`, '{"n":1}')
    expect(ok).toBe(true)

    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
    expect(mocks.writeFile).toHaveBeenCalledWith({
      path: 'out.json',
      directory: Directory.Cache,
      data: '{"n":1}',
      encoding: Encoding.UTF8
    })
    expect(mocks.getUri).toHaveBeenCalledWith({ path: 'out.json', directory: Directory.Cache })
    expect(mocks.share).toHaveBeenCalledWith({
      title: 'out.json',
      files: ['file:///cache/out.json']
    })
    // 顺序保证：先落盘再分享（不可先弹面板）
    expect(mocks.writeFile.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.share.mock.invocationCallOrder[0]
    )
  })

  it('Filesystem 写入失败 → false（绝不谎报已保存）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.writeFile.mockRejectedValueOnce(new Error('disk full'))

    await expect(androidAdapter.writeFile(`${SHARE_PATH_SCHEME}out.json`, 'x')).resolves.toBe(false)
    expect(mocks.share).not.toHaveBeenCalled()
    // 真因必须被记录，不能静默吞掉
    expect(errorSpy).toHaveBeenCalled()
  })

  it('Share 取消/失败 → false（不静默）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.share.mockRejectedValueOnce(new Error('user canceled'))

    await expect(androidAdapter.writeFile(`${SHARE_PATH_SCHEME}out.json`, 'x')).resolves.toBe(false)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('getUri 失败 → false', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.getUri.mockRejectedValueOnce(new Error('no uri'))

    await expect(androidAdapter.writeFile(`${SHARE_PATH_SCHEME}out.json`, 'x')).resolves.toBe(false)
    expect(mocks.share).not.toHaveBeenCalled()
  })

  it('拒绝非分享通道路径（桌面绝对路径 / file:// / 任意字符串）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(androidAdapter.writeFile('/tmp/a.json', '{}')).resolves.toBe(false)
    await expect(androidAdapter.writeFile('file:///sdcard/a.json', '{}')).resolves.toBe(false)
    await expect(androidAdapter.writeFile('just-a-name.json', '{}')).resolves.toBe(false)

    expect(mocks.writeFile).not.toHaveBeenCalled()
    expect(mocks.share).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledTimes(3)
  })
})

describe('P1-5B showOpenDialog：隐藏 file input + FileReader', () => {
  /** 拦截 input.click() 拿到被创建的元素（jsdom 不会真的弹对话框） */
  function interceptInputClick(): HTMLInputElement[] {
    const created: HTMLInputElement[] = []
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement
    ) {
      created.push(this)
    })
    return created
  }

  it('选中文件 → 读回文本内容（filePath 为文件名，不泄露本机绝对路径）', async () => {
    const created = interceptInputClick()
    const pending = androidAdapter.showOpenDialog()
    expect(created).toHaveLength(1)
    const input = created[0]
    expect(input.type).toBe('file')
    expect(input.style.display).toBe('none')

    const file = new File(['{"version":1}'], 'backup.json', { type: 'application/json' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change'))

    await expect(pending).resolves.toEqual({ filePath: 'backup.json', content: '{"version":1}' })
    // 读取结束后必须把自己从 DOM 摘掉
    expect(document.body.contains(input)).toBe(false)
  })

  it('用户取消（cancel 事件）→ null，且不残留 DOM 节点', async () => {
    const created = interceptInputClick()
    const pending = androidAdapter.showOpenDialog()
    const input = created[0]

    input.dispatchEvent(new Event('cancel'))

    await expect(pending).resolves.toBeNull()
    expect(document.body.contains(input)).toBe(false)
  })

  it('change 事件但未选中任何文件 → null', async () => {
    const created = interceptInputClick()
    const pending = androidAdapter.showOpenDialog()
    const input = created[0]

    input.dispatchEvent(new Event('change'))

    await expect(pending).resolves.toBeNull()
  })

  it('读取失败 → null（记为错误而非崩溃）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const created = interceptInputClick()
    const pending = androidAdapter.showOpenDialog()
    const input = created[0]

    const file = new File(['x'], 'bad.json', { type: 'application/json' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    // 让 FileReader 构造出的实例在 readAsText 时立即触发 error
    const originalReader = globalThis.FileReader
    class FailingReader {
      result: string | null = null
      error: unknown = new Error('read failed')
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsText(): void {
        queueMicrotask(() => this.onerror?.())
      }
    }
    vi.stubGlobal('FileReader', FailingReader as unknown as typeof FileReader)

    try {
      input.dispatchEvent(new Event('change'))
      await expect(pending).resolves.toBeNull()
      expect(errorSpy).toHaveBeenCalled()
      expect(document.body.contains(input)).toBe(false)
    } finally {
      vi.stubGlobal('FileReader', originalReader)
    }
  })

  it('无 document 环境（非 WebView）→ null，不抛错', async () => {
    const originalDocument = globalThis.document
    // @ts-expect-error 故意移除 document 模拟非浏览器环境
    delete globalThis.document
    try {
      await expect(androidAdapter.showOpenDialog()).resolves.toBeNull()
    } finally {
      globalThis.document = originalDocument
    }
  })
})
