/**
 * Login 页面（登录/注册/忘记密码）组件测试。
 * 验证三种模式切换、表单校验、验证码发送、密码显示/隐藏、
 * 语言切换、"记住我"复选框、登录/注册/重置流程。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginPage } from './Login';

// ─── Mock useStore ────────────────────────────────
const mockSetUser = vi.fn();
const mockAddToast = vi.fn();

const storeState = {
  setUser: mockSetUser,
  addToast: mockAddToast,
};

vi.mock('@/store', () => ({
  useStore: (selector: any) => selector(storeState),
}));

// ─── Mock LanguageContext ─────────────────────────
let langSettings = { language: 'zh' as 'zh' | 'en' };
const mockSetLanguage = vi.fn().mockImplementation((lang: 'zh' | 'en') => {
  langSettings.language = lang;
});

vi.mock('@/i18n/LanguageContext', () => ({
  useLanguage: () => ({
    language: langSettings.language,
    t: (key: string) => key,
    setLanguage: mockSetLanguage,
  }),
  LanguageProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ─── Mock errorMessages ──────────────────────────
vi.mock('@/utils/errorMessages', () => ({
  friendlyError: vi.fn((e: unknown) => {
    return e instanceof Error ? e.message : String(e);
  }),
}));

// ─── Mock electronAPI helpers ─────────────────────
const mockLoadCredentials = vi.fn().mockResolvedValue({ identifier: '', rememberAccount: false, autoLogin: false });
const mockLogin = vi.fn();
const mockRegister = vi.fn();
const mockSendCode = vi.fn();
const mockResetPassword = vi.fn();
const mockSaveCredentials = vi.fn();

function mockElectronAPI() {
  (window as any).electronAPI = {
    loadCredentials: mockLoadCredentials,
    login: mockLogin,
    register: mockRegister,
    sendCode: mockSendCode,
    resetPassword: mockResetPassword,
    saveCredentials: mockSaveCredentials,
  };
}

// ─── Helper: 填写登录标识符（账号 / 邮箱 / 手机号）─
function fillEmail(value: string) {
  const input = screen.getByPlaceholderText('账号 / 邮箱 / 手机号');
  fireEvent.change(input, { target: { value } });
}

// ─── Helper: 填写注册/忘记密码模式的邮箱 ──────────
function fillEmailReg(value: string) {
  const input = screen.getByPlaceholderText('邮箱或手机号');
  fireEvent.change(input, { target: { value } });
}

// ─── Helper: 填写登录密码或注册的设置密码 ──────────
function fillPassword(value: string) {
  const input = screen.queryByPlaceholderText('••••••') || screen.queryByPlaceholderText('设置密码');
  if (!input) throw new Error('password input missing');
  fireEvent.change(input, { target: { value } });
}

// ─── Helper: 找到密码显示/隐藏切换按钮 ─────────────
function getPwdToggleBtn(): HTMLButtonElement {
  return document.querySelector('button[type="button"]') as HTMLButtonElement;
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    langSettings.language = 'zh';
    mockLoadCredentials.mockResolvedValue({ identifier: '', rememberAccount: false, autoLogin: false });
    mockElectronAPI();
  });

  // ── 1. 渲染登录模式默认UI ─────────────────────
  it('should render login mode default UI', () => {
    render(<LoginPage />);

    // 标识符输入框（登录模式用"账号 / 邮箱 / 手机号"）
    expect(screen.getByPlaceholderText('账号 / 邮箱 / 手机号')).toBeInTheDocument();
    // 密码输入框
    const pwdInput = screen.getByPlaceholderText('••••••');
    expect(pwdInput).toBeInTheDocument();
    expect(pwdInput).toHaveAttribute('type', 'password');
    // Tab 切换：登录/注册 + 密码登录/验证码登录
    expect(screen.getAllByText('登录').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('注册')).toBeInTheDocument();
    // 登录方式 tabs
    expect(screen.getByText('密码登录')).toBeInTheDocument();
    expect(screen.getByText('验证码登录')).toBeInTheDocument();
    // "记住我"
    expect(screen.getByText('记住账号')).toBeInTheDocument();
    // 忘记密码链接
    expect(screen.getByText('忘记密码？')).toBeInTheDocument();
    // 语言切换
    expect(screen.getByText('中')).toBeInTheDocument();
    expect(screen.getByText('EN')).toBeInTheDocument();
    // Logo / 标题
    expect(screen.getByText('雷霆记账')).toBeInTheDocument();
    // 版本号
    expect(screen.getByText(/v\d+\.\d+\.\d+/)).toBeInTheDocument();
  });

  // ── 2. 切换到注册模式 ─────────────────────────
  it('should switch to register mode', () => {
    render(<LoginPage />);

    fireEvent.click(screen.getByText('注册'));

    // 验证码输入框
    expect(screen.getByPlaceholderText('验证码')).toBeInTheDocument();
    // 两个密码输入框（密码 + 确认密码）
    expect(screen.getByPlaceholderText('设置密码')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('确认密码')).toBeInTheDocument();
    // 发送验证码按钮
    expect(screen.getByText('发送验证码')).toBeInTheDocument();
    // 提交按钮文本变为"注册"（tab + button）
    const regTabs = screen.getAllByText('注册');
    expect(regTabs.length).toBeGreaterThanOrEqual(1);
    // 密码强度指示器（而非仅长度检查）
    // 输入弱密码，应显示 X 而不是 Check
    fillPassword('123');
    // 注册模式下密码图标用 strongPassword 校验，密码 "123" 不满足
  });

  // ── 3. 切换到忘记密码模式 ──────────────────────
  it('should switch to forgot password mode', () => {
    render(<LoginPage />);

    fireEvent.click(screen.getByText('忘记密码？'));

    // 返回登录按钮
    expect(screen.getByText('返回登录')).toBeInTheDocument();
    // 验证码输入框
    expect(screen.getByPlaceholderText('验证码')).toBeInTheDocument();
    // 新密码输入框
    expect(screen.getByPlaceholderText('新密码')).toBeInTheDocument();
    // 确认密码输入框
    expect(screen.getByPlaceholderText('确认新密码')).toBeInTheDocument();
    // 提交按钮
    expect(screen.getByText('重置密码')).toBeInTheDocument();
    // 不应显示记住我
    expect(screen.queryByText('记住账号')).not.toBeInTheDocument();
  });

  // ── 4. 空标识符提交显示错误 ────────────────────
  it('should show error when submitting with empty email', () => {
    render(<LoginPage />);

    // 点击登录按钮
    const submitBtn = screen.getAllByText('登录')[1];
    fireEvent.click(submitBtn);

    expect(screen.getByText('请输入有效的账号/邮箱/手机号')).toBeInTheDocument();
  });

  // ── 5. 无效标识符格式错误 ────────────────────
  it('should show error for invalid email format', () => {
    render(<LoginPage />);

    fillEmail('ab'); // 太短，不是有效邮箱/手机/账号（账号至少3位）
    fireEvent.click(screen.getAllByText('登录')[1]);

    expect(screen.getByText('请输入有效的账号/邮箱/手机号')).toBeInTheDocument();
  });

  // ── 6. 密码过短显示错误 ───────────────────────
  it('should show error for short password', () => {
    render(<LoginPage />);

    fillEmail('test@example.com');
    fillPassword('123');
    fireEvent.click(screen.getAllByText('登录')[1]);

    expect(screen.getByText('密码至少 6 位')).toBeInTheDocument();
  });

  // ── 7. 验证码发送按钮交互 ─────────────────────
  it('should send verification code on button click', async () => {
    mockSendCode.mockResolvedValue({ type: 'email', target: 'test@example.com', verificationId: 'v-123', isUser: true });

    render(<LoginPage />);

    // 切换��注册模式
    fireEvent.click(screen.getByText('注册'));
    // 输入有效邮箱
    fillEmailReg('test@example.com');
    // 点击发送验证码
    fireEvent.click(screen.getByText('发送验证码'));

    // 正常注册仍明确请求 ANY（false）；仅找回密码才传 true → target=USER。
    expect(mockSendCode).toHaveBeenCalledWith('test@example.com', false);

    // 发送后按钮文本变为"已发送"
    await waitFor(() => {
      expect(screen.getByText('已发送')).toBeInTheDocument();
    });
  });

  // ── 8. 密码显示/隐藏切换 ─────────────────────
  it('should toggle password visibility', () => {
    render(<LoginPage />);

    const pwdInput = screen.getByPlaceholderText('••••••');
    expect(pwdInput).toHaveAttribute('type', 'password');

    // 点击眼睛按钮
    fireEvent.click(getPwdToggleBtn());
    expect(pwdInput).toHaveAttribute('type', 'text');

    // 再次点击隐藏
    fireEvent.click(getPwdToggleBtn());
    expect(pwdInput).toHaveAttribute('type', 'password');
  });

  // ── 9. 语言切换按钮 ───────────────────────────
  it('should switch language between Chinese and English', () => {
    render(<LoginPage />);

    // 点击 EN 按钮
    fireEvent.click(screen.getByText('EN'));
    expect(mockSetLanguage).toHaveBeenCalledWith('en');

    // 点击 中 按钮
    fireEvent.click(screen.getByText('中'));
    expect(mockSetLanguage).toHaveBeenCalledWith('zh');
  });

  // ── 10. "记住我"复选框 ───────────────────────
  it('should handle remember me checkbox', () => {
    render(<LoginPage />);

    const checkbox = screen.getAllByRole('checkbox')[0];
    // 默认选中
    expect(checkbox).toBeChecked();

    // 取消记住账号会同时清理自动登录偏好，且绝不传入密码。
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(mockSaveCredentials).toHaveBeenCalledWith('', false, false);
  });

  // ── 11. 成功登录流程 ──────────────────────────
  it('should log in successfully', async () => {
    mockLogin.mockResolvedValue({ user: { uid: 'u1', email: 'test@example.com' } });

    render(<LoginPage />);

    fillEmail('test@example.com');
    fillPassword('password123');
    fireEvent.click(screen.getAllByText('登录')[1]);

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123');
    });

    // 保持 remember 为 true → 仅保存标识符和偏好，绝不保存密码
    await waitFor(() => {
      expect(mockSaveCredentials).toHaveBeenCalledWith('test@example.com', true, false);
    });

    // 设置用户状态
    await waitFor(() => {
      expect(mockSetUser).toHaveBeenCalledWith({ uid: 'u1', email: 'test@example.com' });
    });

    // Toast 通知
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('success', '欢迎回来！');
    });
  });

  // ── 12. 登录失败显示错误 ──────────────────────
  it('should show error on login failure', async () => {
    mockLogin.mockRejectedValue(new Error('邮箱或密码错误'));

    render(<LoginPage />);

    fillEmail('test@example.com');
    fillPassword('wrongpass');
    fireEvent.click(screen.getAllByText('登录')[1]);

    await waitFor(() => {
      expect(screen.getByText('邮箱或密码错误')).toBeInTheDocument();
    });
  });
});
