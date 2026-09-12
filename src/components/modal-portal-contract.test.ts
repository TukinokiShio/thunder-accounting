/**
 * 模态层 Portal 契约测试（源级）。
 *
 * 背景：`position: fixed` 的包含块会被祖先改写，导致遮罩无法铺满整个视口
 * （本项目 v1.17.2 实测遮罩顶部露白约 24px，见 wiki/错误精粹.md KI-2026-09-12-003）。
 *
 * 约定：所有模态弹窗必须
 *   1. 用 createPortal 挂到 document.body（祖先链只剩 body/html）
 *   2. 用内联样式写死视口几何，而非 className="fixed inset-0 ..."
 *   3. z-index 分层：应用内容 50~60 < 模态 9000 < react-select 菜单 Portal 10000
 *
 * 这是源级结构契约测试：直接断言源码里必须存在/不得存在的结构，无需 mock 渲染。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * 从组件目录派生：所有含 `return createPortal(` 的非测试 tsx 都是模态，新增模态自动纳入约束。
 * 下方仍保留 3 条保底断言，防止目录/命名变动让清单静默变空（"零约束但全绿"）。
 */
const MODALS = readdirSync(here)
  .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
  .filter((f) => readFileSync(path.join(here, f), 'utf8').includes('return createPortal('))
  .sort()

/** 内联视口几何必须逐字符一致（顺序固定，便于机器校验） */
const GEOMETRY = "position: 'fixed', top: 0, right: 0, bottom: 0, left: 0"

describe('模态清单派生保底', () => {
  it('MODALS 派生结果应非空且包含已知模态', () => {
    // 防止目录/命名变动让清单静默变空，导致"零约束但全绿"
    expect(MODALS.length).toBeGreaterThanOrEqual(5)
    expect(MODALS).toContain('StatCardDetailDialog.tsx')
    expect(MODALS).toContain('AddBillDialog.tsx')
  })
})

describe('模态层 Portal 契约', () => {
  it.each(MODALS)('%s 应经 createPortal 挂到 document.body', (file) => {
    const src = readFileSync(path.join(here, file), 'utf8')

    // 必须从 react-dom 引入 createPortal，且实际调用（不能只 import 不落点）
    expect(src).toMatch(/import \{[^}]*\bcreatePortal\b[^}]*\} from 'react-dom'/)
    expect(src).toMatch(/return createPortal\(/)
    expect(src).toMatch(/^\s*document\.body$/m)
  })

  it.each(MODALS)('%s 应内联写死视口几何且不再使用 fixed inset-0 模态根', (file) => {
    const src = readFileSync(path.join(here, file), 'utf8')

    expect(src).toContain(GEOMETRY)
    // 回归防护：不得残留工具类形式的模态根（否则可能再次受祖先包含块影响）
    expect(src).not.toMatch(/className="fixed inset-0/)
  })

  it.each(MODALS)('%s 的 z-index 应落在约定分层区间内', (file) => {
    const src = readFileSync(path.join(here, file), 'utf8')

    const m = src.match(/position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: (\d+) \}/)
    expect(m, `${file} 未找到内联 zIndex`).not.toBeNull()

    const z = Number(m![1])
    // 高于应用内容（z-50 / z-[60]），低于 react-select 菜单 Portal（10000）
    expect(z).toBeGreaterThanOrEqual(9000)
    expect(z).toBeLessThan(10000)
  })
})

/**
 * 作用域替身契约（v1.17.5）。
 *
 * Portal 让模态脱离 `.aurora-shell` / `.dark` 子树，会同时丢失
 * ① `.aurora-shell .xxx-dialog` 版式规则 ② 深色 token 与 `dark:` 变体。
 * 因此每个模态根元素必须携带 `.aurora-shell.aurora-portal-root` 替身与主题标记。
 */
describe('模态层作用域替身契约', () => {
  it.each(MODALS)('%s 的 Portal 根应挂载作用域替身与主题标记', (file) => {
    const src = readFileSync(path.join(here, file), 'utf8')

    // 必须在组件内（渲染期）读取主题，不能固化为模块级常量，否则主题切换不跟随
    expect(src).toMatch(/modalPortalScope\(\)/)
    expect(src).toMatch(/portalScope\.className/)
    expect(src).toMatch(/data-theme=\{portalScope\['data-theme'\]\}/)
  })

  it('作用域类名应由 src/utils/modalScope.ts 单一来源提供', () => {
    const src = readFileSync(path.join(here, '..', 'utils', 'modalScope.ts'), 'utf8')
    expect(src).toContain("export const MODAL_PORTAL_ROOT_CLASS = 'aurora-shell aurora-portal-root'")
  })

  it('index.css 必须存在替身覆盖规则（透明底 + width:auto）', () => {
    const css = readFileSync(path.join(here, '..', 'index.css'), 'utf8')
    expect(css).toMatch(/\.aurora-shell\.aurora-portal-root\s*\{[^}]*background:\s*transparent/)
    expect(css).toMatch(/\.aurora-shell\.aurora-portal-root\s*\{[^}]*width:\s*auto[^}]*\}/)
  })
})
