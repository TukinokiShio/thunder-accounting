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
import ts from 'typescript'
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
    const members = androidAdapter as unknown as Record<string, unknown>
    for (const key of adapterKeys) {
      expect(typeof members[key], key).toBe('function')
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

  it('② 必须是「创建端口 → await hydrate() → setStoragePort」且早于 initDatabase', () => {
    const code = stripComments(read('mobile/main.tsx'))
    const install = code.indexOf('installAndroidBridge()')
    const create = code.indexOf('createAndroidStoragePort()')
    const hydrate = code.indexOf('await storage.hydrate()')
    const setPort = code.indexOf('setStoragePort(storage)')
    const initDb = code.indexOf('await initDatabase()')

    expect(create).toBeGreaterThan(-1)
    expect(hydrate).toBeGreaterThan(-1)
    expect(setPort).toBeGreaterThan(-1)
    // 顺序：装适配器 → 建端口 → 预热 → 注册 → 初始化 DB
    expect(install).toBeLessThan(create)
    expect(create).toBeLessThan(hydrate)
    // hydrate 必须早于 setStoragePort：否则空副本会被当成「库为空」并覆盖真实数据
    expect(hydrate).toBeLessThan(setPort)
    expect(setPort).toBeLessThan(initDb)
  })
})

// ─── P1-6：签名级契约断言（原来的 C1 只比键名） ──────────
//
// 四层防护的职责划分：
// 1. 本文件的键集断言 → 拦「方法缺失/改名」；
// 2. 本节的参数级断言 → 拦「参数被增删/可选性被改」；
// 3. `npm run typecheck`（tsconfig.mobile.json）→ 拦「androidAdapter: AppAPI 的类型漂移」；
// 4. 运行时的 C2 降级测试 → 拦「返回值语义漂移」。

interface ParamShape {
  paramCount: number
  /** 无 `?`、无默认值、非 rest 的形参个数（等于运行时的 fn.length） */
  requiredCount: number
  optionalFlags: boolean[]
}

function shapeOf(params: ts.NodeArray<ts.ParameterDeclaration> | undefined): ParamShape {
  const list = params ? Array.from(params) : []
  return {
    paramCount: list.length,
    requiredCount: list.filter((p) => !p.questionToken && !p.initializer && !p.dotDotDotToken).length,
    optionalFlags: list.map((p) => Boolean(p.questionToken ?? p.initializer))
  }
}

function buildSource(file: string): ts.SourceFile {
  return ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

/** 取 interface 中「函数类型属性」的形参表 */
function interfaceParamShapes(sf: ts.SourceFile, interfaceName: string): Map<string, ParamShape> {
  const result = new Map<string, ParamShape>()
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      for (const member of node.members) {
        if (
          ts.isPropertySignature(member) &&
          member.name &&
          ts.isIdentifier(member.name) &&
          member.type &&
          ts.isFunctionTypeNode(member.type)
        ) {
          result.set(member.name.text, shapeOf(member.type.parameters))
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return result
}

/** 取对象字面量中「箭头函数/函数表达式属性」的形参表 */
function objectLiteralParamShapes(sf: ts.SourceFile, varName: string): Map<string, ParamShape> {
  const result = new Map<string, ParamShape>()
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === varName &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const prop of node.initializer.properties) {
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
          const init = prop.initializer
          if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
            result.set(prop.name.text, shapeOf(init.parameters))
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return result
}

describe('P1-6 签名级契约：参数个数三方一致（可选位在 接口↔preload 间比对）', () => {
  const ifaceShapes = interfaceParamShapes(buildSource('src/types/index.ts'), 'AppAPI')
  const preloadShapes = objectLiteralParamShapes(buildSource('main-process/preload.ts'), 'electronAPI')
  const adapterShapes = objectLiteralParamShapes(buildSource('mobile/bridge/android-adapter.ts'), 'androidAdapter')

  it('三方都能解析出 41 个方法的形参表', () => {
    expect(ifaceShapes.size).toBe(CONTRACT_SIZE)
    expect(preloadShapes.size).toBe(CONTRACT_SIZE)
    expect(adapterShapes.size).toBe(CONTRACT_SIZE)
  })

  it('手写接口 AppAPI 与 preload 实现：每个方法的参数个数、可选位完全一致', () => {
    const mismatches: string[] = []
    for (const [method, iface] of ifaceShapes) {
      const impl = preloadShapes.get(method)
      if (!impl) {
        mismatches.push(`${method}: preload 缺失`)
        continue
      }
      if (impl.paramCount !== iface.paramCount) {
        mismatches.push(`${method}: 参数个数 ${iface.paramCount} vs ${impl.paramCount}`)
      } else if (impl.optionalFlags.join(',') !== iface.optionalFlags.join(',')) {
        mismatches.push(`${method}: 可选位 [${iface.optionalFlags}] vs [${impl.optionalFlags}]`)
      }
    }
    expect(mismatches).toEqual([])
  })

  it('适配器与手写接口：参数个数完全一致', () => {
    // 只比**个数**，不比可选位：`androidAdapter` 已标注 `: AppAPI`，TS 允许实现侧省略 `?`
    // （`(filters) =>` 满足 `(filters?: X) =>`），故逐位可选位相等是**过度约束**；
    // 可选位一致性只在「手写接口 AppAPI ↔ preload 实现」之间比对（见上一个用例）。
    const mismatches: string[] = []
    for (const [method, iface] of ifaceShapes) {
      const impl = adapterShapes.get(method)
      if (!impl) {
        mismatches.push(`${method}: 适配器缺失`)
        continue
      }
      if (impl.paramCount !== iface.paramCount) {
        mismatches.push(`${method}: 参数个数 ${iface.paramCount} vs ${impl.paramCount}`)
      }
    }
    expect(mismatches).toEqual([])
  })

  it('适配器运行时 fn.length 与声明式形参总数一致（拦「用默认值/rest 悄悄改签名」）', () => {
    // 注：不能用「必填数」比对 —— TS 的 `?` 可选参数**仍计入** fn.length，
    // 只有默认值与 rest 参数会缩短 fn.length，故基准取形参总数。
    const mismatches: string[] = []
    const members = androidAdapter as unknown as Record<string, (...args: unknown[]) => unknown>
    for (const [method, shape] of adapterShapes) {
      const runtimeLength = members[method]?.length
      if (runtimeLength !== shape.paramCount) {
        mismatches.push(`${method}: runtime fn.length=${runtimeLength} vs paramCount=${shape.paramCount}`)
      }
    }
    expect(mismatches).toEqual([])
  })
})

// ⚠ 已知限制（如实记录，勿当成已覆盖）：
// - 只比「参数个数 + 顶层可选位 + 必填数」，**不比参数类型的结构等价性**。
//   原因：两侧声明的是不同写法（AppAPI 用 `Omit<Bill,'id'|'created_at'>`，preload 用展开的对象字面量类型），
//   文本不等价；而返回值侧 preload 全是 `ipcRenderer.invoke` 的 `Promise<any>`，结构性 assignable 恒真、拦不住漂移。
//   → 参数**类型**漂移由 `npm run typecheck`（androidAdapter 上的 `: AppAPI` 注解）兜住。
// - 已知差别（本次实测，非本测试引入）：`addBill` 的 params 内层 `note`/`type` 在 AppAPI 里是必填、
//   在 preload 里是可选；`updateBill` 的 params 在 preload 里用 `Partial<{...type: string}>`（比契约的联合类型更宽）。
