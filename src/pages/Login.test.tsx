import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LoginPage } from './Login'

const mockSetUser = vi.fn()
const mockAddToast = vi.fn()
let currentLanguage: 'zh' | 'en' = 'zh'
const mockSetLanguage = vi.fn((language: 'zh' | 'en') => { currentLanguage = language })
const mockLoadCredentials = vi.fn()
const mockLogin = vi.fn()
const mockLoginWithCode = vi.fn()
const mockRegister = vi.fn()
const mockSendCode = vi.fn()
const mockResetPassword = vi.fn()
const mockSaveCredentials = vi.fn()

vi.mock('@/store', () => ({ useStore: (select: (value: unknown) => unknown) => select({ setUser: mockSetUser, addToast: mockAddToast }) }))
vi.mock('@/i18n/LanguageContext', () => ({ useLanguage: () => ({ language: currentLanguage, setLanguage: mockSetLanguage }) }))
vi.mock('@/utils/errorMessages', () => ({ friendlyError: (error: Error) => error.message }))

function installApi() {
  ;(window as any).electronAPI = {
    loadCredentials: mockLoadCredentials, login: mockLogin, loginWithCode: mockLoginWithCode,
    register: mockRegister, sendCode: mockSendCode, resetPassword: mockResetPassword,
    saveCredentials: mockSaveCredentials,
  }
}
const account = () => screen.getByLabelText('账号')
const password = () => screen.getByLabelText('密码')
const enter = (element: HTMLElement, value: string) => fireEvent.change(element, { target: { value } })
async function renderPage() {
  render(<LoginPage />)
  await waitFor(() => expect(mockLoadCredentials).toHaveBeenCalledTimes(1))
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentLanguage = 'zh'
    mockLoadCredentials.mockResolvedValue({ identifier: '', rememberAccount: true, autoLogin: false })
    installApi()
  })

  it('defaults to account/password login with an email-or-phone account input', () => {
    render(<LoginPage />)
    expect(screen.getByRole('heading', { level: 1, name: '雷霆记账' })).toBeInTheDocument()
    expect(account()).toHaveAttribute('placeholder', '邮箱或手机号')
    expect(account().parentElement?.querySelector('svg.lucide-user-round')).toBeTruthy()
    expect(password()).toBeInTheDocument()
    expect(screen.getByText('账号密码')).toBeInTheDocument()
    expect(screen.getByText('手机验证码')).toBeInTheDocument()
    expect(screen.getByText('邮箱验证码')).toBeInTheDocument()
    expect(screen.queryByLabelText('验证码')).not.toBeInTheDocument()
  })

  it('uses email/password sign in for an email account', async () => {
    mockLogin.mockResolvedValue({ user: { uid: 'u1', email: 'test@example.com' } })
    await renderPage()
    enter(account(), 'test@example.com')
    enter(password(), 'password123')
    fireEvent.click(screen.getAllByRole('button', { name: '登录' }).at(-1)!)
    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123'))
    expect(mockSaveCredentials).toHaveBeenCalledWith('test@example.com', true, false)
  })

  it('uses phone/password sign in and saves the phone preference', async () => {
    mockLogin.mockResolvedValue({ user: { uid: 'u2', phone: '13800138000' } })
    await renderPage()
    enter(account(), '13800138000')
    enter(password(), 'password123')
    fireEvent.click(screen.getAllByRole('button', { name: '登录' }).at(-1)!)
    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith('13800138000', 'password123'))
    expect(mockSaveCredentials).toHaveBeenCalledWith('13800138000', true, false)
  })

  it('uses phone-code login only with a phone and clears code state when target changes', async () => {
    mockSendCode.mockResolvedValue({ type: 'phone', target: '13800138000', verificationId: 'phone-id', isUser: true })
    mockLoginWithCode.mockResolvedValue({ user: { uid: 'u1', phone: '13800138000' } })
    await renderPage()
    fireEvent.click(screen.getByText('手机验证码'))
    expect(screen.getByLabelText('手机号')).toBeInTheDocument()
    expect(screen.getByLabelText('手机号').parentElement?.querySelector('svg.lucide-smartphone')).toBeTruthy()
    enter(screen.getByLabelText('手机号'), 'test@example.com')
    expect(screen.getByRole('button', { name: '获取验证码' })).toBeDisabled()
    enter(screen.getByLabelText('手机号'), '13800138000')
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))
    await waitFor(() => expect(mockSendCode).toHaveBeenCalledWith('13800138000', true))
    enter(screen.getByLabelText('验证码'), '123456')
    enter(screen.getByLabelText('手机号'), '13900139000')
    fireEvent.click(screen.getAllByRole('button', { name: '登录' }).at(-1)!)
    expect(mockLoginWithCode).not.toHaveBeenCalled()
    expect(mockAddToast).toHaveBeenCalledWith('error', '请先发送验证码')
  })

  it('uses email-code login only with an email', async () => {
    mockSendCode.mockResolvedValue({ type: 'email', target: 'test@example.com', verificationId: 'mail-id', isUser: true })
    mockLoginWithCode.mockResolvedValue({ user: { uid: 'u1', email: 'test@example.com' } })
    await renderPage()
    fireEvent.click(screen.getByText('邮箱验证码'))
    expect(screen.getByLabelText('邮箱')).toBeInTheDocument()
    expect(screen.getByLabelText('邮箱').parentElement?.querySelector('svg.lucide-mail')).toBeTruthy()
    enter(screen.getByLabelText('邮箱'), '13800138000')
    expect(screen.getByRole('button', { name: '获取验证码' })).toBeDisabled()
    enter(screen.getByLabelText('邮箱'), 'test@example.com')
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))
    await waitFor(() => expect(mockSendCode).toHaveBeenCalledWith('test@example.com', true))
    enter(screen.getByLabelText('验证码'), '123456')
    fireEvent.click(screen.getAllByRole('button', { name: '登录' }).at(-1)!)
    await waitFor(() => expect(mockLoginWithCode).toHaveBeenCalledWith('test@example.com', '123456', 'mail-id'))
  })

  it('keeps registration and password recovery flows', async () => {
    await renderPage()
    const forgotButton = screen.getByRole('button', { name: '忘记密码？' })
    const registerButton = screen.getByRole('button', { name: '注册' })
    expect(screen.getByText('还没有账号？')).toBeInTheDocument()
    expect(forgotButton).toHaveClass('min-h-8', 'text-[var(--accent)]')
    expect(forgotButton).toHaveClass('text-sm')
    expect(screen.getByText('记住账号').closest('label')).toHaveClass('text-sm')
    expect(registerButton).toHaveClass('min-h-8', 'text-[var(--accent)]')
    expect(registerButton).toHaveClass(...forgotButton.className.split(' '))

    fireEvent.click(registerButton)
    expect(screen.getByLabelText('设置密码')).toBeInTheDocument()
    expect(screen.getByLabelText('确认密码')).toBeInTheDocument()
    expect(screen.getByLabelText('验证码')).toBeInTheDocument()
    fireEvent.click(screen.getByText('登录'))
    fireEvent.click(screen.getByRole('button', { name: '忘记密码？' }))
    expect(screen.getByLabelText('新密码')).toBeInTheDocument()
    expect(screen.getByLabelText('确认新密码')).toBeInTheDocument()
  })

  it('loads saved account preferences without persisting a password', async () => {
    mockLoadCredentials.mockResolvedValue({ identifier: 'saved@example.com', rememberAccount: true, autoLogin: true })
    await renderPage()
    await waitFor(() => expect(account()).toHaveValue('saved@example.com'))
    expect(screen.getAllByRole('checkbox')[0]).toBeChecked()
    expect(screen.getAllByRole('checkbox')[1]).toBeChecked()
  })

  it('shows validation errors for an empty or invalid account', async () => {
    await renderPage()
    fireEvent.click(screen.getAllByRole('button', { name: '登录' }).at(-1)!)
    expect(mockAddToast).toHaveBeenCalledWith('error', '请输入有效的邮箱或手机号')
    enter(account(), 'bad')
    fireEvent.click(screen.getAllByRole('button', { name: '登录' }).at(-1)!)
    expect(mockAddToast).toHaveBeenLastCalledWith('error', '请输入有效的邮箱或手机号')
  })

  it('does not validate password while typing and submits it to the login API', async () => {
    mockLogin.mockResolvedValue({ user: { uid: 'u1', email: 'test@example.com' } })
    await renderPage()
    enter(account(), 'test@example.com')
    enter(password(), '123')
    expect(password().parentElement?.querySelector('svg.lucide-check, svg.lucide-x')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: '登录' }).at(-1)!)
    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith('test@example.com', '123'))
    expect(mockAddToast).not.toHaveBeenCalledWith('error', '密码至少 6 位')
  })

  it('sends an unrestricted registration code for a valid account', async () => {
    mockSendCode.mockResolvedValue({ type: 'email', target: 'new@example.com', verificationId: 'registration-id', isUser: false })
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: '注册' }))
    enter(screen.getByLabelText('账号'), 'new@example.com')
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))
    await waitFor(() => expect(mockSendCode).toHaveBeenCalledWith('new@example.com', false))
  })

  it('supports phone registration as an explicit channel', async () => {
    mockSendCode.mockResolvedValue({ type: 'phone', target: '13800138000', verificationId: 'phone-registration-id', isUser: false })
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: '注册' }))
    fireEvent.click(screen.getByRole('button', { name: '手机号注册' }))
    enter(screen.getByLabelText('账号'), '13800138000')
    fireEvent.click(screen.getByRole('button', { name: '获取验证码' }))
    await waitFor(() => expect(mockSendCode).toHaveBeenCalledWith('13800138000', false))
  })

  it('returns from other sign-in methods to password sign in', async () => {
    await renderPage()
    fireEvent.click(screen.getByText('手机验证码'))
    expect(screen.getByRole('button', { name: '返回账号密码登录' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '返回账号密码登录' }))
    expect(screen.getByLabelText('密码')).toBeInTheDocument()
  })

  it('toggles password visibility', async () => {
    await renderPage()
    const showButton = screen.getByRole('button', { name: '显示密码' })
    expect(password()).toHaveAttribute('type', 'password')
    expect(showButton).toHaveAttribute('aria-pressed', 'false')
    expect(showButton).toHaveClass('h-11', 'w-11', 'appearance-none', 'rounded-none', 'border-0', 'bg-transparent', 'shadow-none', 'hover:bg-transparent', 'active:bg-transparent')
    expect(showButton).not.toHaveClass('rounded-lg', 'rounded-md', 'rounded')
    fireEvent.click(showButton)
    expect(password()).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: '隐藏密码' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '隐藏密码' }))
    expect(password()).toHaveAttribute('type', 'password')
  })

  it('clearing remember account also clears automatic sign-in preference', async () => {
    await renderPage()
    const [rememberBox, autoLoginBox] = screen.getAllByRole('checkbox')
    fireEvent.click(autoLoginBox)
    fireEvent.click(rememberBox)
    expect(mockSaveCredentials).toHaveBeenCalledWith('', false, false)
    expect(autoLoginBox).toBeDisabled()
  })

  it('shows a localized login failure returned by the auth layer', async () => {
    mockLogin.mockRejectedValue(new Error('邮箱或密码错误'))
    await renderPage()
    enter(account(), 'test@example.com')
    enter(password(), 'password123')
    fireEvent.click(screen.getAllByRole('button', { name: '登录' }).at(-1)!)
    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith('error', '邮箱或密码错误'))
  })
})
