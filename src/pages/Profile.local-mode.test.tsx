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
 * 3. 「安全设置 / 绑定管理 / 危险操作」改用降级文案，而不是禁用控件；
 *    桌面分支不变（三个调用照常发起、无「分类管理」入口、无降级文案）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ProfilePage from './Profile'
import { useStore } from '@/store'
import { ANDROID_PLATFORM_CLASS } from '@/platform'

const setAndroid = (on: boolean) => {
  document.documentElement.classList.toggle(ANDROID_PLATFORM_CLASS, on)
}

const api = {
  getAccountBindings: vi.fn().mockResolvedValue(null),
  getUserStats: vi.fn().mockResolvedValue({ billCount: 3, categoryCount: 2, totalExpense: 120.5, totalIncome: 5000 }),
  isCloudSyncEnabled: vi.fn().mockResolvedValue(false)
}

describe('Profile 本地模式门禁', () => {
  beforeEach(() => {
    setAndroid(false)
    vi.clearAllMocks()
    useStore.setState({ user: null, toasts: [] })
    Object.defineProperty(window, 'electronAPI', { writable: true, value: api })
  })
  afterEach(() => setAndroid(false))

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

  it('安卓本地模式：安全设置/绑定管理/危险操作改为降级文案（不是禁用控件）', async () => {
    setAndroid(true)
    render(<ProfilePage />)
    fireEvent.click(screen.getByRole('button', { name: /安全设置/ }))
    expect(screen.getByText(/「修改密码」不可用/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /绑定管理/ }))
    expect(screen.getByText(/邮箱\/手机绑定不可用/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /危险操作/ }))
    expect(screen.getByText(/「注销账号」不可用/)).toBeInTheDocument()
  })

  it('安卓本地模式：「分类管理」入口存在，点击后切到 categories 页', async () => {
    setAndroid(true)
    render(<ProfilePage />)
    fireEvent.click(screen.getByRole('button', { name: '分类管理' }))
    expect(useStore.getState().activePage).toBe('categories')
  })
})
