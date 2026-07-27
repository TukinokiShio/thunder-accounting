/**
 * Bills 页面（账单列表）组件测试。
 * 验证筛选控件、空状态、账单列表渲染、编辑/删除交互、金额格式、类型标签。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Bills } from './Bills';

// ─── Mock 函数 ───
const mockRefreshBills = vi.fn().mockResolvedValue(undefined);
const mockOpenEditDialog = vi.fn();
const mockSetFilterCategory1 = vi.fn();
const mockSetFilterMonth = vi.fn();
const mockSetFilterDateRange = vi.fn();
const mockSetFilterType = vi.fn();
const mockNotifyChange = vi.fn();
const mockAddToast = vi.fn();

// ─── Mock Store 状态（模块级可变引用，mock factory 通过闭包捕获） ───
const storeState: {
  bills: any[];
  refreshBills: typeof mockRefreshBills;
  filterCategory1: string;
  filterMonth: string;
  filterDateRange: { start: string; end: string } | null;
  filterType: '' | 'expense' | 'income';
  setFilterCategory1: typeof mockSetFilterCategory1;
  setFilterMonth: typeof mockSetFilterMonth;
  setFilterDateRange: typeof mockSetFilterDateRange;
  setFilterType: typeof mockSetFilterType;
  openEditDialog: typeof mockOpenEditDialog;
  notifyChange: typeof mockNotifyChange;
  addToast: typeof mockAddToast;
  expenseCategories: any[];
  incomeCategories: any[];
} = {
  bills: [],
  refreshBills: mockRefreshBills,
  filterCategory1: '',
  filterMonth: '',
  filterDateRange: null,
  filterType: '',
  setFilterCategory1: mockSetFilterCategory1,
  setFilterMonth: mockSetFilterMonth,
  setFilterDateRange: mockSetFilterDateRange,
  setFilterType: mockSetFilterType,
  openEditDialog: mockOpenEditDialog,
  notifyChange: mockNotifyChange,
  addToast: mockAddToast,
  expenseCategories: [],
  incomeCategories: [],
};

vi.mock('@/store', () => ({
  useStore: (selector: any) => selector(storeState),
}));

// ─── Mock 语言上下文 ───
vi.mock('@/i18n/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    language: 'zh',
    setLanguage: vi.fn(),
  }),
  LanguageProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ─── Mock electronAPI ───
function mockElectronAPI() {
  (window as any).electronAPI = {
    getBills: vi.fn().mockResolvedValue([]),
    deleteBill: vi.fn().mockResolvedValue(undefined),
  };
}

/** 快捷创建账单测试数据 */
function createBill(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    date: '2026-07-27',
    type: 'expense' as const,
    amount: 58.5,
    category1: '餐饮',
    category2: '午餐',
    note: '',
    created_at: '2026-07-27',
    ...overrides,
  };
}

describe('Bills', () => {
  beforeEach(() => {
    // Reset store state
    storeState.bills = [];
    storeState.filterCategory1 = '';
    storeState.filterMonth = '';
    storeState.filterDateRange = null;
    storeState.filterType = '';
    storeState.expenseCategories = [];
    storeState.incomeCategories = [];

    // Clear mock calls but keep resolved values
    mockRefreshBills.mockClear();
    mockRefreshBills.mockResolvedValue(undefined);
    mockOpenEditDialog.mockClear();
    mockSetFilterCategory1.mockClear();
    mockSetFilterMonth.mockClear();
    mockSetFilterDateRange.mockClear();
    mockSetFilterType.mockClear();
    mockNotifyChange.mockClear();
    mockAddToast.mockClear();

    mockElectronAPI();
  });

  // ─── 1. 渲染筛选控件 ───
  it('should render filter controls', () => {
    render(<Bills />);

    // 搜索框
    expect(screen.getByPlaceholderText('搜索账单...')).toBeInTheDocument();

    // 月份筛选（type="month" 的 input）
    const monthInput = document.querySelector('input[type="month"]');
    expect(monthInput).toBeInTheDocument();

    // 两个下拉框：分类筛选 + 类型筛选
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(2);

    // 快速时间段按钮
    expect(screen.getByText('本周')).toBeInTheDocument();
    expect(screen.getByText('本月')).toBeInTheDocument();
    expect(screen.getByText('近3月')).toBeInTheDocument();
    expect(screen.getByText('近6月')).toBeInTheDocument();
    expect(screen.getByText('近一年')).toBeInTheDocument();
  });

  // ─── 2. 显示空列表状态（无账单） ───
  it('should display empty state when there are no bills', () => {
    render(<Bills />);

    expect(screen.getByText('还没有账单记录')).toBeInTheDocument();
    expect(screen.getByText('点击右上角"记一笔"开始记账')).toBeInTheDocument();
  });

  // ─── 3. 渲染账单列表行 ───
  it('should render bill list rows when bills exist', () => {
    storeState.bills = [
      createBill({ id: 1, category1: '餐饮', category2: '午餐', amount: 58.5, type: 'expense' }),
      createBill({ id: 2, category1: '工资', category2: '月薪', amount: 10000, type: 'income' }),
      createBill({ id: 3, category1: '交通', category2: '地铁', amount: 6, type: 'expense' }),
    ];

    render(<Bills />);

    // 分类名称应显示
    expect(screen.getByText('餐饮 · 午餐')).toBeInTheDocument();
    expect(screen.getByText('工资 · 月薪')).toBeInTheDocument();
    expect(screen.getByText('交通 · 地铁')).toBeInTheDocument();

    // 汇总行（文本中包含金额，使用正则匹配）
    expect(screen.getByText(/共 3 条记录/)).toBeInTheDocument();
    expect(screen.getByText(/支出合计/)).toBeInTheDocument();
    expect(screen.getByText(/收入合计/)).toBeInTheDocument();
  });

  // ─── 4. 筛选月份变化触发 refreshBills ───
  it('should call refreshBills on mount and handle month filter change', async () => {
    render(<Bills />);

    // 挂载时 refreshBills 被调用
    await waitFor(() => {
      expect(mockRefreshBills).toHaveBeenCalledTimes(1);
    });

    // 模拟月份筛选变化
    const monthInput = document.querySelector('input[type="month"]') as HTMLInputElement;
    fireEvent.change(monthInput, { target: { value: '2026-07' } });

    expect(mockSetFilterMonth).toHaveBeenCalledWith('2026-07');
  });

  // ─── 5. 点击编辑按钮调用 openEditDialog ───
  it('should call openEditDialog when edit button is clicked', () => {
    storeState.bills = [createBill({ id: 42, category1: '购物', category2: '衣服' })];

    render(<Bills />);

    // 编辑按钮通过 title="编辑" 定位（按钮有 opacity-0 但仍在 DOM 中）
    const editBtn = screen.getByTitle('编辑');
    fireEvent.click(editBtn);

    expect(mockOpenEditDialog).toHaveBeenCalledWith(42);
  });

  // ─── 6. 删除按钮可见 ───
  it('should render delete buttons for each bill row', () => {
    storeState.bills = [
      createBill({ id: 1 }),
      createBill({ id: 2 }),
      createBill({ id: 3 }),
    ];

    render(<Bills />);

    // 每条账单都有一个删除按钮（opacity-0 但仍在 DOM）
    const deleteBtns = screen.getAllByTitle('删除');
    expect(deleteBtns.length).toBe(3);
  });

  // ─── 7. 金额显示格式（¥ 符号） ───
  it('should display amounts with ¥ symbol and 2 decimal places', () => {
    storeState.bills = [
      createBill({ id: 1, type: 'expense', amount: 58.5 }),
      createBill({ id: 2, type: 'income', amount: 10000 }),
      createBill({ id: 3, type: 'expense', amount: 5 }),
    ];

    render(<Bills />);

    // 支出显示 "-¥"，收入显示 "+¥"
    expect(screen.getByText('-¥58.50')).toBeInTheDocument();
    expect(screen.getByText('+¥10000.00')).toBeInTheDocument();
    expect(screen.getByText('-¥5.00')).toBeInTheDocument();
  });

  // ─── 8. 收入/支出类型标签 ───
  it('should render income and expense type filter options', () => {
    render(<Bills />);

    // 类型筛选下拉框中应有三个选项
    const selects = screen.getAllByRole('combobox');
    // 第二个 select 是类型筛选
    const typeSelect = selects[1] as HTMLSelectElement;

    expect(typeSelect).toBeInTheDocument();
    // 通过选项文本验证
    expect(screen.getByText('全部类型')).toBeInTheDocument();
    expect(screen.getByText('支出')).toBeInTheDocument();
    expect(screen.getByText('收入')).toBeInTheDocument();
  });
});
