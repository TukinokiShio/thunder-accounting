/**
 * `src/platform` 门禁：平台探测必须是**运行时**的、由 `<html class="platform-android">` 驱动。
 *
 * 为什么值得单独测：
 * - `src/` 不得 import `mobile/`（`mobile/bridge/contract.test.ts:90-96`），所以平台信息只能
 *   由入口侧写进 DOM；一旦有人把结果缓存成模块级常量，测试环境就无法切换真假，
 *   `Layout` / `App` / `AuthGuard` / `Profile` 的平台分支就会变成不可测。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { ANDROID_PLATFORM_CLASS, isAndroid } from './index'

const setAndroid = (on: boolean) => {
  document.documentElement.classList.toggle(ANDROID_PLATFORM_CLASS, on)
}

describe('platform: isAndroid()', () => {
  afterEach(() => setAndroid(false))

  it('默认（桌面 / jsdom）为 false', () => {
    expect(isAndroid()).toBe(false)
  })

  it('html 上出现 platform-android 后为 true', () => {
    setAndroid(true)
    expect(isAndroid()).toBe(true)
  })

  it('移除类后立即回到 false（即结果不缓存）', () => {
    setAndroid(true)
    expect(isAndroid()).toBe(true)
    setAndroid(false)
    expect(isAndroid()).toBe(false)
  })

  it('类名常量与 mobile 入口写入的字面量一致', () => {
    expect(ANDROID_PLATFORM_CLASS).toBe('platform-android')
  })
})
