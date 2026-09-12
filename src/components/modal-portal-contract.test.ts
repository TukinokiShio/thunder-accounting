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
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

/** 所有模态弹窗组件（新增模态时须同步登记） */
const MODALS = [
  'StatCardDetailDialog.tsx',
  'AddBillDialog.tsx',
  'SettingsDialog.tsx',
  'ConfirmDialog.tsx',
  'CategoryManager.tsx',
]

/** 内联视口几何必须逐字符一致（顺序固定，便于机器校验） */
const GEOMETRY = "position: 'fixed', top: 0, right: 0, bottom: 0, left: 0"

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
