/**
 * 安卓布局门禁 —— 固定夹具（种子数据 + 宿主 API 替身）。
 *
 * 为什么要有这一层：`src/pages/*` 的数据全部来自 `window.electronAPI`（AppAPI 契约），
 * 只要把它替换成**确定性的内存实现**，就能在没有 sql.js / 没有 Capacitor 的情况下
 * 渲染出真实的页面组件与真实的排版。这样量测到的几何才是「真组件 + 真 CSS」的几何，
 * 而不是 jsdom 那种没有排版引擎的假绿。
 *
 * 纪律：本文件只做**副作用安装 + 纯数据导出**，不得 import `src/`（避免与 App 形成环）。
 * `scripts/` 不在任何 tsconfig 的 include 内（见 tsconfig.mobile.json / tsconfig.web.json），
 * 因此这里不做类型收窄技巧，只保证运行期形状正确。
 */

/* ───────────────────────── 1. 种子账单 ───────────────────────── */

export interface GateBill {
  id: number
  amount: number
  category1: string
  category2: string
  date: string
  note: string
  type: 'expense' | 'income'
  created_at: string
}

/** 当前月（YYYY-MM）；账单日期都落在本月，保证任何「本月」筛选都能拿到全量 */
const NOW = new Date()
const YM = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}`
const day = (n: number) => `${YM}-${String(((n - 1) % 28) + 1).padStart(2, '0')}`

const EXPENSE_PAIRS: Array<[string, string]> = [
  ['餐饮', '午餐'], ['餐饮', '晚餐'], ['餐饮', '咖啡'],
  ['交通', '地铁'], ['交通', '打车'], ['交通', '加油'],
  ['购物', '日用品'], ['购物', '数码'], ['购物', '服饰'],
  ['居住', '水电'], ['居住', '物业'], ['娱乐', '电影'],
  ['医疗', '药品'], ['教育', '书籍']
]

const INCOME_PAIRS: Array<[string, string]> = [
  ['工资', '月薪'], ['奖金', '年终奖'], ['理财', '利息'], ['其他', '红包']
]

/** 14 笔支出 + 4 笔收入：支出条数 > 首屏门槛 9，保证「能显示多少条」是真排版决定的 */
export const BILLS: GateBill[] = [
  ...EXPENSE_PAIRS.map(([c1, c2], i) => ({
    id: i + 1,
    amount: 101.01 + i,
    category1: c1,
    category2: c2,
    date: day(i + 1),
    note: i % 3 === 0 ? `备注${i + 1}` : '',
    type: 'expense' as const,
    created_at: `${day(i + 1)} 09:${String(10 + i).padStart(2, '0')}:00`
  })),
  ...INCOME_PAIRS.map(([c1, c2], i) => ({
    id: 100 + i,
    amount: 900.01 + i,
    category1: c1,
    category2: c2,
    date: day(20 + i),
    note: '',
    type: 'income' as const,
    created_at: `${day(20 + i)} 18:00:00`
  }))
]

/** 账单页里「分类名」单元格的文本（与 Bills.tsx 的 `{category1} · {category2}` 逐字一致） */
export const nameText = (b: GateBill): string => `${b.category1} · ${b.category2}`

/** 账单页里「金额」单元格的文本（与 Bills.tsx 的 `{'-'|'+'}¥{amount.toFixed(2)}` 逐字一致） */
export const amountText = (b: GateBill): string => `${b.type === 'income' ? '+' : '-'}¥${b.amount.toFixed(2)}`

/* ───────────────────────── 2. 种子分类 ───────────────────────── */

const EXPENSE_CATS: Array<[string, string]> = [
  ['餐饮', '🍜'], ['交通', '🚇'], ['购物', '🛍️'], ['居住', '🏠'], ['娱乐', '🎬'],
  ['医疗', '💊'], ['教育', '📚'], ['通讯', '📱'], ['人情', '🎁'], ['宠物', '🐾'], ['其他', '📦']
]
const INCOME_CATS: Array<[string, string]> = [
  ['工资', '💰'], ['奖金', '🏆'], ['理财', '📈'], ['兼职', '💼'], ['红包', '🧧'], ['其他', '📦']
]

function categoryRows(cats: Array<[string, string]>) {
  return cats.map(([name, icon], i) => ({
    id: i + 1,
    name,
    icon,
    children: '[]',
    is_preset: 1
  }))
}

/* ───────────────────────── 3. 种子统计 ───────────────────────── */

function statsFor(type: 'expense' | 'income') {
  const rows = BILLS.filter((b) => b.type === type)
  const byCategory1: Array<{ category1: string; total: number; count: number }> = []
  const byCategory2: Array<{ category1: string; category2: string; total: number; count: number }> = []
  const byDate: Array<{ date: string; total: number; count: number }> = []
  for (const b of rows) {
    const g = byCategory1.find((r) => r.category1 === b.category1)
    if (g) { g.total += b.amount; g.count += 1 } else byCategory1.push({ category1: b.category1, total: b.amount, count: 1 })
    const s = byCategory2.find((r) => r.category1 === b.category1 && r.category2 === b.category2)
    if (s) { s.total += b.amount; s.count += 1 } else byCategory2.push({ category1: b.category1, category2: b.category2, total: b.amount, count: 1 })
    const d = byDate.find((r) => r.date === b.date)
    if (d) { d.total += b.amount; d.count += 1 } else byDate.push({ date: b.date, total: b.amount, count: 1 })
  }
  byCategory1.sort((a, b) => b.total - a.total)
  byDate.sort((a, b) => (a.date < b.date ? -1 : 1))
  return {
    totalAmount: rows.reduce((s, b) => s + b.amount, 0),
    count: rows.length,
    byCategory1,
    byCategory2,
    byDate
  }
}

export const EXPENSE_STATS = statsFor('expense')
export const INCOME_STATS = statsFor('income')

/* ───────────────────────── 4. 宿主 API 替身 ───────────────────────── */

const asyncNoop = async () => undefined

const electronAPI: Record<string, unknown> = {
  // 启动链路（App.tsx 的 restoreSession）
  loadCredentials: async () => ({ autoLogin: false }),
  checkSession: async () => null,
  onShortcut: () => () => undefined,

  // 数据链路
  getBills: async () => BILLS,
  getCategories: async (type: string) =>
    type === 'income' ? categoryRows(INCOME_CATS) : categoryRows(EXPENSE_CATS),
  getStats: async (_start: string, _end: string, type: string) =>
    type === 'income' ? INCOME_STATS : EXPENSE_STATS,
  getUserStats: async () => null,

  // 「我的」页 / 设置
  isCloudSyncEnabled: async () => false,
  getAccountBindings: async () => null,
  logoout: asyncNoop,
  logout: asyncNoop,

  // 其余契约键：一律给安全空实现，避免任何未预期调用把页面打崩
  deleteBill: asyncNoop,
  addBill: asyncNoop,
  updateBill: asyncNoop,
  exportCSV: async () => '',
  showSaveDialog: async () => null,
  writeFile: asyncNoop,
  readFile: async () => '',
  getSettings: async () => ({}),
  saveSettings: asyncNoop
}

if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).electronAPI = electronAPI
}
