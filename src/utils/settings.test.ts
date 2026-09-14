/**
 * 「应用偏好设置」的默认值门禁。
 *
 * 真机事故（P0，2026-09）：安卓系统语言是英文时，**首次启动界面直接就是英文**，
 * 用户在一个陌生语言里连「怎么换回中文」都找不到（当时换语言的入口还被裁在屏幕外，
 * 见 `src/pages/Profile.local-mode.test.tsx`）。
 * 根因：`DEFAULT_SETTINGS.language` 由 `navigator.language` 派生。
 *
 * 现在钉住的契约：**没有持久化设置时恒为中文**，与系统语言、运行平台都无关；
 * 只有用户**显式切换过**（`localStorage['thunder_settings']` 里有值）才跟随用户选择。
 *
 * ⚠ 可失败性（rules §26）：本文件的第 1 条之所以能失败，是因为 `DEFAULT_SETTINGS` 在
 * 模块求值时就被算出来 —— 所以每个用例都先桩 `navigator.language`，再
 * `vi.resetModules()` 重新 import 模块。旧实现（派生自 `navigator.language`）在第 1 条下
 * 必然得到 'en' 而失败；为了证明桩**真的生效**（而不是在一个还是 zh 的环境里空断言），
 * 第 1 条同时断言读到的 `navigator.language` 就是 'en-US'。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const setNavigatorLanguage = (value: string) => {
  Object.defineProperty(navigator, 'language', { value, configurable: true })
  Object.defineProperty(navigator, 'languages', { value: [value], configurable: true })
}

/** 重新加载被测模块：`DEFAULT_SETTINGS` 是模块级常量，必须在桩好环境后 import。 */
async function importFresh() {
  vi.resetModules()
  return await import('./settings')
}

describe('偏好设置默认值', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
    setNavigatorLanguage('zh-CN')
  })

  it('系统语言是英文、且用户从未设置过 → 首次启动仍是中文（这就是真机反馈的那条）', async () => {
    setNavigatorLanguage('en-US')
    expect(navigator.language).toBe('en-US') // 桩真的生效了，断言不是空转
    const { loadSettings } = await importFresh()
    expect(loadSettings().language).toBe('zh')
  })

  it('系统语言是中文、且用户从未设置过 → 中文（与上一条同结论，这里防「只是把判断反过来」）', async () => {
    setNavigatorLanguage('zh-CN')
    const { loadSettings } = await importFresh()
    expect(loadSettings().language).toBe('zh')
  })

  it('系统语言是其它语种（ja-JP / de-DE）→ 仍回落中文，而不是英文', async () => {
    for (const lang of ['ja-JP', 'de-DE', 'fr-FR']) {
      setNavigatorLanguage(lang)
      const { loadSettings } = await importFresh()
      expect(loadSettings().language, lang).toBe('zh')
    }
  })

  it('用户显式切换过英文 → 尊重用户选择（系统语言是中文也不改回来）', async () => {
    setNavigatorLanguage('zh-CN')
    const { loadSettings, saveSettings } = await importFresh()
    saveSettings({ language: 'en' })
    expect(loadSettings().language).toBe('en')
    expect(JSON.parse(localStorage.getItem('thunder_settings') as string).language).toBe('en')
  })

  it('用户显式切换过英文 → 系统语言换成英文时也仍是用户选的英文（不重复判定）', async () => {
    const { saveSettings } = await importFresh()
    saveSettings({ language: 'en' })
    setNavigatorLanguage('en-US')
    const { loadSettings } = await importFresh()
    expect(loadSettings().language).toBe('en')
  })

  it('时区默认 Asia/Shanghai，且只改语言不会把时区弄丢', async () => {
    setNavigatorLanguage('en-US')
    const { loadSettings, saveSettings } = await importFresh()
    expect(loadSettings().timezone).toBe('Asia/Shanghai')
    saveSettings({ language: 'en' })
    expect(loadSettings().timezone).toBe('Asia/Shanghai')
    saveSettings({ timezone: 'Asia/Tokyo' })
    expect(loadSettings()).toEqual({ timezone: 'Asia/Tokyo', language: 'en' })
  })

  it('持久化内容损坏时不抛异常，回落默认设置', async () => {
    localStorage.setItem('thunder_settings', '{ not json')
    const { loadSettings } = await importFresh()
    expect(loadSettings()).toEqual({ timezone: 'Asia/Shanghai', language: 'zh' })
  })

  it('旧版本缺字段时用默认值补齐（language 缺失 → 中文）', async () => {
    setNavigatorLanguage('en-US')
    localStorage.setItem('thunder_settings', JSON.stringify({ timezone: 'Asia/Tokyo' }))
    const { loadSettings } = await importFresh()
    expect(loadSettings()).toEqual({ timezone: 'Asia/Tokyo', language: 'zh' })
  })
})
