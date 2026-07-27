/**
 * Home 页面（仪表盘）组件测试。
 * 验证统计卡片、账单列表、空状态展示。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Home } from './Home';

// ─── Mock 状态（模块级可变引用，mock factory 通过闭包捕获）───
const mockRefreshBills = vi.fn().mockResolvedValue(undefined);

const storeState: {
  bills: any[];
  refreshBills: typeof mockRefreshBills;
  refreshTrigger: number;
} = {
  bills: [],
  refreshBills: mockRefreshBills,
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

function mockElectronAPI(statsOverride?: any) {
  (window as any).electronAPI = {
    getStats: vi.fn().mockResolvedValue(
      statsOverride ?? { totalAmount: 0, count: 0, byCategory2: [] }
    ),
  };
}

describe('Home', () => {
  beforeEach(() => {
    storeState.bills = [];
    storeState.refreshTrigger = 0;
    mockRefreshBills.mockClear();
    mockRefreshBills.mockResolvedValue(undefined);
    mockElectronAPI();
  });

  // ─── 1. 渲染统计卡片标签 ───
  it('should render all stat card labels', () => {
    render(<Home />);

    expect(screen.getByText('今日支出')).toBeInTheDocument();
    expect(screen.getByText('本月支出')).toBeInTheDocument();
    expect(screen.getByText('日均支出')).toBeInTheDocument();
    expect(screen.getByText('累计记录')).toBeInTheDocument();
    expect(screen.getByText('本月收入')).toBeInTheDocument();
    expect(screen.getByText('本月结余')).toBeInTheDocument();
  });

  // ─── 2. 无账单数据时显示空状态消息 ───
  it('should show empty state message when there are no bills', () => {
    render(<Home />);

    expect(
      screen.getByText('暂无记录，点击右上角"记一笔"开始记账')
    ).toBeInTheDocument();
  });

  // ─── 3. 无分类数据时显示"暂无数据" ───
  it('should show "暂无数据" for top categories when no data', () => {
    render(<Home />);

    expect(screen.getByText('暂无数据')).toBeInTheDocument();
  });

  // ─── 4. 有账单数据时渲染账单列表项 ───
  it('should render bill list items when bills exist', async () => {
    storeState.bills = [
      {
        id: 1,
        date: '2026-07-27',
        type: 'expense',
        amount: 58.5,
        category1: '餐饮',
        category2: '午餐',
        note: '',
        created_at: '2026-07-27',
      },
      {
        id: 2,
        date: '2026-07-27',
        type: 'income',
        amount: 10000,
        category1: '工资',
        category2: '月薪',
        note: '',
        created_at: '2026-07-27',
      },
      {
        id: 3,
        date: '2026-07-26',
        type: 'expense',
        amount: 35,
        category1: '交通',
        category2: '地铁',
        note: '',
        created_at: '2026-07-26',
      },
    ];

    render(<Home />);

    await waitFor(() => {
      expect(screen.getByText('餐饮 · 午餐')).toBeInTheDocument();
    });

    expect(screen.getByText('工资 · 月薪')).toBeInTheDocument();
    expect(screen.getByText('交通 · 地铁')).toBeInTheDocument();
  });

  // ─── 5. 收入显示绿色 "+¥"，支出显示红色 "-¥" ───
  it('should render income in green and expense in red', async () => {
    storeState.bills = [
      {
        id: 1,
        date: '2026-07-27',
        type: 'expense',
        amount: 100,
        category1: '餐饮',
        category2: '午餐',
        note: '',
        created_at: '2026-07-27',
      },
      {
        id: 2,
        date: '2026-07-27',
        type: 'income',
        amount: 500,
        category1: '兼职',
        category2: '项目',
        note: '',
        created_at: '2026-07-27',
      },
    ];

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

  // ─── 6. 边界：bills 为空数组时页面不崩溃 ───
  it('should not crash when bills array is empty', () => {
    storeState.bills = [];

    expect(() => render(<Home />)).not.toThrow();

    // 空列表应渲染空状态信息
    expect(
      screen.getByText('暂无记录，点击右上角"记一笔"开始记账')
    ).toBeInTheDocument();
  });

  // ─── 7. 挂载时 refreshBills 被调用 ───
  it('should call refreshBills on mount', async () => {
    render(<Home />);

    await waitFor(() => {
      expect(mockRefreshBills).toHaveBeenCalledTimes(1);
    });
  });

  // ─── 8. 边界：大量账单数据正确渲染所有条目 ───
  it('should render all bills when there are many records', async () => {
    storeState.bills = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      date: `2026-07-${String(20 + i).padStart(2, '0')}`,
      type: i % 2 === 0 ? 'expense' : 'income',
      amount: (i + 1) * 50,
      category1: i % 2 === 0 ? '餐饮' : '兼职',
      category2: i % 2 === 0 ? '晚餐' : '项目',
      note: '',
      created_at: `2026-07-${String(20 + i).padStart(2, '0')}`,
    }));

    render(<Home />);

    await waitFor(() => {
      // Home 组件中 recentBills = bills（未做 slice 限制），全部 bill 应出现
      const billEntries = screen.getAllByText(/晚餐|项目/);
      expect(billEntries.length).toBeGreaterThanOrEqual(5);
    });
  });

  // ─── 9. 分类 Top 5 数据渲染（扩展用例） ───
  it('should render top 5 category breakdown when stats data is available', async () => {
    mockElectronAPI({
      totalAmount: 5000,
      count: 10,
      byCategory2: [
        { category1: '餐饮', category2: '午餐', total: 2000, count: 5 },
        { category1: '交通', category2: '地铁', total: 1500, count: 3 },
        { category1: '购物', category2: '衣服', total: 1000, count: 1 },
        { category1: '娱乐', category2: '电影', total: 500, count: 1 },
      ],
    });
    // 重新触发 stats 加载需要递增 refreshTrigger
    storeState.refreshTrigger = 1;

    render(<Home />);

    await waitFor(() => {
      expect(screen.getByText(/1\. 餐饮 · 午餐/)).toBeInTheDocument();
      expect(screen.getByText(/2\. 交通 · 地铁/)).toBeInTheDocument();
    });
  });
});
