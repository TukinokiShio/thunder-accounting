/**
 * `resolveBackAction` 门禁：安卓系统返回键 / 返回手势的决策核心。
 *
 * 为什么只测得到纯函数：jsdom 里没有 Capacitor 原生桥，`App.addListener('backButton')`
 * 的回调无法被驱动；真正的系统返回手势只能在真机 / 模拟器上验收（见文件末尾说明）。
 * 因此把决策抽进 `src/platform/backNavigation.ts` 才可能有覆盖 —— 本文件就是那层覆盖。
 *
 * 另外附上**源码级**断言：入口侧只注册一次监听、且排在 ④ 之后、且不含 exitApp。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveBackAction, type BackNavigationState } from './backNavigation'

const base: BackNavigationState = { settingsOpen: false, isAddDialogOpen: false, activePage: 'home' }
const state = (patch: Partial<BackNavigationState>): BackNavigationState => ({ ...base, ...patch })

describe('resolveBackAction：5 个分支', () => {
  it('① 设置打开 → 关设置', () => {
    expect(resolveBackAction(state({ settingsOpen: true }))).toEqual({ kind: 'close-settings' })
  })

  it('② 记账弹窗开着 → 关弹窗', () => {
    expect(resolveBackAction(state({ isAddDialogOpen: true }))).toEqual({ kind: 'close-add-bill' })
  })

  it('③ 分类管理页 → 回「我的」', () => {
    expect(resolveBackAction(state({ activePage: 'categories' }))).toEqual({ kind: 'goto-profile' })
  })

  it('④ 其它非首页 → 回首页（三个页面逐个验证）', () => {
    for (const page of ['bills', 'stats', 'profile'] as const) {
      expect(resolveBackAction(state({ activePage: page }))).toEqual({ kind: 'goto-home' })
    }
  })

  it('⑤ 已在首页 → noop（明确不退出应用）', () => {
    expect(resolveBackAction(base)).toEqual({ kind: 'noop' })
  })
})

describe('resolveBackAction：优先级（弹窗优先于页面）', () => {
  it('设置 > 记账弹窗 > 页面：三者同时成立时关设置', () => {
    expect(
      resolveBackAction(state({ settingsOpen: true, isAddDialogOpen: true, activePage: 'categories' }))
    ).toEqual({ kind: 'close-settings' })
  })

  it('记账弹窗 > 页面', () => {
    expect(resolveBackAction(state({ isAddDialogOpen: true, activePage: 'categories' }))).toEqual({
      kind: 'close-add-bill'
    })
  })

  it('弹窗优先于「首页 noop」：首页上开着浮层时仍要关浮层', () => {
    expect(resolveBackAction(state({ settingsOpen: true }))).toEqual({ kind: 'close-settings' })
    expect(resolveBackAction(state({ isAddDialogOpen: true }))).toEqual({ kind: 'close-add-bill' })
  })

  it('categories 优先于「其它非首页回首页」', () => {
    const action = resolveBackAction(state({ activePage: 'categories' }))
    expect(action).not.toEqual({ kind: 'goto-home' })
    expect(action).toEqual({ kind: 'goto-profile' })
  })
})

describe('mobile/main.tsx 注册点（源码级：jsdom 驱动不了原生监听器，只能查调用点）', () => {
  const source = readFileSync(resolve(process.cwd(), 'mobile/main.tsx'), 'utf8')

  it('backButton 监听只有一个注册点，并有幂等守卫（避免 HMR/重复进入叠加监听）', () => {
    expect(source.match(/addListener\(\s*'backButton'/g) ?? []).toHaveLength(1)
    expect(source).toMatch(/if \(backButtonHandle\) return/)
  })

  it('注册排在 ④（动态 import 共享 UI）之后：store 必须已经就位', () => {
    const step4 = source.indexOf("await import('../src/main')")
    const step5 = source.indexOf('await registerBackButton()')
    expect(step4).toBeGreaterThan(-1)
    expect(step5).toBeGreaterThan(step4)
  })

  it('入口只做映射：决策走 resolveBackAction，且不含 exitApp（退出应用是独立产品决策）', () => {
    expect(source).toContain('resolveBackAction')
    expect(source).toContain("from '../src/platform/backNavigation'")
    expect(source).not.toContain('exitApp')
  })
})

/**
 * 已知覆盖边界（如实标注，不假装覆盖）：
 * - 「系统返回手势真的会触发这个决策」只能在真机 / 模拟器上验收：jsdom 没有
 *   `OnBackPressedDispatcher`，无头 Chromium 也没有原生桥，两端都驱动不了。
 * - 本文件能证明的是**决策正确**与**注册点唯一**；触发链路靠 `@capacitor/app` 原生回调
 *   （`AppPlugin.java:49-57` 已在源码注释中取证）。
 */
