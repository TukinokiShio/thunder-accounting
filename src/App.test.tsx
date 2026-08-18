import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import App from './App'

const mockSetUser = vi.fn()
const mockSetCheckingSession = vi.fn()
const mockCheckSession = vi.fn()
const mockLoadCredentials = vi.fn()

const state = {
  activePage: 'home' as const,
  openAddDialog: vi.fn(),
  user: null,
  setUser: mockSetUser,
  setCheckingSession: mockSetCheckingSession,
  refreshBills: vi.fn(),
  refreshCategories: vi.fn()
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
vi.mock('@/components/CategoryManager', () => ({ CategoryManager: () => null }))
vi.mock('@/components/SettingsDialog', () => ({ SettingsDialog: () => null }))
vi.mock('@/pages/Home', () => ({ Home: () => null }))
vi.mock('@/pages/Bills', () => ({ Bills: () => null }))
vi.mock('@/pages/Stats', () => ({ Stats: () => null }))
vi.mock('@/pages/Profile', () => ({ default: () => null }))
vi.mock('@/i18n/LanguageContext', () => ({ LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

describe('App automatic session restoration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      value: {
        loadCredentials: mockLoadCredentials,
        checkSession: mockCheckSession,
        onShortcut: vi.fn(() => () => undefined)
      }
    })
  })

  it('only asks the main process to restore a session when auto login is enabled', async () => {
    mockLoadCredentials.mockResolvedValue({ identifier: '13800138000', rememberAccount: true, autoLogin: false })
    mockCheckSession.mockResolvedValue(null)

    render(<App />)

    await waitFor(() => expect(mockCheckSession).toHaveBeenCalledWith(false))
    expect(mockSetUser).toHaveBeenCalledWith(null)
  })

  it('restores the authenticated user when auto login is enabled', async () => {
    const user = { uid: 'phone-user', email: 'phone@example.com' }
    mockLoadCredentials.mockResolvedValue({ identifier: '13800138000', rememberAccount: true, autoLogin: true })
    mockCheckSession.mockResolvedValue({ user })

    render(<App />)

    await waitFor(() => expect(mockCheckSession).toHaveBeenCalledWith(true))
    expect(mockSetUser).toHaveBeenCalledWith(user)
  })
})
