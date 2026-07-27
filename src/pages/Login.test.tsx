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
const mockLoadCredentials = vi.fn().mockResolvedValue({ email: '', password: '' });
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

// ─── Helper: 填写邮箱 ─────────────────────────────
function fillEmail(value: string) {
  const input = screen.getByPlaceholderText('name@example.com');
  fireEvent.change(input, { target: { value } });
}

// ─── Helper: 填写密码（第一个 "••••••" 输入框）─────
function fillPassword(value: string) {
  const inputs = screen.getAllByPlaceholderText('••••••');
  fireEvent.change(inputs[0], { target: { value } });
}

// ─── Helper: 找到密码显示/隐藏切换按钮 ─────────────
function getPwdToggleBtn(): HTMLButtonElement {
  return document.querySelector('button[type="button"]') as HTMLButtonElement;
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    langSettings.language = 'zh';
    mockLoadCredentials.mockResolvedValue({ email: '', password: '' });
    mockElectronAPI();
  });

  // ── 1. 渲染登录模式默认UI ─────────────────────
  it('should render login mode default UI', () => {
    render(<LoginPage />);

    // 邮箱输入框
    expect(screen.getByPlaceholderText('name@example.com')).toBeInTheDocument();
    // 密码输入框
    const pwdInput = screen.getByPlaceholderText('••••••');
    expect(pwdInput).toBeInTheDocument();
    expect(pwdInput).toHaveAttribute('type', 'password');
    // Tab 切换：登录模式下有 tab"登录" + 按钮"登录" = 2 个
    expect(screen.getAllByText('登录').length).toBe(2);
    // 注册 tab（仅一个）
    expect(screen.getByText('注册')).toBeInTheDocument();
    // "记住我"
    expect(screen.getByText('记住账号')).toBeInTheDocument();
    // 忘记密码链接
    expect(screen.getByText('忘记密码？')).toBeInTheDocument();
    // 语言切换
    expect(screen.getByText('中')).toBeInTheDocument();
    expect(screen.getByText('EN')).toBeInTheDocument();
    // Logo / 标题
    expect(screen.getByText('雷霆记账')).toBeInTheDocument();
  });

  // ── 2. 切换到注册模式 ─────────────────────────
  it('should switch to register mode', () => {
    render(<LoginPage />);

    fireEvent.click(screen.getByText('注册'));

    // 验证码输入框
    expect(screen.getByPlaceholderText('邮箱验证码')).toBeInTheDocument();
    // 两个密码输入框（密码 + 确认密码）
    expect(screen.getAllByPlaceholderText('••••••').length).toBe(2);
    // 发送验证码按钮
    expect(screen.getByText('发送验证码')).toBeInTheDocument();
    // 提交按钮文本变为"注册"（tab + button）
    expect(screen.getAllByText('注册').length).toBe(2);
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
    expect(screen.getByPlaceholderText('邮箱验证码')).toBeInTheDocument();
    // 新密码输入框
    expect(screen.getByPlaceholderText('新密码')).toBeInTheDocument();
    // 确认密码输入框
    expect(screen.getByPlaceholderText('••••••')).toBeInTheDocument();
    // 提交按钮
    expect(screen.getByText('重置密码')).toBeInTheDocument();
    // 不应显示记住我
    expect(screen.queryByText('记住账号')).not.toBeInTheDocument();
  });

  // ── 4. 空邮箱提交显示错误 ──────────────────────
  it('should show error when submitting with empty email', () => {
    render(<LoginPage />);

    // 点击登录按钮（第二个"登录"是提交按钮，第一个是 tab）
    const submitBtn = screen.getAllByText('登录')[1];
    fireEvent.click(submitBtn);

    expect(screen.getByText('请输入有效的邮箱')).toBeInTheDocument();
  });

  // ── 5. 邮箱格式错误显示提示 ────────────────────
  it('should show error for invalid email format', () => {
    render(<LoginPage />);

    fillEmail('invalid-email');
    fireEvent.click(screen.getAllByText('登录')[1]);

    expect(screen.getByText('请输入有效的邮箱')).toBeInTheDocument();
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
    mockSendCode.mockResolvedValue(undefined);

    render(<LoginPage />);

    // 切换到注册模式
    fireEvent.click(screen.getByText('注册'));
    // 输入有效邮箱
    fillEmail('test@example.com');
    // 点击发送验证码
    fireEvent.click(screen.getByText('发送验证码'));

    expect(mockSendCode).toHaveBeenCalledWith('test@example.com');

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

    const checkbox = screen.getByRole('checkbox');
    // 默认选中
    expect(checkbox).toBeChecked();

    // 取消选中 → 应调用 saveCredentials('', '')
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(mockSaveCredentials).toHaveBeenCalledWith('', '');
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

    // 保持 remember 为 true → 保存凭据
    await waitFor(() => {
      expect(mockSaveCredentials).toHaveBeenCalledWith('test@example.com', 'password123');
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
