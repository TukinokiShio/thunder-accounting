/**
 * C 门禁：安装时序与「不覆盖既有宿主」。
 *
 * 关键断言：**导入适配器模块本身不得安装任何东西** —— 安装只发生在 `mobile/main.tsx`
 * 的显式调用；且 `??=` 语义必须保证桌面 preload / 测试替身不被覆盖。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { androidAdapter, installAndroidBridge } from './android-adapter'

const host = window as unknown as { electronAPI?: unknown }

afterEach(() => {
  delete host.electronAPI
})

describe('安装时序', () => {
  it('导入模块本身不安装（未安装前 window.electronAPI 为 undefined）', () => {
    expect(host.electronAPI).toBeUndefined()
  })

  it('installAndroidBridge() 安装后 window.electronAPI 即适配器', () => {
    installAndroidBridge()
    expect(host.electronAPI).toBe(androidAdapter)
  })

  it('重复安装不产生副作用（??= 幂等）', () => {
    installAndroidBridge()
    installAndroidBridge()
    expect(host.electronAPI).toBe(androidAdapter)
  })

  it('绝不覆盖已存在的宿主（桌面 preload 或测试整体替换的替身）', () => {
    const existingHost = { addBill: () => Promise.resolve() }
    host.electronAPI = existingHost
    installAndroidBridge()
    expect(host.electronAPI).toBe(existingHost)
  })
})
