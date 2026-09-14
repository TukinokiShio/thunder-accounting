/**
 * Stats 页面（统计图表）组件测试。
 * 验证时间段切换、支出/收入汇总卡片、空数据状态、
 * 饼图/折线图 SVG 渲染、统计数据摘要金额。
 * 另覆盖安卓端的层级收敛：图表动画时长统一 300ms、Legend 去重、
 * 二级下钻默认收起、全量明细默认折叠且窄屏为两列（无横向溢出）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Stats } from './Stats';
import { ANDROID_PLATFORM_CLASS } from '@/platform';

const statsSource = readFileSync(resolve(process.cwd(), 'src/pages/Stats.tsx'), 'utf8');

/** 门控方式与 CategoryManager.editmode.test.tsx 一致：`<html>` 上的 platform-android 类 */
const setAndroid = (on: boolean) => {
  document.documentElement.classList.toggle(ANDROID_PLATFORM_CLASS, on);
};

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
    setAndroid(false);
    mockAddToast.mockClear();
    mockElectronAPI();
  });

  afterEach(() => {
    setAndroid(false);
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
    expect(lastMonthBtn.className).toContain('is-active');

    // 点击"近3个月"按钮
    const threeMonthBtn = screen.getByText('近3个月');
    fireEvent.click(threeMonthBtn);
    expect(threeMonthBtn.className).toContain('is-active');

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

  // ─── 10. 桌面端保留原有的 5 列全量明细表（改动不得波及 ≥640px） ───
  it('should keep the 5-column category details table on desktop', async () => {
    const { container } = render(<Stats />);

    await waitFor(() => {
      expect(container.querySelector('table')).not.toBeNull();
    });
    const table = container.querySelector('table') as HTMLElement;
    // 5 个表头（「总笔数」在汇总卡里也出现，故必须在表内断言）
    expect(within(table).getByText('一级分类')).toBeInTheDocument();
    expect(within(table).getByText('二级分类')).toBeInTheDocument();
    expect(within(table).getByText('总笔数')).toBeInTheDocument();
    expect(within(table).getByText('金额')).toBeInTheDocument();
    expect(within(table).getByText('占比')).toBeInTheDocument();
    // 桌面端不做折叠：不存在展开/收起入口，也没有下钻提示
    expect(screen.queryByTestId('stats-details-toggle')).toBeNull();
    expect(screen.queryByTestId('stats-details-panel')).toBeNull();
    expect(screen.queryByText('点击分类查看二级明细')).toBeNull();

    // 桌面 Legend 的「确实渲染了」在这里**断言不了**：jsdom 里 ResponsiveContainer 量到的宽高为 0，
    // recharts 不会挂载 Legend（只有 ResponsiveContainer 的壳 svg）。所以别在这里写
    // `querySelector('ul.flex.flex-wrap') !== null` —— 实测它是失败的，写了只能删。
    // 「桌面保留 Legend / 窄屏无 Legend」的行为级证据由真排版引擎的门禁给：
    // `npm run verify:desktop-parity`（1280×900，逐节点 computed style 精确比对，基线 worktree）。
    // 这里只锁源码级契约：见上方 test 12 的「所有 <Legend/> 必须带 !android 门控」。
  });

  // ─── 11. 图表动画时长统一为 300ms（源码级契约） ───
  // recharts 不走 DOM 暴露 animationDuration，只能在源码层锁定：
  // 每一个 <Pie> 与 <Line> 都必须显式带上 CHART_ANIM_DURATION，且其值为 300。
  // 这是历史踩坑点（默认 1500ms，安卓 WebView 上拖沓），Stats 曾是唯一未统一处。
  it('should apply 300ms animation to every Pie and Line in source', () => {
    expect(statsSource).toContain('const CHART_ANIM_DURATION = 300');

    const pieCount = (statsSource.match(/<Pie\b/g) ?? []).length;
    const lineCount = (statsSource.match(/<Line\b/g) ?? []).length;
    const animatedCount = (statsSource.match(/animationDuration=\{CHART_ANIM_DURATION\}/g) ?? []).length;

    expect(pieCount).toBe(2);
    expect(lineCount).toBe(1);
    expect(animatedCount).toBe(pieCount + lineCount);
  });

  // ─── 12. Legend 只在桌面渲染；窄屏（安卓）不再重复表达 Legend ───
  // 授权范围是「四个安卓板块」，桌面必须逐字符不变 —— 所以桌面保留（即使它在一级明细小表里冗余），
  // 而窄屏删掉它是纯去重（小表是 Legend 的超集，多出笔数与金额）。
  it('should render the recharts Legend on the desktop path only', () => {
    const rechartsImport = statsSource.match(/import \{[\s\S]*?\} from 'recharts'/)?.[0] ?? '';
    expect(rechartsImport).toContain('Legend');
    expect(statsSource).toContain('const renderLegend');

    // 两张环形图各一处，且每一处都必须带 `!android` 门控
    const guarded = statsSource.match(/\{!android && <Legend content=\{renderLegend\} \/>\}/g) ?? [];
    expect(guarded.length).toBe(2);
    // 任何一处 `<Legend … />` 都必须是上面那种「带门控」的写法：一旦有人加回无门控的 Legend，
    // bare 会比 guarded 多，桌面就被静默改动了。
    const bare = statsSource.match(/<Legend[^>]*\/>/g) ?? [];
    expect(bare.length).toBe(guarded.length);
  });
});

describe('Stats 安卓端层级收敛', () => {
  beforeEach(() => {
    setAndroid(true);
    mockAddToast.mockClear();
    mockElectronAPI();
  });

  afterEach(() => {
    setAndroid(false);
  });

  // ─── 1. 二级下钻默认收起，点击一级分类才展开，且可收起 ───
  it('should keep the subcategory drill-down collapsed until a category is tapped', async () => {
    render(<Stats />);

    await waitFor(() => {
      expect(screen.getByText('支出分类占比')).toBeInTheDocument();
    });
    // 默认不渲染整张卡（省约 434px），二级分类数据完全不进 DOM
    expect(screen.queryByTestId('stats-subcategory-card')).toBeNull();
    expect(screen.queryByText('午餐')).toBeNull();
    // 下钻入口必须可发现：一级分类小表上方有显式提示
    expect(screen.getByText('点击分类查看二级明细')).toBeInTheDocument();

    // 一级分类小表每一行就是下钻入口
    const row = screen.getByRole('button', { name: '餐饮 二级分类' });
    expect(row.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(row);

    const card = await screen.findByTestId('stats-subcategory-card');
    expect(card).toBeInTheDocument();
    // 选中态明确：行高亮 + aria-pressed，卡内给出「收起」
    expect(row.getAttribute('aria-pressed')).toBe('true');
    expect(card.textContent).toContain('餐饮');
    expect(screen.getByText('午餐')).toBeInTheDocument();
    expect(screen.getByText('晚餐')).toBeInTheDocument();
    // 未选中其它分类时不应带出它们
    expect(screen.queryByText('地铁')).toBeNull();

    // 收起后回到默认态
    fireEvent.click(screen.getByTestId('stats-drill-close'));
    await waitFor(() => {
      expect(screen.queryByTestId('stats-subcategory-card')).toBeNull();
    });
  });

  // ─── 2. 全量明细默认折叠，展开后为「分类 + 金额」两列，无横向溢出结构 ───
  it('should keep the full details collapsed by default and show two columns when expanded', async () => {
    const { container } = render(<Stats />);

    await waitFor(() => {
      expect(screen.getByText('分类明细')).toBeInTheDocument();
    });

    const toggle = screen.getByTestId('stats-details-toggle');
    expect(toggle.textContent).toBe('展开');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('stats-details-panel')).toBeNull();
    // 折叠态下二级明细不进 DOM
    expect(screen.queryByText('餐饮 · 午餐')).toBeNull();

    fireEvent.click(toggle);

    const panel = screen.getByTestId('stats-details-panel');
    expect(panel).toBeInTheDocument();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('收起');
    expect(screen.getByText('餐饮 · 午餐')).toBeInTheDocument();
    // 主信息只有「分类 + 金额」；笔数与占比降为行内次要信息 → 不再有 5 列表格可横滑
    expect(container.querySelector('table')).toBeNull();

    fireEvent.click(toggle);
    expect(screen.queryByTestId('stats-details-panel')).toBeNull();
  });
});
