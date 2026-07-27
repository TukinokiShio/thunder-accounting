/**
 * Stats 页面（统计图表）组件测试。
 * 验证时间段切换、支出/收入汇总卡片、空数据状态、
 * 饼图/折线图 SVG 渲染、统计数据摘要金额。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Stats } from './Stats';

// ─── Mock 状态 ───
const mockAddToast = vi.fn();

vi.mock('@/store', () => ({
  useStore: (selector: any) => selector({
    addToast: mockAddToast,
  }),
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

/** 创建模拟支出统计数据 */
function createStatsData(overrides: any = {}) {
  return {
    totalAmount: 5000,
    count: 10,
    byCategory1: [
      { category1: '餐饮', total: 2000, count: 5 },
      { category1: '交通', total: 1500, count: 3 },
      { category1: '购物', total: 1000, count: 1 },
      { category1: '娱乐', total: 500, count: 1 },
    ],
    byCategory2: [
      { category1: '餐饮', category2: '午餐', total: 1200, count: 3 },
      { category1: '餐饮', category2: '晚餐', total: 800, count: 2 },
      { category1: '交通', category2: '地铁', total: 1000, count: 2 },
      { category1: '交通', category2: '打车', total: 500, count: 1 },
    ],
    byDate: [
      { date: '2026-07-20', total: 500, count: 2 },
      { date: '2026-07-21', total: 800, count: 3 },
      { date: '2026-07-22', total: 600, count: 2 },
      { date: '2026-07-23', total: 1200, count: 3 },
      { date: '2026-07-24', total: 1900, count: 4 },
    ],
    ...overrides,
  };
}

/** 创建空统计数据 */
function emptyStats() {
  return { totalAmount: 0, count: 0, byCategory1: [], byCategory2: [], byDate: [] };
}

/** Mock window.electronAPI：按 type 参数返回不同数据 */
function mockElectronAPI(expenseData?: any, incomeData?: any) {
  (window as any).electronAPI = {
    getStats: vi.fn().mockImplementation((_start: string, _end: string, type?: string) => {
      if (type === 'income') {
        return Promise.resolve(incomeData ?? createStatsData({ totalAmount: 3000, count: 5 }));
      }
      return Promise.resolve(expenseData ?? createStatsData());
    }),
  };
}

describe('Stats', () => {
  beforeEach(() => {
    mockAddToast.mockClear();
    mockElectronAPI();
  });

  // ─── 1. 渲染统计页面标题（时间段选择器按钮） ───
  it('should render period selector buttons', () => {
    render(<Stats />);

    expect(screen.getByText('本月')).toBeInTheDocument();
    expect(screen.getByText('上月')).toBeInTheDocument();
    expect(screen.getByText('近3个月')).toBeInTheDocument();
  });

  // ─── 2. 无数据时显示空状态 ───
  it('should show empty state when there is no data', async () => {
    mockElectronAPI(emptyStats(), emptyStats());

    render(<Stats />);

    await waitFor(() => {
      expect(screen.getByText('该时间段暂无数据')).toBeInTheDocument();
    });
  });

  // ─── 3. 渲染支出分类占比饼图区域 ───
  it('should render expense category pie chart section', async () => {
    render(<Stats />);

    await waitFor(() => {
      expect(screen.getByText('支出分类占比')).toBeInTheDocument();
    });
  });

  // ─── 4. 渲染每日支出趋势折线图区域 ───
  it('should render daily expense trend line chart section', async () => {
    render(<Stats />);

    await waitFor(() => {
      expect(screen.getByText('每日支出趋势')).toBeInTheDocument();
    });
  });

  // ─── 5. 时间段切换按钮交互 ───
  it('should allow switching between time periods', () => {
    render(<Stats />);

    // 点击"上月"按钮
    const lastMonthBtn = screen.getByText('上月');
    fireEvent.click(lastMonthBtn);
    expect(lastMonthBtn.className).toContain('bg-white');

    // 点击"近3个月"按钮
    const threeMonthBtn = screen.getByText('近3个月');
    fireEvent.click(threeMonthBtn);
    expect(threeMonthBtn.className).toContain('bg-white');

    // 原选中按钮应取消选中
    expect(lastMonthBtn.className).not.toContain('bg-white');
  });

  // ─── 6. 支出与收入汇总卡片同时展示 ───
  it('should display both expense and income summary cards', async () => {
    render(<Stats />);

    await waitFor(() => {
      expect(screen.getByText('总支出')).toBeInTheDocument();
      expect(screen.getByText('总收入')).toBeInTheDocument();
    });
  });

  // ─── 7. Recharts 饼图 SVG 元素存在验证 ───
  it('should render SVG elements from Recharts charts', async () => {
    const { container } = render(<Stats />);

    await waitFor(() => {
      const svgElements = container.querySelectorAll('svg');
      expect(svgElements.length).toBeGreaterThan(0);
    });
  });

  // ─── 8. 统计数据摘要金额正确显示 ───
  it('should display correct amounts in summary cards', async () => {
    render(<Stats />);

    await waitFor(() => {
      // 总支出
      expect(screen.getByText('¥5000.00')).toBeInTheDocument();
      // 总收入
      expect(screen.getByText('¥3000.00')).toBeInTheDocument();
      // 总笔数 (10 支出 + 5 收入)
      expect(screen.getByText('15')).toBeInTheDocument();
      // 结余 = 3000 - 5000 = -2000（JSX "¥{value}" 渲染为 ¥-2000.00）
      expect(screen.getByText(/¥-2000\.00/)).toBeInTheDocument();
    });
  });

  // ─── 9. 渲染导出 CSV 按钮 ───
  it('should render export CSV button', () => {
    render(<Stats />);
    expect(screen.getByText('导出 CSV')).toBeInTheDocument();
  });
});
