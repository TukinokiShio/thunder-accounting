/**
 * Home 页面（仪表盘）组件测试。
 * 验证统计卡片、账单列表、空状态展示、卡片明细弹窗。
 * 注意：Home 已改为自查数据（不读 store.bills），所有账单 fixture 通过 getBills mock 注入。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { Home } from './Home';

// ─── Mock 状态（模块级可变引用，mock factory 通过闭包捕获）───
const storeState: { refreshTrigger: number } = {
  refreshTrigger: 0,
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

let seq = 0;
function mkBill(over: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: seq,
    date: '2026-07-27',
    type: 'expense' as 'expense' | 'income',
    amount: 0,
    category1: '餐饮',
    category2: '午餐',
    note: '',
    created_at: '2026-07-27',
    ...over,
  };
}

/** 生成当前月份的某一天（yyyy-MM-dd），用于让账单落入本月区间 */
function currentMonthDate(day: number) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-${String(day).padStart(2, '0')}`;
}

interface MockOpts {
  statsOverride?: any;
  todayBills?: any[];
  monthBills?: any[];
  allBills?: any[];
}

/**
 * getBills 按入参区分返回：
 * - 无参 → allBills（首页自查全量）
 * - startDate === endDate → todayBills（弹窗今日查询）
 * - 其它区间 → monthBills（弹窗本月查询）
 */
function mockElectronAPI(opts: MockOpts = {}) {
  const stats = opts.statsOverride ?? {
    totalAmount: 0,
    count: 0,
    byCategory1: [],
    byCategory2: [],
    byDate: [],
  };
  const allBills = opts.allBills ?? [];
  const monthBills = opts.monthBills ?? allBills;
  const todayBills = opts.todayBills ?? [];
  (window as any).electronAPI = {
    getStats: vi.fn().mockResolvedValue(stats),
    getBills: vi.fn().mockImplementation((filters?: { startDate?: string; endDate?: string }) => {
      if (filters && filters.startDate && filters.endDate) {
        if (filters.startDate === filters.endDate) return Promise.resolve(todayBills);
        return Promise.resolve(monthBills);
      }
      return Promise.resolve(allBills);
    }),
  };
}

describe('Home', () => {
  beforeEach(() => {
    seq = 0;
    storeState.refreshTrigger = 0;
    mockElectronAPI();
  });

  // ─── 1. 渲染统计卡片标签 ───
  it('should render all stat card labels', () => {
    render(<Home />);

    expect(screen.getByText('今日支出')).toBeInTheDocument();
    expect(screen.getByText('本月支出')).toBeInTheDocument();
    expect(screen.getByText('日均支出')).toBeInTheDocument();
    expect(screen.getByText('累计支出')).toBeInTheDocument();
    expect(screen.getByText('本月收入')).toBeInTheDocument();
    expect(screen.getByText('本月结余')).toBeInTheDocument();
  });

  // ─── 2. 无账单数据时显示空状态消息 ───
  it('should show empty state message when there are no bills', async () => {
    render(<Home />);

    await waitFor(() => {
      expect(
        screen.getByText('暂无记录，点击右上角"记一笔"开始记账')
      ).toBeInTheDocument();
    });
  });

  // ─── 3. 无分类数据时显示"暂无数据" ───
  it('should show "暂无数据" for top categories when no data', async () => {
    render(<Home />);

    await waitFor(() => {
      expect(screen.getByText('暂无数据')).toBeInTheDocument();
    });
  });

  // ─── 4. 有账单数据时渲染账单列表项 ───
  it('should render bill list items when bills exist', async () => {
    mockElectronAPI({
      allBills: [
        mkBill({ date: '2026-07-27', type: 'expense', amount: 58.5, category1: '餐饮', category2: '午餐' }),
        mkBill({ date: '2026-07-27', type: 'income', amount: 10000, category1: '工资', category2: '月薪' }),
        mkBill({ date: '2026-07-26', type: 'expense', amount: 35, category1: '交通', category2: '地铁' }),
      ],
    });

    render(<Home />);

    await waitFor(() => {
      expect(screen.getByText('餐饮 · 午餐')).toBeInTheDocument();
    });

    expect(screen.getByText('工资 · 月薪')).toBeInTheDocument();
    expect(screen.getByText('交通 · 地铁')).toBeInTheDocument();
  });

  // ─── 5. 收入显示绿色 "+¥"，支出显示红色 "-¥" ───
  it('should render income in green and expense in red', async () => {
    mockElectronAPI({
      allBills: [
        mkBill({ date: '2026-07-27', type: 'expense', amount: 100, category1: '餐饮', category2: '午餐' }),
        mkBill({ date: '2026-07-27', type: 'income', amount: 500, category1: '兼职', category2: '项目' }),
      ],
    });

    render(<Home />);

    await waitFor(() => {
      const incomeEl = screen.getByText('+¥500.00');
      expect(incomeEl).toBeInTheDocument();
      expect(incomeEl.className).toContain('text-green');
    });

    const expenseEl = screen.getByText('-¥100.00');
    expect(expenseEl).toBeInTheDocument();
    expect(expenseEl.className).toContain('text-red');
  });

  // ─── 6. 边界：无账单时页面不崩溃 ───
  it('should not crash when bills array is empty', async () => {
    mockElectronAPI({ allBills: [] });

    expect(() => render(<Home />)).not.toThrow();

    await waitFor(() => {
      expect(
        screen.getByText('暂无记录，点击右上角"记一笔"开始记账')
      ).toBeInTheDocument();
    });
  });

  // ─── 7. 挂载时 getBills 与 getStats 均被调用（自查数据） ───
  it('should call getBills and getStats on mount', async () => {
    render(<Home />);

    await waitFor(() => {
      expect((window as any).electronAPI.getBills).toHaveBeenCalled();
      expect((window as any).electronAPI.getStats).toHaveBeenCalled();
    });
  });

  // ─── 8. 边界：大量账单数据正确渲染所有条目 ───
  it('should render all bills when there are many records', async () => {
    mockElectronAPI({
      allBills: Array.from({ length: 10 }, (_, i) =>
        mkBill({
          date: `2026-07-${String(20 + i).padStart(2, '0')}`,
          type: i % 2 === 0 ? 'expense' : 'income',
          amount: (i + 1) * 50,
          category1: i % 2 === 0 ? '餐饮' : '兼职',
          category2: i % 2 === 0 ? '晚餐' : '项目',
        })
      ),
    });

    render(<Home />);

    await waitFor(() => {
      const billEntries = screen.getAllByText(/晚餐|项目/);
      expect(billEntries.length).toBeGreaterThanOrEqual(5);
    });
  });

  // ─── 9. 分类 Top 5 数据渲染 ───
  it('should render top 5 category breakdown when stats data is available', async () => {
    mockElectronAPI({
      statsOverride: {
        totalAmount: 5000,
        count: 10,
        byCategory1: [],
        byDate: [],
        byCategory2: [
          { category1: '餐饮', category2: '午餐', total: 2000, count: 5 },
          { category1: '交通', category2: '地铁', total: 1500, count: 3 },
          { category1: '购物', category2: '衣服', total: 1000, count: 1 },
          { category1: '娱乐', category2: '电影', total: 500, count: 1 },
        ],
      },
    });

    render(<Home />);

    await waitFor(() => {
      expect(screen.getByText(/1\. 餐饮 · 午餐/)).toBeInTheDocument();
      expect(screen.getByText(/2\. 交通 · 地铁/)).toBeInTheDocument();
    });
  });

  // ─── 10. 点击「本月支出」卡片打开明细弹窗 ───
  it('should open detail dialog when a stat card is clicked', async () => {
    render(<Home />);

    const card = screen.getByRole('button', { name: '查看明细 本月支出' });
    fireEvent.click(card);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  // ─── 11. 弹窗打开后按 Escape 关闭 ───
  it('should close detail dialog when Escape is pressed', async () => {
    render(<Home />);

    fireEvent.click(screen.getByRole('button', { name: '查看明细 今日支出' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  // ─── 12. 「累计支出」= 记账以来全部支出（跨月口径），卡片值与弹窗大字逐字符一致 ───
  it('should show all-time expense total for 累计支出 card and dialog (must not be month-only)', async () => {
    const monthPrefix = currentMonthDate(1).slice(0, 7);
    // 三个月的数据：本月 2 笔 + 去年 1 笔支出（+ 1 笔不计入的收入）
    const allBills = [
      mkBill({ date: currentMonthDate(3), type: 'expense', amount: 100.25 }),
      mkBill({ date: currentMonthDate(4), type: 'expense', amount: 50.75 }),
      // 跨月支出：本月查询永远取不到它 —— 若实现错写成「只算本月」，下面的金额断言必红
      mkBill({ date: '2025-03-09', type: 'expense', amount: 999.5 }),
      mkBill({ date: currentMonthDate(5), type: 'income', amount: 8000 }),
    ];
    // 本月 fixture 刻意与全量不同，用于证伪「误用本月账单」
    const monthFixture = allBills.filter((b) => b.date.startsWith(monthPrefix));

    mockElectronAPI({
      allBills,
      monthBills: monthFixture,
      todayBills: [],
      // stats 仅计本月支出（2 笔 / 151.00），若实现误用 stats 或本月账单，断言同样失败
      statsOverride: { totalAmount: 151, count: 2, byCategory1: [], byCategory2: [], byDate: [] },
    });

    render(<Home />);

    const card = screen.getByRole('button', { name: '查看明细 累计支出' });
    // 全期支出合计 = 100.25 + 50.75 + 999.50 = 1150.50
    await waitFor(() => {
      expect(within(card).getByText('¥1150.50')).toBeInTheDocument();
    });
    // 本月支出合计 / 本月笔数均不得作为主值出现
    expect(within(card).queryByText('¥151.00')).toBeNull();
    expect(within(card).queryByText('2')).toBeNull();
    // 副行 = 记账天数：不同日期数（本月 2 天 + 去年 1 天 = 3 天），收入不贡献天数
    expect(within(card).getByText('记账 3 天')).toBeInTheDocument();

    fireEvent.click(card);

    await waitFor(() => {
      expect(screen.getByTestId('stat-dialog-total')).toBeInTheDocument();
    });
    // 卡片 ↔ 弹窗同源：主值逐字符一致
    expect(screen.getByTestId('stat-dialog-total').textContent).toBe('¥1150.50');
  });
});
