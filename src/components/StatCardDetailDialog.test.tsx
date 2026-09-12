/**
 * StatCardDetailDialog 组件测试。
 * 覆盖：关闭态渲染 null、环形图 + 明细、汇总不变量、结余进度条（正/负）、日均公式、
 * todayExpense 今日区间、monthIncome、空态、Escape、遮罩关闭。
 * getBills / getStats 按入参分流，确保区间与 type 取数正确。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { StatCardDetailDialog, type StatCardKey } from './StatCardDetailDialog';

// ─── Mock 语言上下文（t 为恒等映射）───
vi.mock('@/i18n/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    language: 'zh',
    setLanguage: vi.fn(),
  }),
  LanguageProvider: ({ children }: { children: React.ReactNode }) => children,
}));

let seq = 0;
function bill(over: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: seq,
    amount: 0,
    category1: '餐饮',
    category2: '午餐',
    date: '2026-09-12',
    note: '',
    type: 'expense' as 'expense' | 'income',
    created_at: '2026-09-12',
    ...over,
  };
}

const emptyStats = {
  totalAmount: 0,
  count: 0,
  byCategory1: [],
  byCategory2: [],
  byDate: [],
};

function mockAPI(opts: {
  bills?: any[];
  monthBills?: any[];
  todayBills?: any[];
  allBills?: any[];
  expenseStats?: any;
  incomeStats?: any;
} = {}) {
  // `bills` 为兼容别名：同时作为「本月」「今日」两组 fixture
  const monthBills = opts.monthBills ?? opts.bills ?? [];
  const todayBills = opts.todayBills ?? opts.bills ?? [];
  const allBills = opts.allBills ?? monthBills;
  (window as any).electronAPI = {
    // 按日期区间入参分流，避免「今日/本月区间写反」被掩盖
    getBills: vi.fn().mockImplementation((filters?: { startDate?: string; endDate?: string }) => {
      if (!filters?.startDate) return Promise.resolve(allBills);
      if (filters.startDate === filters.endDate) return Promise.resolve(todayBills);
      return Promise.resolve(monthBills);
    }),
    // 按 type 分流
    getStats: vi.fn().mockImplementation((_s: string, _e: string, type?: string) => {
      if (type === 'income') return Promise.resolve(opts.incomeStats ?? emptyStats);
      if (type === 'expense') return Promise.resolve(opts.expenseStats ?? emptyStats);
      return Promise.resolve(opts.expenseStats ?? emptyStats);
    }),
  };
}

function renderDialog(props: {
  open?: boolean;
  cardKey?: StatCardKey | null;
  onClose?: () => void;
} = {}) {
  return render(
    <StatCardDetailDialog
      open={props.open ?? true}
      cardKey={props.cardKey === undefined ? 'monthExpense' : props.cardKey}
      onClose={props.onClose ?? vi.fn()}
    />
  );
}

describe('StatCardDetailDialog', () => {
  beforeEach(() => {
    seq = 0;
    mockAPI();
  });

  // 1. open=false → 不渲染任何内容
  it('should render nothing when open is false', () => {
    const { container } = renderDialog({ open: false });
    expect(container.firstChild).toBeNull();
  });

  // 2. monthExpense → 标题 + 环形图容器 + 明细行
  it('should render title, pie chart container and detail rows for monthExpense', async () => {
    mockAPI({
      bills: [
        bill({ amount: 100, category1: '餐饮', category2: '午餐' }),
        bill({ amount: 50, category1: '交通', category2: '地铁' }),
      ],
    });
    renderDialog({ cardKey: 'monthExpense' });

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByText('本月支出')).toBeInTheDocument();
    expect(screen.getByTestId('stat-dialog-chart')).toBeInTheDocument();
    expect(screen.getByTestId('stat-dialog-list')).toBeInTheDocument();
    expect(screen.getByText('餐饮 · 午餐')).toBeInTheDocument();
    expect(screen.getByText('交通 · 地铁')).toBeInTheDocument();
  });

  // 3. 不变量：明细金额绝对值之和 === 顶部汇总金额
  it('should have top summary equal to the sum of detail amounts (invariant)', async () => {
    const bills = [
      bill({ amount: 100, category1: '餐饮', category2: '午餐' }),
      bill({ amount: 50.25, category1: '交通', category2: '地铁' }),
      bill({ amount: 10, category1: '购物', category2: '日用' }),
    ];
    mockAPI({ bills });
    renderDialog({ cardKey: 'monthExpense' });

    await waitFor(() => {
      expect(screen.getByTestId('stat-dialog-total')).toBeInTheDocument();
    });

    const expected = bills.reduce((s, b) => s + b.amount, 0);
    expect(screen.getByTestId('stat-dialog-total').textContent).toBe(`¥${expected.toFixed(2)}`);

    // 逐笔明细之和
    const detailSum = bills.reduce((s, b) => s + Math.abs(b.amount), 0);
    expect(screen.getByTestId('stat-dialog-total').textContent).toBe(`¥${detailSum.toFixed(2)}`);

    expect(screen.getByText('-¥100.00')).toBeInTheDocument();
    expect(screen.getByText('-¥50.25')).toBeInTheDocument();
    expect(screen.getByText('-¥10.00')).toBeInTheDocument();
  });

  // 4. monthBalance → 进度条 + 计算式
  it('should render progress bar and calculation for monthBalance', async () => {
    mockAPI({
      bills: [
        bill({ amount: 2418.74, category1: '餐饮', category2: '午餐', type: 'expense' }),
        bill({ amount: 3800, category1: '工资', category2: '月薪', type: 'income' }),
      ],
    });
    renderDialog({ cardKey: 'monthBalance' });

    await waitFor(() => {
      expect(screen.getByTestId('stat-dialog-total')).toBeInTheDocument();
    });

    expect(screen.getByTestId('stat-dialog-total').textContent).toBe('¥1381.26');
    expect(screen.getByText('63.7%')).toBeInTheDocument();
    expect(screen.getByRole('dialog').textContent).toContain('结余 ¥1381.26');
  });

  // 5. dailyAvg → 顶部大字与公式条按「本月支出 ÷ 已过天数」精确计算
  it('should compute daily average precisely for dailyAvg', async () => {
    const total = 300;
    const daysElapsed = new Date().getDate();
    const avg = total / daysElapsed;
    mockAPI({
      bills: [bill({ amount: total, category1: '餐饮', category2: '午餐' })],
      expenseStats: {
        ...emptyStats,
        totalAmount: total,
        count: 1,
        byDate: [{ date: '2026-09-12', total, count: 1 }],
      },
    });
    renderDialog({ cardKey: 'dailyAvg' });

    await waitFor(() => {
      expect(screen.getByTestId('stat-dialog-total')).toBeInTheDocument();
    });

    // 顶部大字 = 本月支出 ÷ 已过天数（精确值）
    expect(screen.getByTestId('stat-dialog-total').textContent).toBe(`¥${avg.toFixed(2)}`);

    // 公式条完整算式：本月支出 ¥300.00 ÷ 已过天数 N = 日均 ¥Y
    expect(screen.getByRole('dialog').textContent).toContain(
      `本月支出 ¥${total.toFixed(2)} ÷ 已过天数 ${daysElapsed} = 日均 ¥${avg.toFixed(2)}`
    );
  });

  // 6. 空数据 → 暂无记录，图形区不渲染
  it('should render empty state and no chart when there are no records', async () => {
    mockAPI({ bills: [] });
    renderDialog({ cardKey: 'monthExpense' });

    await waitFor(() => {
      expect(screen.getByText('暂无记录')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('stat-dialog-chart')).toBeNull();
  });

  // 7. Escape 触发 onClose
  it('should call onClose when Escape is pressed', async () => {
    const onClose = vi.fn();
    mockAPI({ bills: [bill({ amount: 10 })] });
    renderDialog({ cardKey: 'monthExpense', onClose });

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 8. 点击遮罩触发 onClose
  it('should call onClose when backdrop is clicked', async () => {
    const onClose = vi.fn();
    mockAPI({ bills: [bill({ amount: 10 })] });
    renderDialog({ cardKey: 'monthExpense', onClose });

    await waitFor(() => {
      expect(screen.getByTestId('stat-dialog-backdrop')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('stat-dialog-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 9. monthRecords：大字与卡片主指标一致（笔数），金额由拆解块可追溯
  it('should show record count as top summary and a traceable amount breakdown for monthRecords', async () => {
    const bills = [
      bill({ amount: 100, type: 'expense' }),
      bill({ amount: 250, type: 'income' }),
    ];
    mockAPI({ bills });
    renderDialog({ cardKey: 'monthRecords' });

    await waitFor(() => {
      expect(screen.getByTestId('stat-dialog-total')).toBeInTheDocument();
    });

    // 1) 大字 == 「N 笔」，与首页卡片主指标一致
    expect(screen.getByTestId('stat-dialog-total').textContent).toBe(`${bills.length} 笔`);

    // 2) 金额拆解块与明细逐笔同源，小计可追溯
    const dialogText = screen.getByRole('dialog').textContent ?? '';
    expect(dialogText).toContain('支出合计 ¥100.00');
    expect(dialogText).toContain('收入合计 ¥250.00');
    expect(dialogText).toContain('合计 ¥350.00');

    expect(screen.getByText('-¥100.00')).toBeInTheDocument();
    expect(screen.getByText('+¥250.00')).toBeInTheDocument();
  });

  // 10. monthIncome → 环形图容器 + 逐笔收入明细（+¥）+ 明细之和 == 顶部大字
  it('should render pie chart, income rows and matching total for monthIncome', async () => {
    const bills = [
      bill({ amount: 500, type: 'income', category1: '工资', category2: '月薪' }),
      bill({ amount: 200.5, type: 'income', category1: '兼职', category2: '项目' }),
      bill({ amount: 99, type: 'expense', category1: '餐饮', category2: '午餐' }),
    ];
    mockAPI({ bills });
    renderDialog({ cardKey: 'monthIncome' });

    await waitFor(() => {
      expect(screen.getByTestId('stat-dialog-total')).toBeInTheDocument();
    });

    expect(screen.getByTestId('stat-dialog-chart')).toBeInTheDocument();
    expect(screen.getByText('工资 · 月薪')).toBeInTheDocument();
    expect(screen.getByText('兼职 · 项目')).toBeInTheDocument();

    // 逐笔收入明细仅含收入且为 +¥ 前缀
    expect(screen.getByText('+¥500.00')).toBeInTheDocument();
    expect(screen.getByText('+¥200.50')).toBeInTheDocument();
    expect(screen.queryByText('-¥99.00')).toBeNull();

    // 明细之和 == 顶部大字（500 + 200.5 = 700.50）
    expect(screen.getByTestId('stat-dialog-total').textContent).toBe('¥700.50');
  });

  // 11. todayExpense → 只用今日 expense（排除今日收入与本月其它支出）
  it('should use today-only expense data for todayExpense', async () => {
    const todayFixture = [
      bill({ date: '2026-09-12', type: 'expense', amount: 30, category1: '餐饮', category2: '午餐' }),
      bill({ date: '2026-09-12', type: 'expense', amount: 20.5, category1: '交通', category2: '地铁' }),
      bill({ date: '2026-09-12', type: 'income', amount: 999, category1: '工资', category2: '月薪' }),
    ];
    const monthFixture = [
      bill({ date: '2026-09-01', type: 'expense', amount: 777, category1: '购物', category2: '衣服' }),
    ];
    // 今日与本月 fixture 数值不同，证明取的是今日区间
    mockAPI({ todayBills: todayFixture, monthBills: monthFixture });
    renderDialog({ cardKey: 'todayExpense' });

    await waitFor(() => {
      expect(screen.getByTestId('stat-dialog-total')).toBeInTheDocument();
    });

    // 顶部大字 = 今日支出之和（30 + 20.5 = 50.50），不含收入 999、不含本月 777
    expect(screen.getByTestId('stat-dialog-total').textContent).toBe('¥50.50');
    expect(screen.getByTestId('stat-dialog-chart')).toBeInTheDocument();
    expect(screen.getByText('餐饮 · 午餐')).toBeInTheDocument();
    expect(screen.getByText('交通 · 地铁')).toBeInTheDocument();
    // 明细只含今日 expense：今日收入与本月其它支出均不得出现
    expect(screen.queryByText('工资 · 月薪')).toBeNull();
    expect(screen.queryByText('+¥999.00')).toBeNull();
    expect(screen.queryByText('购物 · 衣服')).toBeNull();
    expect(screen.queryByText('-¥777.00')).toBeNull();
  });

  // 12. monthBalance 负结余：顶部大字与明细行「结余」逐字符一致
  it('should keep negative balance consistent between top number and detail row', async () => {
    const incomeTotal = 1000;
    const expenseTotal = 1234.45;
    const balance = incomeTotal - expenseTotal; // -234.45
    mockAPI({
      bills: [
        bill({ amount: expenseTotal, type: 'expense', category1: '餐饮', category2: '午餐' }),
        bill({ amount: incomeTotal, type: 'income', category1: '工资', category2: '月薪' }),
      ],
    });
    renderDialog({ cardKey: 'monthBalance' });

    await waitFor(() => {
      expect(screen.getByTestId('stat-dialog-total')).toBeInTheDocument();
    });

    const expected = `¥${balance.toFixed(2)}`; // ¥-234.45（含负号）
    expect(screen.getByTestId('stat-dialog-total').textContent).toBe(expected);

    const dialog = screen.getByRole('dialog');
    // 明细行「结余」文本与顶部大字逐字符相等
    const balanceRow = within(dialog).getByText('结余').closest('div');
    expect(balanceRow?.textContent).toBe(`结余${expected}`);
    // 公式块同样包含含负号的结余
    expect(dialog.textContent).toContain(`结余 ${expected}`);
    // 超支提示
    expect(dialog.textContent).toContain('支大于收');
  });

  // 13. 遮罩必须 Portal 到 document.body，且四边几何写死为 0（等价视口铺满）。
  //     回归防护：若 position:fixed 的包含块被上层祖先影响，遮罩会以该祖先为基准而露白。
  it('should portal the overlay into document.body with full-viewport geometry', async () => {
    mockAPI({ bills: [bill({ amount: 10 })] });
    const { container } = renderDialog({ cardKey: 'monthExpense' });

    await waitFor(() => {
      expect(screen.getByTestId('stat-dialog-backdrop')).toBeInTheDocument();
    });

    // 组件容器内不应存在遮罩 —— 存在即说明没走 Portal，会受应用树祖先影响
    expect(container.querySelector('[data-testid="stat-dialog-backdrop"]')).toBeNull();

    const backdrop = document.body.querySelector('[data-testid="stat-dialog-backdrop"]');
    const overlay = backdrop?.parentElement as HTMLElement;

    // 遮罩的父节点必须是 body 本身（Portal 的落点）
    expect(overlay.parentElement).toBe(document.body);
    expect(overlay.style.position).toBe('fixed');
    expect([
      overlay.style.top,
      overlay.style.right,
      overlay.style.bottom,
      overlay.style.left,
    ]).toEqual(['0px', '0px', '0px', '0px']);
  });

  // 14. 深色主题：Portal 根必须自带作用域替身 + 主题标记（否则弹窗留在浅色，且版式规则失配塌缩）
  it('should carry dark scope markers on the portal root when theme is dark', async () => {
    localStorage.setItem('thunder_theme', 'dark');
    mockAPI({ bills: [bill({ amount: 10 })] });
    renderDialog({ cardKey: 'monthExpense' });

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const dialog = screen.getByRole('dialog');
    const portalRoot = (dialog.closest('[data-theme]') ?? dialog.parentElement) as HTMLElement;

    expect(portalRoot.className).toContain('aurora-shell');
    expect(portalRoot.className).toContain('aurora-portal-root');
    expect(portalRoot.className.split(/\s+/)).toContain('dark');
    expect(portalRoot.getAttribute('data-theme')).toBe('dark');
  });

  // 15. 浅色主题：Portal 根不得带 dark 标记
  it('should not carry dark scope markers on the portal root when theme is light', async () => {
    localStorage.setItem('thunder_theme', 'light');
    mockAPI({ bills: [bill({ amount: 10 })] });
    renderDialog({ cardKey: 'monthExpense' });

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const dialog = screen.getByRole('dialog');
    const portalRoot = (dialog.closest('[data-theme]') ?? dialog.parentElement) as HTMLElement;

    expect(portalRoot.className).toContain('aurora-shell');
    expect(portalRoot.className).toContain('aurora-portal-root');
    expect(portalRoot.className.split(/\s+/)).not.toContain('dark');
    expect(portalRoot.getAttribute('data-theme')).toBe('light');
  });
});

// 主题相关用例会写入 localStorage，收尾清理以免污染其余用例（其余用例依赖浅色语义）
afterEach(() => {
  localStorage.removeItem('thunder_theme');
});
