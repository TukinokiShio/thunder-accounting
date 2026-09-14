/**
 * Bills 页面（账单列表）组件测试。
 *
 * 覆盖两端：
 * - 安卓窄屏（`isAndroid()` 为 true，本文件的默认状态）：筛选默认收起、展开后才出现完整控件、
 *   整行点击=编辑、长按整行=删除确认、每行一个可见删除入口、金额格式、类型筛选选项。
 * - 桌面路径（`isAndroid()` 为 false）：筛选面板常驻、每行两个常驻图标按钮、无加载态
 *   —— 锁住「桌面零变化」这条硬约束。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { Bills } from './Bills';

/**
 * 平台开关。`isAndroid()` 的实现是「读一次 DOM class」，测试里用这个可变开关代替，
 * 以便同一个测试文件同时覆盖窄屏与桌面两条渲染路径。
 * vi.mock 的工厂只闭包引用它，真正解引用发生在 render 时（模块体已求值完毕）。
 */
let androidLayout = true;

vi.mock('@/platform', () => ({
  isAndroid: () => androidLayout,
}));

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

/** 取删除按钮的 mock，便于断言入参 */
function deleteBillMock() {
  return (window as any).electronAPI.deleteBill as ReturnType<typeof vi.fn>;
}

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

/** 展开窄屏筛选面板 */
function expandFilters() {
  fireEvent.click(screen.getByRole('button', { name: '展开筛选' }));
}

beforeEach(() => {
  androidLayout = true;

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

describe('Bills（安卓窄屏）', () => {
  // ─── 1. 筛选默认收起，展开后完整控件才出现 ───
  it('should collapse filters by default and reveal all controls only after expanding', async () => {
    render(<Bills />);
    await waitFor(() => expect(screen.queryByText('加载中...')).toBeNull());

    // 收起态：只有一行状态 chip；完整筛选面板不在 DOM 中
    const expandBtn = screen.getByRole('button', { name: '展开筛选' });
    expect(expandBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('全部账单')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('搜索账单...')).toBeNull();
    expect(document.querySelector('input[type="month"]')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText('本周')).toBeNull();

    // 展开后：原有全部控件都在（搜索 / 月份 / 两个下拉 / 五个时段快捷键）
    expandFilters();
    expect(screen.getByPlaceholderText('搜索账单...')).toBeInTheDocument();
    const monthInput = document.querySelector('input[type="month"]');
    expect(monthInput).toBeInTheDocument();
    expect(screen.getAllByRole('combobox').length).toBe(2);
    expect(screen.getByText('本周')).toBeInTheDocument();
    expect(screen.getByText('本月')).toBeInTheDocument();
    expect(screen.getByText('近3月')).toBeInTheDocument();
    expect(screen.getByText('近6月')).toBeInTheDocument();
    expect(screen.getByText('近一年')).toBeInTheDocument();

    // 可以再收回去
    fireEvent.click(screen.getByText('收起'));
    expect(screen.queryByPlaceholderText('搜索账单...')).toBeNull();
    expect(screen.getByText('全部账单')).toBeInTheDocument();
  });

  // ─── 2. 收起态摘要反映当前筛选 ───
  it('should summarize active filters in the collapsed chip', async () => {
    storeState.filterCategory1 = '餐饮';
    storeState.filterType = 'expense';

    render(<Bills />);
    await waitFor(() => expect(screen.queryByText('加载中...')).toBeNull());

    // 摘要 = 分类 + 类型（无时段/月份时不显示空段）
    expect(screen.getByText('餐饮 · 支出')).toBeInTheDocument();
    expect(screen.queryByText('全部账单')).toBeNull();
  });

  // ─── 3. 显示空列表状态（无账单） ───
  it('should display empty state when there are no bills', async () => {
    render(<Bills />);

    expect(await screen.findByText('还没有账单记录')).toBeInTheDocument();
    expect(screen.getByText('点击右上角"记一笔"开始记账')).toBeInTheDocument();
  });

  // ─── 4. 渲染账单列表行 ───
  it('should render bill list rows when bills exist', async () => {
    storeState.bills = [
      createBill({ id: 1, category1: '餐饮', category2: '午餐', amount: 58.5, type: 'expense' }),
      createBill({ id: 2, category1: '工资', category2: '月薪', amount: 10000, type: 'income' }),
      createBill({ id: 3, category1: '交通', category2: '地铁', amount: 6, type: 'expense' }),
    ];

    render(<Bills />);

    // 分类名称应显示
    expect(await screen.findByText('餐饮 · 午餐')).toBeInTheDocument();
    expect(screen.getByText('工资 · 月薪')).toBeInTheDocument();
    expect(screen.getByText('交通 · 地铁')).toBeInTheDocument();

    // 汇总行（文本中包含金额，使用正则匹配）
    expect(screen.getByText(/共 3 条记录/)).toBeInTheDocument();
    expect(screen.getByText(/支出合计/)).toBeInTheDocument();
    expect(screen.getByText(/收入合计/)).toBeInTheDocument();
  });

  // ─── 5. 挂载拉取 + 月份筛选（需先展开面板） ───
  it('should call refreshBills on mount and handle month filter change', async () => {
    render(<Bills />);

    // 挂载时 refreshBills 被调用
    await waitFor(() => {
      expect(mockRefreshBills).toHaveBeenCalledTimes(1);
    });

    // 月份控件在展开面板内
    expandFilters();
    const monthInput = document.querySelector('input[type="month"]') as HTMLInputElement;
    fireEvent.change(monthInput, { target: { value: '2026-07' } });

    expect(mockSetFilterMonth).toHaveBeenCalledWith('2026-07');
  });

  // ─── 6. 点整行 = 编辑 ───
  it('should call openEditDialog when the row is tapped', async () => {
    storeState.bills = [createBill({ id: 42, category1: '购物', category2: '衣服' })];

    render(<Bills />);

    const name = await screen.findByText('购物 · 衣服');
    const row = name.closest('[role="button"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row).toHaveAccessibleName('编辑');
    fireEvent.click(row);

    expect(mockOpenEditDialog).toHaveBeenCalledWith(42);
  });

  // ─── 7. 每行一个可见删除入口（44px 触控盒） ───
  it('should render one visible delete entry per bill row', async () => {
    storeState.bills = [
      createBill({ id: 1 }),
      createBill({ id: 2 }),
      createBill({ id: 3 }),
    ];

    render(<Bills />);

    await waitFor(() => {
      expect(screen.getAllByTitle('删除').length).toBe(3);
    });

    // 触控目标不缩水：仍是 44×44 的盒子（多出的高度用负外边距从行高里扣掉）
    for (const btn of screen.getAllByTitle('删除')) {
      expect(btn.className).toContain('min-h-11');
      expect(btn.className).toContain('min-w-11');
    }
  });

  // ─── 8. 长按整行 = 删除确认，确认后真正删除 ───
  it('should open the delete confirmation on long press and delete on confirm', async () => {
    storeState.bills = [createBill({ id: 7, category1: '餐饮', category2: '晚餐' })];

    render(<Bills />);

    const name = await screen.findByText('餐饮 · 晚餐');
    const row = name.closest('[role="button"]') as HTMLElement;
    fireEvent.pointerDown(row);

    // 长按阈值 500ms 后弹出复用现有 ConfirmDialog
    const dialog = await screen.findByRole('dialog', undefined, { timeout: 3000 });
    expect(within(dialog).getByText('确定要删除这条记录吗？删除后不可恢复。')).toBeInTheDocument();

    // 长按抬起不应顺带触发「编辑」
    fireEvent.pointerUp(row);
    expect(mockOpenEditDialog).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }));
    await waitFor(() => {
      expect(deleteBillMock()).toHaveBeenCalledWith(7);
    });
    expect(mockNotifyChange).toHaveBeenCalled();
  });

  // ─── 9. 金额显示格式（¥ 符号） ───
  it('should display amounts with ¥ symbol and 2 decimal places', async () => {
    storeState.bills = [
      createBill({ id: 1, type: 'expense', amount: 58.5 }),
      createBill({ id: 2, type: 'income', amount: 10000 }),
      createBill({ id: 3, type: 'expense', amount: 5 }),
    ];

    render(<Bills />);

    // 支出显示 "-¥"，收入显示 "+¥"
    expect(await screen.findByText('-¥58.50')).toBeInTheDocument();
    expect(screen.getByText('+¥10000.00')).toBeInTheDocument();
    expect(screen.getByText('-¥5.00')).toBeInTheDocument();
  });

  // ─── 10. 收入/支出类型标签（在展开面板内） ───
  it('should render income and expense type filter options', async () => {
    render(<Bills />);
    await waitFor(() => expect(screen.queryByText('加载中...')).toBeNull());

    expandFilters();
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

describe('Bills（桌面路径，零变化）', () => {
  beforeEach(() => {
    androidLayout = false;
  });

  it('should keep the always-visible filter panel and no loading state', async () => {
    render(<Bills />);
    // 排空挂载时 refreshBills 的微任务：桌面不渲染加载态，挂载当帧即为终态
    await act(async () => {});

    // 桌面没有收起 chip / 摘要
    expect(screen.queryByText('全部账单')).toBeNull();
    expect(screen.queryByRole('button', { name: '展开筛选' })).toBeNull();

    // 筛选面板常驻展开
    expect(screen.getByPlaceholderText('搜索账单...')).toBeInTheDocument();
    expect(document.querySelector('input[type="month"]')).toBeInTheDocument();
    expect(screen.getAllByRole('combobox').length).toBe(2);
    expect(screen.getByText('本周')).toBeInTheDocument();
    expect(screen.getByText('本月')).toBeInTheDocument();
    expect(screen.getByText('近3月')).toBeInTheDocument();
    expect(screen.getByText('近6月')).toBeInTheDocument();
    expect(screen.getByText('近一年')).toBeInTheDocument();

    // 桌面不渲染加载态：无账单时直接是空状态
    expect(screen.queryByText('加载中...')).toBeNull();
    expect(screen.getByText('还没有账单记录')).toBeInTheDocument();
  });

  it('should keep the two per-row icon buttons on the desktop path', async () => {
    storeState.bills = [createBill({ id: 5, category1: '餐饮', category2: '早餐' })];

    render(<Bills />);
    await waitFor(() => expect(mockRefreshBills).toHaveBeenCalled());

    // 行的可点区域由行内的编辑按钮承担（不是整行 role=button）
    const editBtn = screen.getByTitle('编辑');
    fireEvent.click(editBtn);
    expect(mockOpenEditDialog).toHaveBeenCalledWith(5);

    expect(screen.getAllByTitle('删除').length).toBe(1);
    expect(document.querySelector('[role="button"][aria-label="编辑"]')).toBeNull();
  });
});
