/**
 * Profile「我的」页门禁：云端能力门（P2-5 / RL-A9）+ **真机反馈三条**的回归锁。
 *
 * 真机反馈（2026-09）三条，各自对应下面的一组断言：
 *  ① 首启是英文 —— 根因在 `src/utils/settings.ts` 的默认语言跟随 `navigator.language`，
 *     与页面无关。本文件**不重复**测那一条（由 `src/utils/settings.test.ts` 覆盖），
 *     这里只锁定「语言在安卓端**就在本页**可直接切换、且切换后页面文案真的变」。
 *  ② 语言切换入口被裁在屏幕外 —— 旧版安卓「我的」页是「4 项 chip 导航 + 横向滚动容器」，
 *     第 4 项被裁掉。修法是**不再渲染导航**（单面板）。断言分两层：
 *     · 结构层（本文件，jsdom）：页面里不存在 `<nav>`，也没有任何 `overflow-x-*` 容器，
 *       且 `mobile/android.css` 去掉注释后不再含 `.profile-nav` 规则；
 *     · 几何层（`scripts/verify-profile-mobile.cjs`，真实 Chromium + 真实构建 CSS）：
 *       语言切换器在视口内、且每个元素 `scrollWidth <= clientWidth`。
 *     jsdom 没有排版引擎（`scrollWidth`/`getBoundingClientRect` 恒为 0），几何断言放在
 *     jsdom 里就是**不可能失败的空断言**，所以这里不写。
 *  ③ 「我的」页约 70% 空白 —— 内容高度是几何量，同样由 `verify-profile-mobile.cjs` 断言
 *     （内容 ≥ 可用内容带的 60%）；本文件断言的是「内容块齐备」（产生高度的来源）。
 *
 * 桌面分支的等价强度（原有断言一条都没有被弱化）：
 *  · 两个真正依赖云的挂载期调用照常发起、5 个 Tab 齐备、无「分类管理」入口、无本地降级文案。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ProfilePage from './Profile'
import { useStore } from '@/store'
import { LanguageProvider } from '@/i18n/LanguageContext'
import { ANDROID_PLATFORM_CLASS } from '@/platform'

const setAndroid = (on: boolean) => {
  document.documentElement.classList.toggle(ANDROID_PLATFORM_CLASS, on)
}

const api = {
  getAccountBindings: vi.fn().mockResolvedValue(null),
  getUserStats: vi.fn().mockResolvedValue({ billCount: 3, categoryCount: 2, totalExpense: 120.5, totalIncome: 5000 }),
  isCloudSyncEnabled: vi.fn().mockResolvedValue(false)
}

/** 安卓本地模式的正常渲染路径：必须带 `LanguageProvider`（否则语言切换是空实现）。 */
function renderAndroidProfile() {
  setAndroid(true)
  return render(
    <LanguageProvider>
      <ProfilePage />
    </LanguageProvider>
  )
}

describe('Profile 本地模式门禁', () => {
  beforeEach(() => {
    setAndroid(false)
    vi.clearAllMocks()
    useStore.setState({ user: null, toasts: [], settingsOpen: false })
    localStorage.setItem('thunder_settings', JSON.stringify({ timezone: 'Asia/Shanghai', language: 'zh' }))
    Object.defineProperty(window, 'electronAPI', { writable: true, value: api })
  })
  afterEach(() => {
    setAndroid(false)
    localStorage.clear()
  })

  /* ───────────────── 桌面：等价强度（原有断言一条都没弱化） ───────────────── */

  it('桌面：三个挂载期调用照常发起（原逻辑不变）', async () => {
    render(<ProfilePage />)
    await waitFor(() => expect(api.getAccountBindings).toHaveBeenCalledTimes(1))
    expect(api.getUserStats).toHaveBeenCalledTimes(1)
    expect(api.isCloudSyncEnabled).toHaveBeenCalledTimes(1)
  })

  it('桌面：不出现「分类管理」入口，也不出现本地模式降级文案', async () => {
    render(<ProfilePage />)
    await waitFor(() => expect(api.isCloudSyncEnabled).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: '分类管理' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /安全设置/ }))
    expect(screen.queryByText(/未接入云端账号服务/)).not.toBeInTheDocument()
  })

  it('桌面：导航仍是 5 个 Tab 且都带图标（安卓重做不影响桌面）', async () => {
    const { container } = render(<ProfilePage />)
    const nav = screen.getByRole('navigation')
    expect(within(nav).getAllByRole('button')).toHaveLength(5)
    for (const label of ['账号信息', '安全设置', '绑定管理', '数据概览', '危险操作']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    // 桌面 Tab 保留图标（安卓单面板里没有导航，自然也没有图标），5 个 Tab = 5 个 svg
    expect(nav.querySelectorAll('svg')).toHaveLength(5)
    // 桌面上没有安卓本机账本面板
    expect(container.querySelector('[data-testid="local-profile"]')).toBeNull()
  })

  it('桌面：语言切换器不在「我的」页（桌面入口仍是侧栏的设置弹窗）', async () => {
    render(<ProfilePage />)
    await waitFor(() => expect(api.isCloudSyncEnabled).toHaveBeenCalled())
    expect(screen.queryByRole('group', { name: '语言' })).not.toBeInTheDocument()
    expect(screen.queryByText('偏好设置')).not.toBeInTheDocument()
  })

  /* ───────────────── 安卓本地模式：能力门 ───────────────── */

  it('安卓本地模式：两个云调用不发起，但本地 getUserStats 照常发起', async () => {
    renderAndroidProfile()
    await waitFor(() => expect(api.getUserStats).toHaveBeenCalledTimes(1))
    expect(api.getAccountBindings).not.toHaveBeenCalled()
    expect(api.isCloudSyncEnabled).not.toHaveBeenCalled()
  })

  it('安卓本地模式：数据概览**直接**渲染真实本地数值（不需要先点任何 Tab）', async () => {
    renderAndroidProfile()
    await waitFor(() => expect(api.getUserStats).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('账单总数')).toBeInTheDocument())
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('分类总数')).toBeInTheDocument()
    expect(screen.getByText('累计支出')).toBeInTheDocument()
    expect(screen.getByText('累计收入')).toBeInTheDocument()
    expect(screen.getByText('净收支')).toBeInTheDocument()
    expect(screen.queryByText('暂无数据概览')).not.toBeInTheDocument()
  })

  /* ───────────────── 安卓本地模式：问题 ②（入口被裁） ───────────────── */

  it('安卓本地模式：页面里不存在任何导航（横向滚动容器从结构上被消除）', async () => {
    const { container } = renderAndroidProfile()
    await waitFor(() => expect(api.getUserStats).toHaveBeenCalledTimes(1))

    // 旧版这里是一个 4 项 chip 的 <nav> + `flex-wrap: nowrap` + 横向滚动
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(container.querySelectorAll('nav')).toHaveLength(0)

    // 面板内每一个元素都不能是横向裁剪容器（Tailwind 的 overflow-x-* 工具类）
    const panel = screen.getByTestId('local-profile')
    const nodes = [panel, ...Array.from(panel.querySelectorAll<HTMLElement>('*'))]
    const clippers = nodes
      .filter((el) => /(^|\s)overflow-x-(auto|scroll|hidden)\b/.test(el.className))
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).slice(0, 3).join('.')}`)
    expect(clippers).toEqual([])
  })

  it('安卓本地模式：`mobile/android.css` 已不再针对 .profile-nav 输出任何规则', async () => {
    const css = readFileSync(resolve(process.cwd(), 'mobile', 'android.css'), 'utf8')
    // 去掉注释后（注释里会解释这次修法）不应再出现该选择器
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).not.toContain('.profile-nav')
    // 且整份文件不出现「水平裁剪」的写法（本文件自己的硬约束 #2）
    expect(code).not.toContain('overflow-x: hidden')
    expect(code).not.toContain('scrollbar-gutter: stable both-edges')
  })

  /* ───────────────── 安卓本地模式：问题 ③（70% 空白 / 编造身份） ───────────────── */

  it('安卓本地模式：不编造用户身份 —— 没有「未知用户 / Unknown user」', async () => {
    renderAndroidProfile()
    await waitFor(() => expect(api.getUserStats).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('未知用户')).not.toBeInTheDocument()
    expect(screen.queryByText('Unknown user')).not.toBeInTheDocument()
    expect(screen.getByText('本地模式')).toBeInTheDocument()
    expect(screen.getByText('数据保存在本机，无需登录即可使用。')).toBeInTheDocument()
  })

  it('安卓本地模式：不留账号 ID 的永久「加载中...」占位，也不渲染误导性的「退出登录」', async () => {
    renderAndroidProfile()
    await waitFor(() => expect(api.getUserStats).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('加载中...')).not.toBeInTheDocument()
    expect(screen.queryByText('雷霆记账账号')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '退出登录' })).not.toBeInTheDocument()
  })

  it('安卓本地模式：六个内容区块齐备（内容高度 ≥ 可用内容带 60% 的来源）', async () => {
    renderAndroidProfile()
    await waitFor(() => expect(api.getUserStats).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('数据概览')).toBeInTheDocument())

    expect(screen.getByText('本地模式')).toBeInTheDocument()          // ① 本机身份
    expect(screen.getByText('账单总数')).toBeInTheDocument()          // ② 数据概览
    expect(screen.getByText('数据管理')).toBeInTheDocument()          // ③ 数据管理
    expect(screen.getByRole('button', { name: '分类管理' })).toBeInTheDocument() // ④ 分类管理
    expect(screen.getByText('偏好设置')).toBeInTheDocument()          // ⑤ 偏好设置
    expect(screen.getByText('关于')).toBeInTheDocument()              // ⑥ 关于

    // 数据管理三件套是**真实可用**的（复用与设置弹窗同一份实现）
    expect(screen.getByText('导出备份')).toBeInTheDocument()
    expect(screen.getByText('导入备份')).toBeInTheDocument()
    expect(screen.getByText('清除所有数据')).toBeInTheDocument()

    // 语言切换器排在**数据概览之前** —— 这是「首屏可见」的结构前提（约 360px 高的数据概览
    // 会把它推到首屏之外）。真正的几何判据在 `scripts/verify-profile-mobile.cjs`。
    const headings = Array.from(screen.getByTestId('local-profile').querySelectorAll('h2, h3'))
      .map((h) => h.textContent ?? '')
    expect(headings.indexOf('偏好设置')).toBeGreaterThanOrEqual(0)
    expect(headings.indexOf('偏好设置')).toBeLessThan(headings.indexOf('数据概览'))
  })

  it('安卓本地模式：「关于」不讲本机模式下为假的话（无快捷键行、无云端同步）', async () => {
    renderAndroidProfile()
    await waitFor(() => expect(api.getUserStats).toHaveBeenCalledTimes(1))
    expect(screen.getByText('本地 SQLite 数据库，无需网络')).toBeInTheDocument()
    expect(screen.queryByText('本地 SQLite + 云端同步')).not.toBeInTheDocument()
    // 触屏设备没有 Ctrl 键 → 不该出现「快捷键 Ctrl+N」
    expect(screen.queryByText('快捷键')).not.toBeInTheDocument()
  })

  it('安卓本地模式：「分类管理」入口存在，点击后切到 categories 页', async () => {
    renderAndroidProfile()
    fireEvent.click(screen.getByRole('button', { name: '分类管理' }))
    expect(useStore.getState().activePage).toBe('categories')
  })

  /* ───────────────── 安卓本地模式：问题 ①（语言切换） ───────────────── */

  it('安卓本地模式：语言切换器渲染后**直接可见可点**（不依赖设置弹窗）', async () => {
    const { container } = renderAndroidProfile()
    await waitFor(() => expect(api.getUserStats).toHaveBeenCalledTimes(1))

    // 全程没有任何点击，切换器就已经在页面里
    const group = screen.getByRole('group', { name: '语言' })
    expect(within(group).getByRole('button', { name: '中文' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(group).getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'false')
    // 它不是弹窗里的东西（没有 dialog / portal 遮罩）
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('安卓本地模式：点 English → 页面文案真的变英文；点中文 → 变回', async () => {
    renderAndroidProfile()
    await waitFor(() => expect(api.getUserStats).toHaveBeenCalledTimes(1))

    fireEvent.click(within(screen.getByRole('group', { name: '语言' })).getByRole('button', { name: 'English' }))

    // 语言切换器自身的状态
    expect(within(screen.getByRole('group', { name: 'Language' })).getByRole('button', { name: 'English' }))
      .toHaveAttribute('aria-pressed', 'true')
    // 页面文案真的换了（不是只有 aria-pressed 翻转）
    expect(screen.getByText('Preferences')).toBeInTheDocument()
    expect(screen.getByText('Data Management')).toBeInTheDocument()
    expect(screen.getByText('Data Overview')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Categories' })).toBeInTheDocument()
    expect(screen.queryByText('偏好设置')).not.toBeInTheDocument()
    expect(screen.queryByText('数据管理')).not.toBeInTheDocument()
    // 英文下也不出现编造的用户名
    expect(screen.queryByText('Unknown user')).not.toBeInTheDocument()

    fireEvent.click(within(screen.getByRole('group', { name: 'Language' })).getByRole('button', { name: '中文' }))
    expect(screen.getByText('偏好设置')).toBeInTheDocument()
    expect(screen.queryByText('Preferences')).not.toBeInTheDocument()
  })
})
