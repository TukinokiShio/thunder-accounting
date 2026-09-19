/**
 * App 数据加载门禁（P2-5）。
 *
 * 背景：安卓首版 `user` 恒为 null（无账号体系），若加载门仍写成 `if (user)`，
 * 则分类与账单恒空 →「记一笔」不可用。因此门改为「桌面看 user / 本地模式看会话是否已判定」。
 * 同时必须证明**桌面条件逐位不变**（`user` 为 null 时不加载）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'
import { ANDROID_PLATFORM_CLASS } from '@/platform'

const refreshBills = vi.fn()
const refreshCategories = vi.fn()
const refreshRecurrings = vi.fn()
const setUser = vi.fn()
const setCheckingSession = vi.fn()
const setActivePage = vi.fn()

const state = {
  activePage: 'home' as 'home' | 'bills' | 'stats' | 'recurring' | 'categories' | 'profile',
  openAddDialog: vi.fn(),
  user: null as unknown,
  isCheckingSession: false,
  setUser,
  setCheckingSession,
  setActivePage,
  refreshBills,
  refreshCategories,
  refreshRecurrings
}

vi.mock('@/store', () => ({
  useStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), {
    getState: () => state
  })
}))
vi.mock('@/components/Layout', () => ({ Layout: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('@/components/AuthGuard', () => ({ AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('@/components/Toast', () => ({ ToastContainer: () => null }))
vi.mock('@/components/AddBillDialog', () => ({ AddBillDialog: () => null }))
// 用最小替身暴露 onClose —— 验证 App 传给分类管理页的**不是空函数**（旧版 `() => {}`）。
vi.mock('@/components/CategoryManager', () => ({
  CategoryManager: ({ onClose }: { onClose: () => void }) => (
    <button type="button" data-testid="categories-close" onClick={onClose} />
  )
}))
vi.mock('@/components/SettingsDialog', () => ({ SettingsDialog: () => null }))
vi.mock('@/pages/Home', () => ({ Home: () => null }))
vi.mock('@/pages/Bills', () => ({ Bills: () => null }))
vi.mock('@/pages/Stats', () => ({ Stats: () => null }))
vi.mock('@/pages/Profile', () => ({ default: () => null }))
vi.mock('@/i18n/LanguageContext', () => ({ LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

const setAndroid = (on: boolean) => {
  document.documentElement.classList.toggle(ANDROID_PLATFORM_CLASS, on)
}

describe('App 数据加载门（本地模式）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setAndroid(false)
    state.user = null
    state.isCheckingSession = false
    state.activePage = 'home'
    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      value: {
        loadCredentials: vi.fn().mockResolvedValue({ autoLogin: false }),
        checkSession: vi.fn().mockResolvedValue(null),
        onShortcut: vi.fn(() => () => undefined)
      }
    })
  })
  afterEach(() => setAndroid(false))

  it('桌面 + 未登录 → 不加载账单/分类（原逻辑不变）', async () => {
    render(<App />)
    await waitFor(() => expect(window.electronAPI.checkSession).toHaveBeenCalled())
    expect(refreshBills).not.toHaveBeenCalled()
    expect(refreshCategories).not.toHaveBeenCalled()
  })

  it('安卓本地模式 + 会话已判定 → 加载账单/分类（分类不为空、记一笔可用）', async () => {
    setAndroid(true)
    render(<App />)
    await waitFor(() => expect(refreshBills).toHaveBeenCalled())
    expect(refreshCategories).toHaveBeenCalled()
  })

  it('安卓本地模式 + 仍在判定会话 → 先不加载（避免空库竞态）', async () => {
    setAndroid(true)
    state.isCheckingSession = true
    render(<App />)
    await waitFor(() => expect(window.electronAPI.checkSession).toHaveBeenCalled())
    expect(refreshBills).not.toHaveBeenCalled()
  })

  it('分类管理页的关闭/返回回调接到「我的」（不再是空函数 `() => {}`）', async () => {
    state.activePage = 'categories'
    render(<App />)

    fireEvent.click(screen.getByTestId('categories-close'))
    expect(setActivePage).toHaveBeenCalledWith('profile')
  })
})
