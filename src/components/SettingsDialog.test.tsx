import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsDialog } from './SettingsDialog';

// ── Mock 策略 ──

vi.mock('@/store', () => ({
  useStore: vi.fn((selector?: (state: any) => any) => {
    const store = {
      refreshBills: vi.fn(),
      refreshCategories: vi.fn(),
      addToast: vi.fn(),
      notifyChange: vi.fn(),
      user: null,
      appLogout: vi.fn().mockResolvedValue(undefined),
    };
    return selector ? selector(store) : store;
  }),
}));

vi.mock('@/i18n/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'zh' as const,
    t: (key: string) => key,
    setLanguage: vi.fn(),
  }),
}));

describe('SettingsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // 注入 window.electronAPI mock
    Object.defineProperty(window, 'electronAPI', {
      value: {
        exportBackup: vi.fn().mockResolvedValue('{"bills":[],"categories":[]}'),
        showSaveDialog: vi.fn().mockResolvedValue('/path/to/file.json'),
        writeFile: vi.fn().mockResolvedValue(undefined),
        showOpenDialog: vi.fn().mockResolvedValue(null),
        importBackup: vi.fn().mockResolvedValue({ bills: 0, categories: 0 }),
        clearAllData: vi.fn().mockResolvedValue(undefined),
        sendReauthCode: vi.fn().mockResolvedValue(undefined),
        changePassword: vi.fn().mockResolvedValue(undefined),
        logout: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
    });
  });

  // 1. open=false 时不渲染
  it('open=false 时不渲染任何内容', () => {
    const { container } = render(
      <SettingsDialog isOpen={false} onClose={() => {}} />
    );

    expect(container.innerHTML).toBe('');
  });

  // 2. open=true 时渲染对话框
  it('open=true 时渲染设置对话框', () => {
    render(<SettingsDialog isOpen={true} onClose={() => {}} />);

    expect(screen.getByText('设置')).toBeInTheDocument();
    expect(screen.getByText('偏好设置')).toBeInTheDocument();
    expect(screen.getByText('数据管理')).toBeInTheDocument();
    expect(screen.getByText('账户')).toBeInTheDocument();
    expect(screen.getByText('关于')).toBeInTheDocument();
  });

  // 3. 关闭按钮调用 onClose
  it('点击关闭按钮调用 onClose', () => {
    const onClose = vi.fn();
    render(<SettingsDialog isOpen={true} onClose={onClose} />);

    // 找到 X 按钮（lucide-react 的 X 图标所在 button）
    const buttons = screen.getAllByRole('button');
    // 第一个 button 是 header 中的关闭按钮
    const closeButton = buttons[0];
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 4. 点击遮罩层调用 onClose
  it('点击遮罩层（背景）调用 onClose', () => {
    const onClose = vi.fn();
    render(<SettingsDialog isOpen={true} onClose={onClose} />);

    const backdrop = document.querySelector('.bg-black\\/40');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 5. 所有分区（偏好设置/数据管理/关于）可见
  it('显示偏好设置、数据管理和关于三个区域', () => {
    render(<SettingsDialog isOpen={true} onClose={() => {}} />);

    expect(screen.getByText('偏好设置')).toBeInTheDocument();
    expect(screen.getByText('数据管理')).toBeInTheDocument();
    expect(screen.getByText('关于')).toBeInTheDocument();
  });

  // 6. 语言切换按钮
  it('渲染语言切换按钮（中文/English）', () => {
    render(<SettingsDialog isOpen={true} onClose={() => {}} />);

    expect(screen.getByText('中文')).toBeInTheDocument();
    expect(screen.getByText('English')).toBeInTheDocument();
  });

  // 7. 关于标签页显示版本号
  it('关于区域显示应用名称和版本号', () => {
    render(<SettingsDialog isOpen={true} onClose={() => {}} />);

    expect(screen.getByText('雷霆记账')).toBeInTheDocument();
    // package.json 中的 version
    const versionRegex = /v\d+\.\d+\.\d+/;
    expect(screen.getByText(versionRegex)).toBeInTheDocument();
  });

  // 8. 清除数据按钮可见
  it('显示清除所有数据按钮', () => {
    render(<SettingsDialog isOpen={true} onClose={() => {}} />);

    expect(screen.getByText('清除所有数据')).toBeInTheDocument();
  });

  // 9. 导出备份按钮
  it('显示导出备份按钮', () => {
    render(<SettingsDialog isOpen={true} onClose={() => {}} />);

    expect(screen.getByText('导出备份')).toBeInTheDocument();
  });

  // 10. 导入备份按钮
  it('显示导入备份按钮', () => {
    render(<SettingsDialog isOpen={true} onClose={() => {}} />);

    expect(screen.getByText('导入备份')).toBeInTheDocument();
  });
});
