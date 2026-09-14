/**
 * Profile 云端能力门 + 「分类管理」归置（P2-5 / RL-A9 修正版）。
 *
 * 三条必须证明的事：
 * 1. 安卓本地模式下，**两个真正依赖云的**挂载期调用（getAccountBindings / isCloudSyncEnabled）
 *    不发起；
 * 2. **`getUserStats` 仍然发起** —— 桌面 `cloudbase.ts` 与 `android-adapter.ts:389-395` 都证明
 *    它是本地库聚合，与云无关；被云门挡住会让「数据概览」恒为空态（真缺陷）。
 *    ⚠ RL-A9 原措辞「:91/:103/:114 三个挂载期云调用」有误：`:103` 的 getUserStats 是本地调用，
 *    门控范围应为 **2 个云调用 + 1 个本地调用**。
 * 3. 「安全设置 / 绑定管理 / 危险操作」在安卓本地模式下**整体不渲染**（导航里没有这三项），
 *    而不是渲染成一句"不可用"的空壳；桌面分支不变（三个调用照常发起、5 个 Tab 齐备、
 *    无「分类管理」入口、无降级文案）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ProfilePage from './Profile'
import { SettingsDialog } from '@/components/SettingsDialog'
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

/** 用 store 里的 settingsOpen 驱动真实 SettingsDialog —— 验证「我的 → 设置」这条链路。 */
function SettingsHost() {
  const settingsOpen = useStore((s) => s.settingsOpen)
  const closeSettings = useStore((s) => s.closeSettings)
  return <SettingsDialog isOpen={settingsOpen} onClose={closeSettings} />
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

  it('桌面：导航仍是 5 个 Tab（安卓裁剪不影响桌面）', async () => {
    render(<ProfilePage />)
    const nav = screen.getByRole('navigation')
    expect(within(nav).getAllByRole('button')).toHaveLength(5)
    for (const label of ['账号信息', '安全设置', '绑定管理', '数据概览', '危险操作']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('安卓本地模式：两个云调用不发起，但本地 getUserStats 照常发起', async () => {
    setAndroid(true)
    render(<ProfilePage />)
    await waitFor(() => expect(api.getUserStats).toHaveBeenCalledTimes(1))
    expect(api.getAccountBindings).not.toHaveBeenCalled()
    expect(api.isCloudSyncEnabled).not.toHaveBeenCalled()
  })

  it('安卓本地模式：数据概览渲染真实本地数值（不是空态）', async () => {
    setAndroid(true)
    render(<ProfilePage />)
    await waitFor(() => expect(api.getUserStats).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: /数据概览/ }))
    expect(screen.getByText('账单总数')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.queryByText('暂无数据概览')).not.toBeInTheDocument()
  })

  it('安卓本地模式：云端能力对应的 3 个 Tab 整体不渲染（不是渲染成空壳 + 一句"不可用"）', async () => {
    setAndroid(true)
    render(<ProfilePage />)
    await waitFor(() => expect(api.getUserStats).toHaveBeenCalledTimes(1))

    // 断言强度：不但三项不存在，而且「降级文案」也不再出现在 DOM 里
    for (const label of ['安全设置', '绑定管理', '危险操作']) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
    }
    expect(screen.queryByText(/未接入云端账号服务/)).not.toBeInTheDocument()
    expect(screen.queryByText(/「修改密码」不可用/)).not.toBeInTheDocument()
    expect(screen.queryByText(/邮箱\/手机绑定不可用/)).not.toBeInTheDocument()
    expect(screen.queryByText(/「注销账号」不可用/)).not.toBeInTheDocument()

    // 导航只剩 4 项真实能力：账号信息 / 数据概览 / 分类管理 / 设置
    const nav = screen.getByRole('navigation')
    expect(within(nav).getAllByRole('button')).toHaveLength(4)
    for (const label of ['账号信息', '数据概览', '分类管理', '设置']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('安卓本地模式：不留账号ID 的永久「加载中...」占位，也不渲染误导性的「退出登录」', async () => {
    setAndroid(true)
    render(<ProfilePage />)
    await waitFor(() => expect(api.getUserStats).toHaveBeenCalledTimes(1))

    expect(screen.queryByText('加载中...')).not.toBeInTheDocument()
    expect(screen.queryByText('雷霆记账账号')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '退出登录' })).not.toBeInTheDocument()
    // 本地身份仍然可见
    expect(screen.getByText('本地模式')).toBeInTheDocument()
    expect(screen.getByText('数据保存在本机，无需登录即可使用。')).toBeInTheDocument()
  })

  it('安卓本地模式：「分类管理」入口存在，点击后切到 categories 页', async () => {
    setAndroid(true)
    render(<ProfilePage />)
    fireEvent.click(screen.getByRole('button', { name: '分类管理' }))
    expect(useStore.getState().activePage).toBe('categories')
  })

  it('安卓：「设置」入口打开设置 → 语言切换器可见 → 切换语言后界面文案随之变化', async () => {
    setAndroid(true)
    render(
      <LanguageProvider>
        <ProfilePage />
        <SettingsHost />
      </LanguageProvider>
    )

    // 设置弹窗初始关闭（安卓唯一入口是「我的」页里的「设置」）
    expect(useStore.getState().settingsOpen).toBe(false)
    expect(screen.queryByRole('group', { name: '语言' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '设置' }))

    expect(useStore.getState().settingsOpen).toBe(true)
    expect(screen.getByRole('group', { name: '语言' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'English' }))

    // 语言切换器真实生效：页面与设置弹窗的文案都变成英文
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Categories' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Data Overview' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '分类管理' })).not.toBeInTheDocument()
  })
})
