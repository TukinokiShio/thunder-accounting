/**
 * C1 门禁：适配器契约与桌面契约三方一致性。
 *
 * 背景（S4 spike 结论）：契约存在**两份独立定义** —— 手写接口 `AppAPI`
 * （`src/types/index.ts`）与 `preload.ts` 末尾的 `export type ElectronAPI = typeof electronAPI`，
 * 两者会**静默漂移**。因此这里同时断言三方集合相等：
 *
 *   安卓适配器键集 == 手写接口键集 == preload 暴露键集
 *
 * 并额外断言 `src/types/index.ts` 的兼容别名是「类型别名」而非第二份 interface
 * （别名不可能与 AppAPI 漂移）。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { androidAdapter } from './android-adapter'

const root = resolve(__dirname, '../..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')

const CONTRACT_SIZE = 41

/** 从 `{ ... }` 字面量 / interface 体中抽取顶层成员名（2 空格缩进的 `name:`） */
function extractTopLevelKeys(source: string, blockStart: string): string[] {
  const start = source.indexOf(blockStart)
  expect(start, `未找到起点：${blockStart}`).toBeGreaterThan(-1)
  const body = source.slice(start + blockStart.length)
  const end = body.indexOf('\n}')
  expect(end, `未找到终点（列 0 的 }）：${blockStart}`).toBeGreaterThan(-1)
  const block = body.slice(0, end)
  return Array.from(block.matchAll(/^ {2}([A-Za-z_$][\w$]*)\s*:/gm)).map((m) => m[1])
}

const ifaceKeys = extractTopLevelKeys(read('src/types/index.ts'), 'export interface AppAPI {')
const preloadSource = read('main-process/preload.ts')
const preloadKeys = extractTopLevelKeys(preloadSource, 'const electronAPI = {')
const adapterKeys = Object.keys(androidAdapter)

const sorted = (keys: string[]) => [...keys].sort()

/** 去掉注释后再断言：注释里出现「Buffer」「trySync(...)」等词不应被当成实现 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('C1 契约一致性（适配器 / 手写接口 / preload 暴露）', () => {
  it('适配器恰好实现 41 个方法', () => {
    expect(adapterKeys).toHaveLength(CONTRACT_SIZE)
  })

  it('三方键集完全相等（不多不少、无改名）', () => {
    expect(sorted(adapterKeys)).toEqual(sorted(ifaceKeys))
    expect(sorted(preloadKeys)).toEqual(sorted(ifaceKeys))
    // 显式三方互等，避免未来只改一侧时错误信息指向不明
    expect(sorted(adapterKeys)).toEqual(sorted(preloadKeys))
  })

  it('不存在重复键造成的「数量凑够但方法缺失」', () => {
    expect(new Set(adapterKeys).size).toBe(adapterKeys.length)
    expect(new Set(ifaceKeys).size).toBe(ifaceKeys.length)
  })

  it('适配器每个成员都是函数（无遗漏实现被占位成非函数）', () => {
    for (const key of adapterKeys) {
      expect(typeof (androidAdapter as Record<string, unknown>)[key], key).toBe('function')
    }
  })

  it('兼容别名是类型别名，而非第二份会被静默漂移的 interface', () => {
    const source = read('src/types/index.ts')
    expect(source).toContain('export type ElectronAPI = AppAPI')
    expect(source).not.toContain('export interface ElectronAPI')
  })

  it('preload 侧的独立定义仍然存在，且其键集与手写接口一致', () => {
    expect(preloadSource).toContain('export type ElectronAPI = typeof electronAPI')
    expect(sorted(preloadKeys)).toHaveLength(CONTRACT_SIZE)
  })
})

describe('C1 边界：平台隔离与安全边界', () => {
  /** 递归收集 src/ 下的源码文件（排除测试，测试允许整体替换 window.electronAPI） */
  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) return walk(full)
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
    })
  }

  it('src/ 下任何生产文件都不得 import mobile/', () => {
    const offenders = walk(resolve(root, 'src'))
      .filter((file) => !/\.(test|spec)\.(ts|tsx)$/.test(file))
      .filter((file) => /(?:from|import)\s*\(?\s*['"][^'"]*\bmobile\//.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(root.length + 1))
    expect(offenders).toEqual([])
  })

  it('mobile/ 不得把服务端 accessKey 链路（cloudbase / @cloudbase/node-sdk）带进 App', () => {
    const offenders = walk(resolve(root, 'mobile'))
      .filter((file) => !/\.(test|spec)\.(ts|tsx)$/.test(file))
      .filter((file) => /@cloudbase\/node-sdk|from\s+['"][^'"]*cloudbase['"]/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(root.length + 1))
    expect(offenders).toEqual([])
  })

  it('共享 DB 模块不得引入任何平台依赖（否则安卓不可达）', () => {
    for (const file of ['main-process/database/index.ts', 'main-process/database/storage.ts']) {
      const code = stripComments(read(file))
      expect(code, file).not.toMatch(/from\s+['"]electron['"]/)
      expect(code, file).not.toMatch(/from\s+['"]fs['"]/)
      expect(code, file).not.toMatch(/from\s+['"]path['"]/)
      expect(code, file).not.toMatch(/\bBuffer\b/)
      expect(code, file).not.toMatch(/\bprocess\s*\./)
    }
  })
})

describe('C6 云同步预留位：适配器 trySync 调用点与桌面 IPC handler 一一对应', () => {
  /** 桌面 main.ts:200-214 的 6 个写后同步调用点（按调用形状断言，变量名可不同） */
  const CALLPOINTS = [
    'trySync(() => upsertRemoteBill(',
    'trySync(() => deleteRemoteBill(id))',
    'trySync(() => upsertRemoteCategory(',
    'trySync(() => deleteRemoteCategory(id))'
  ]

  const countCallpoints = (source: string) =>
    CALLPOINTS.reduce((total, point) => total + source.split(point).length - 1, 0)

  it('桌面与安卓两侧各有 6 个同形状调用点', () => {
    expect(countCallpoints(stripComments(read('main-process/main.ts')))).toBe(6)
    expect(countCallpoints(stripComments(read('mobile/bridge/android-adapter.ts')))).toBe(6)
  })

  it('适配器首版的远端占位实现是 no-op（不得写云、不得抛错）', () => {
    const source = read('mobile/bridge/android-adapter.ts')
    for (const fn of ['upsertRemoteBill', 'deleteRemoteBill', 'upsertRemoteCategory', 'deleteRemoteCategory']) {
      expect(source).toContain(`async function ${fn}(`)
    }
  })
})

describe('P1-4 安卓入口：三步顺序不得重排', () => {
  it('① 安装适配器 < ② 初始化数据库 < ③ 动态 import 共享 UI 入口', () => {
    const code = stripComments(read('mobile/main.tsx'))
    const install = code.indexOf('installAndroidBridge()')
    const initDb = code.indexOf('await initDatabase()')
    const mountApp = code.indexOf("await import('../src/main')")

    expect(install).toBeGreaterThan(-1)
    expect(initDb).toBeGreaterThan(-1)
    expect(mountApp).toBeGreaterThan(-1)
    expect(install).toBeLessThan(initDb)
    expect(initDb).toBeLessThan(mountApp)
  })
})
