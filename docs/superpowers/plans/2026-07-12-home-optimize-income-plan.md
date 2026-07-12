# 首页优化 + 收入功能 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现四项优化：最近记录滚动、Top5二级分类、完整收入功能、记账后自动刷新首页

**Architecture:** 数据库加 type 字段区分收支，前端加收入分类预设数据，AddBillDialog 加收支切换，首页加收入统计卡片，store 加 refreshTrigger 驱动自动刷新

**Tech Stack:** Electron + React 18 + TypeScript + sql.js + Zustand + TailwindCSS + date-fns

## Global Constraints

- 数据库向下兼容：旧数据默认 type='expense'
- 版本号 minor 级别升级（新增功能模块）
- 所有 UI 适配暗色模式
- 部署到 `E:\Code\BlackHorse\VibeCoding\记账app\雷霆记账app_exe\`
- 桌面+开始菜单快捷方式自动覆盖

---

### Task 1: 数据库 bills 表加 type 字段

**Files:**
- Modify: `main-process/database.ts:27-39`

- [ ] **Step 1: 修改建表 SQL 和兼容迁移**

在 `initDatabase` 函数中，建表 SQL 改为包含 `type`：

```typescript
db.run(`
  CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    category1 TEXT NOT NULL,
    category2 TEXT NOT NULL,
    date TEXT NOT NULL,
    note TEXT DEFAULT '',
    type TEXT NOT NULL DEFAULT 'expense',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  )
`)
```

紧接着建表 SQL 之后，添加迁移逻辑（已有数据库可能缺 type 列）：

```typescript
// 兼容旧数据库：尝试添加 type 列
try {
  db.run("ALTER TABLE bills ADD COLUMN type TEXT NOT NULL DEFAULT 'expense'")
} catch {
  // 列已存在则忽略
}
```

- [ ] **Step 2: 更新 AddBillParams**

在 `AddBillParams` 接口（约第 65 行）加 `type` 字段：

```typescript
export interface AddBillParams {
  amount: number
  category1: string
  category2: string
  date: string
  note?: string
  type?: 'expense' | 'income'
}
```

- [ ] **Step 3: 更新 addBill 函数**

`addBill` 函数 INSERT 语句加 `type` 字段（约第 129 行）：

```typescript
export function addBill(params: AddBillParams): BillRow {
  const id = runStmt(`
    INSERT INTO bills (amount, category1, category2, date, note, type)
    VALUES (@amount, @category1, @category2, @date, @note, @type)
  `, {
    amount: params.amount,
    category1: params.category1,
    category2: params.category2,
    date: params.date,
    note: params.note || '',
    type: params.type || 'expense'
  })
  return queryOne('SELECT * FROM bills WHERE id = ?', { id: String(id) })!
}
```

- [ ] **Step 4: 更新 updateBill 函数**

`updateBill` 中 if 块加 type 处理（约第 177 行附近，在 `if (params.note !== undefined)` 之后）：

```typescript
if (params.type !== undefined) { fields.push('type = @type'); values.type = params.type }
```

- [ ] **Step 5: 更新 getStats 支持 type 筛选**

`getStats` 函数签名和实现改为（约第 200 行）：

```typescript
export function getStats(startDate: string, endDate: string, type?: 'expense' | 'income'): StatsResult {
  let typeFilter = ''
  const params: (string | number)[] = [startDate, endDate]
  if (type) {
    typeFilter = ' AND type = ?'
    params.push(type)
  }

  const totalResult = db.exec(
    `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM bills WHERE date >= ? AND date <= ?${typeFilter}`,
    params
  )
```

同时修改内部 `execStats` 函数，使其也传递 type 参数。将 `execStats` 内的 params 改为外层 params：

```typescript
function execStats(sql: string): Array<Record<string, unknown>> {
  const res = db.exec(sql, params)
  // ... 其余不变
}
```

每个 stats 查询 SQL 加 `${typeFilter}`：

```typescript
const byCategory1 = execStats(
  `SELECT category1, SUM(amount) as total, COUNT(*) as count FROM bills WHERE date >= ? AND date <= ?${typeFilter} GROUP BY category1 ORDER BY total DESC`
)
// byCategory2 和 byDate 同理
```

- [ ] **Step 6: 更新 exportCSV 加 type 列**

```typescript
export function exportCSV(startDate?: string, endDate?: string): string {
  const bills = getBills({ startDate, endDate })
  const header = 'id,金额,一级分类,二级分类,日期,备注,类型,创建时间\n'
  const rows = bills.map(b =>
    `${b.id},${b.amount},${b.category1},${b.category2},${b.date},"${b.note}",${b.type},${b.created_at}`
  ).join('\n')
  return '﻿' + header + rows
}
```

- [ ] **Step 7: 提交**

```bash
git add main-process/database.ts
git commit -m "feat(db): bills 表加 type 字段区分支出/收入"
```

---

### Task 2: 类型定义 + 收入分类预设

**Files:**
- Modify: `src/types/index.ts`
- Create: `src/data/incomeCategories.ts`

- [ ] **Step 1: types/index.ts — Bill 和 AddBillForm 加 type**

```typescript
export interface Bill {
  id: number
  amount: number
  category1: string
  category2: string
  date: string
  note: string
  type: 'expense' | 'income'
  created_at: string
}

export interface AddBillForm {
  amount: string
  category1: string
  category2: string
  date: string
  note: string
  type: 'expense' | 'income'
}
```

`ElectronAPI.getStats` 签名更新：

```typescript
getStats: (startDate: string, endDate: string, type?: 'expense' | 'income') => Promise<StatsResult>
```

- [ ] **Step 2: 创建 incomeCategories.ts**

```typescript
import type { Category } from '@/types'

export const incomeCategories: Category[] = [
  {
    name: '工资薪水',
    icon: '💼',
    children: ['基本工资', '奖金绩效', '加班补贴']
  },
  {
    name: '兼职副业',
    icon: '💻',
    children: ['自由职业', '稿费版税', '咨询费']
  },
  {
    name: '投资理财',
    icon: '📈',
    children: ['股票基金', '利息分红', '房租收入']
  },
  {
    name: '红包转账',
    icon: '🎁',
    children: ['微信红包', '亲友转账', '节日礼金']
  },
  {
    name: '退款报销',
    icon: '↩️',
    children: ['购物退款', '费用报销', '押金退还']
  },
  {
    name: '其他收入',
    icon: '📦',
    children: ['二手出售', '其他']
  }
]
```

- [ ] **Step 3: 提交**

```bash
git add src/types/index.ts src/data/incomeCategories.ts
git commit -m "feat: 类型定义加 type 字段 + 收入分类预设数据"
```

---

### Task 3: Backend IPC 更新

**Files:**
- Modify: `main-process/main.ts:151-152`
- Modify: `main-process/preload.ts:29-31`

- [ ] **Step 1: main.ts — stats handler 加 type 参数**

```typescript
// Stats
ipcMain.handle('stats:get', (_event, startDate, endDate, type) => getStats(startDate, endDate, type))
```

- [ ] **Step 2: preload.ts — getStats 签名加 type**

```typescript
// Stats
getStats: (startDate: string, endDate: string, type?: 'expense' | 'income') =>
  ipcRenderer.invoke('stats:get', startDate, endDate, type),
```

- [ ] **Step 3: 提交**

```bash
git add main-process/main.ts main-process/preload.ts
git commit -m "feat(ipc): getStats 支持 type 参数区分收支统计"
```

---

### Task 4: CategorySelect 支持外部分类数据

**Files:**
- Modify: `src/components/CategorySelect.tsx`

- [ ] **Step 1: 加可选 categories prop**

当前导入 `import { presetCategories } from '@/data/categories'`，改为接受外部 prop：

```typescript
import { useState, useMemo } from 'react'
import { ChevronDown } from 'lucide-react'
import { presetCategories } from '@/data/categories'
import { useClickOutside } from './useClickOutside'
import type { Category } from '@/types'

interface Props {
  category1: string
  category2: string
  onCategory1Change: (category1: string) => void
  onCategory2Change: (category2: string) => void
  categories?: Category[]  // 新增：不传则默认 presetCategories
}

export function CategorySelect({ category1, category2, onCategory1Change, onCategory2Change, categories }: Props) {
  const cats = categories ?? presetCategories
  // 后续所有 presetCategories 引用改为 cats
```

全文 `presetCategories` → `cats`。

- [ ] **Step 2: 提交**

```bash
git add src/components/CategorySelect.tsx
git commit -m "feat: CategorySelect 支持外部传入 categories"
```

---

### Task 5: Store 加 refreshTrigger

**Files:**
- Modify: `src/store/index.ts`

- [ ] **Step 1: 加 refreshTrigger**

在 `AppState` 接口中添加：

```typescript
// 刷新触发器（记一笔后 +1，首页监听触发自动刷新）
refreshTrigger: number
```

在 `create` 的初始值中添加：

```typescript
refreshTrigger: 0,
```

修改 `refreshBills`，成功后 +1：

```typescript
refreshBills: async () => {
  const { filterCategory1, filterMonth } = get()
  const filters: { startDate?: string; endDate?: string; category1?: string } = {}
  if (filterMonth) {
    const [y, m] = filterMonth.split('-')
    const lastDay = new Date(Number(y), Number(m), 0).getDate()
    filters.startDate = `${filterMonth}-01`
    filters.endDate = `${filterMonth}-${String(lastDay).padStart(2, '0')}`
  }
  if (filterCategory1) {
    filters.category1 = filterCategory1
  }
  try {
    const bills = await window.electronAPI.getBills(filters)
    set((s) => ({ bills, refreshTrigger: s.refreshTrigger + 1 }))
  } catch (e) {
    console.error('Failed to refresh bills:', e)
  }
},
```

- [ ] **Step 2: 提交**

```bash
git add src/store/index.ts
git commit -m "feat: store 加 refreshTrigger 驱动首页自动刷新"
```

---

### Task 6: 记一笔弹窗 — 收支切换

**Files:**
- Modify: `src/components/AddBillDialog.tsx`

- [ ] **Step 1: 导入收入分类 + 加 type 到 form**

```typescript
import { incomeCategories } from '@/data/incomeCategories'
```

`emptyForm` 加 type 默认值：

```typescript
const emptyForm: AddBillForm = {
  amount: '',
  category1: '',
  category2: '',
  date: new Date().toISOString().slice(0, 10),
  note: '',
  type: 'expense'
}
```

编辑模式下从 bill 加载 type：

```typescript
if (bill) {
  setForm({
    amount: String(bill.amount),
    category1: bill.category1,
    category2: bill.category2,
    date: bill.date,
    note: bill.note,
    type: bill.type
  })
}
```

- [ ] **Step 2: 加收支切换 UI**

在标题下方（弹窗 body 开头）加切换按钮：

```typescript
{/* Type toggle */}
<div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
  <button
    onClick={() => setForm(prev => ({ ...prev, type: 'expense', category1: '', category2: '' }))}
    className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors
      ${form.type === 'expense'
        ? 'bg-white dark:bg-gray-600 text-red-500 shadow-sm'
        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
      }`}
  >
    支出
  </button>
  <button
    onClick={() => setForm(prev => ({ ...prev, type: 'income', category1: '', category2: '' }))}
    className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors
      ${form.type === 'income'
        ? 'bg-white dark:bg-gray-600 text-green-500 shadow-sm'
        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
      }`}
  >
    收入
  </button>
</div>
```

- [ ] **Step 3: CategorySelect 传入对应分类**

```typescript
<CategorySelect
  category1={form.category1}
  category2={form.category2}
  categories={form.type === 'income' ? incomeCategories : undefined}
  onCategory1Change={(cat) => setForm(prev => ({ ...prev, category1: cat, category2: '' }))}
  onCategory2Change={(cat) => setForm(prev => ({ ...prev, category2: cat }))}
/>
```

- [ ] **Step 4: 金额前缀颜色联动 + billData 携带 type**

金额输入框 ¥ 前缀：

```typescript
<span className={`absolute left-3 top-1/2 -translate-y-1/2 text-lg font-medium
  ${form.type === 'income' ? 'text-green-500' : 'text-red-500'}`}>¥</span>
```

保存时 billData 加 type：

```typescript
const billData = {
  amount: sanitizedAmount,
  category1: form.category1,
  category2: form.category2,
  date: form.date,
  note: form.note.trim(),
  type: form.type
}
```

Toast 消息也区分：

```typescript
// 新增
addToast('success', `已记录收入：${form.category1}·${form.category2} ¥${sanitizedAmount.toFixed(2)}`)
// 编辑/保存区分
const label = form.type === 'income' ? '收入' : '支出'
addToast('success', `已记录${label}：${form.category1}·${form.category2} ¥${sanitizedAmount.toFixed(2)}`)
```

- [ ] **Step 5: 提交**

```bash
git add src/components/AddBillDialog.tsx
git commit -m "feat: 记一笔弹窗支持支出/收入切换"
```

---

### Task 7: 首页四项优化

**Files:**
- Modify: `src/pages/Home.tsx`

- [ ] **Step 1: 引入 refreshTrigger + 收入 stats**

```typescript
const refreshTrigger = useStore((s) => s.refreshTrigger)
```

`loadData` 中并行请求支出和收入 stats：

```typescript
const loadData = useCallback(async () => {
  setLoading(true)
  try {
    const [expenseStats, incomeStats, lastMonthStats] = await Promise.all([
      window.electronAPI.getStats(monthStart, monthEnd, 'expense'),
      window.electronAPI.getStats(monthStart, monthEnd, 'income'),
      window.electronAPI.getStats(lastMonthStart, lastMonthEnd)
    ])
    setStats(expenseStats)
    setIncomeStats(incomeStats)
    setLastMonthTotal(lastMonthStats.totalAmount)
    await refreshBills()
  } catch (e) {
    console.error('Failed to load stats:', e)
  } finally {
    setLoading(false)
  }
}, [monthStart, monthEnd, lastMonthStart, lastMonthEnd, refreshBills, refreshTrigger])
```

新增 state：

```typescript
const [incomeStats, setIncomeStats] = useState<StatsResult | null>(null)
```

- [ ] **Step 2: 统计卡片改成 6 列**

```typescript
const incomeTotal = incomeStats?.totalAmount ?? 0
const balance = incomeTotal - monthTotal

const statCards = [
  // ... 原有 4 张卡片不变 ...
  {
    label: '本月收入',
    value: loading ? '...' : `¥${incomeTotal.toFixed(2)}`,
    detail: `${incomeStats?.count ?? 0} 笔`,
    icon: TrendingUp,
    color: 'text-green-500 bg-green-50 dark:bg-green-900/20'
  },
  {
    label: '本月结余',
    value: loading ? '...' : `¥${balance.toFixed(2)}`,
    detail: balance >= 0 ? '收大于支' : '支大于收',
    icon: Wallet,
    color: balance >= 0
      ? 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
      : 'text-red-500 bg-red-50 dark:bg-red-900/20'
  }
]
```

Grid 改为：

```jsx
<div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
```

- [ ] **Step 3: Top 5 改为二级分类**

```typescript
const topCategories = stats?.byCategory2.slice(0, 5) ?? []
```

显示文本：

```jsx
<span className="text-gray-700 dark:text-gray-300">
  {idx + 1}. {cat.category1} · {cat.category2}
</span>
```

- [ ] **Step 4: 最近记录可滚动 + 区分收支颜色**

容器改：

```jsx
<div className="space-y-2 max-h-[420px] overflow-y-auto">
```

金额根据 type 显示不同颜色和符号：

```jsx
{bill.type === 'income' ? (
  <span className="text-sm font-semibold text-green-500 dark:text-green-400 ml-3 shrink-0">
    +¥{bill.amount.toFixed(2)}
  </span>
) : (
  <span className="text-sm font-semibold text-red-500 dark:text-red-400 ml-3 shrink-0">
    -¥{bill.amount.toFixed(2)}
  </span>
)}
```

数据源扩大（不再只取 5 条，而是展示全部当月数据）：

```typescript
const recentBills = bills  // 之前是 bills.slice(0, 5)
```

- [ ] **Step 5: 提交**

```bash
git add src/pages/Home.tsx
git commit -m "feat: 首页滚动+二级分类+收入卡片+自动刷新"
```

---

### Task 8: 账单列表 — 收入显示 + 筛选

**Files:**
- Modify: `src/pages/Bills.tsx`

- [ ] **Step 1: 加收入分类到筛选下拉 + type 筛选**

Store 加 `filterType`：

在 `src/store/index.ts` 的 `AppState` 接口添加：

```typescript
filterType: '' | 'expense' | 'income'
setFilterType: (t: '' | 'expense' | 'income') => void
```

初始值：`filterType: ''`

在 `refreshBills` 中传给 `getBills` 暂无 type filter（getBills 不改，前端过滤）。

Bills 页面加 type 下拉筛选：

```jsx
{/* Type filter */}
<select
  value={filterType}
  onChange={(e) => setFilterType(e.target.value as '' | 'expense' | 'income')}
  className="input-field dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 w-auto text-sm min-w-[100px]"
>
  <option value="">全部类型</option>
  <option value="expense">支出</option>
  <option value="income">收入</option>
</select>
```

前端过滤：

```typescript
const filtered = bills.filter((b) => {
  if (!search) return true
  const q = search.toLowerCase()
  return (
    b.category1.toLowerCase().includes(q) ||
    b.category2.toLowerCase().includes(q) ||
    b.note.toLowerCase().includes(q) ||
    b.amount.toString().includes(q)
  )
}).filter((b) => {
  if (!filterType) return true
  return b.type === filterType
})
```

- [ ] **Step 2: 金额颜色 + 符号区分**

```jsx
<span className={`text-sm font-semibold shrink-0 ${
  bill.type === 'income'
    ? 'text-green-500 dark:text-green-400'
    : 'text-red-500 dark:text-red-400'
}`}>
  {bill.type === 'income' ? '+' : '-'}¥{bill.amount.toFixed(2)}
</span>
```

合计显示也区分：

```jsx
<span className="text-red-500 dark:text-red-400 font-medium">
  支出合计 ¥{filtered.filter(b => b.type === 'expense').reduce((s, b) => s + b.amount, 0).toFixed(2)}
</span>
{filtered.some(b => b.type === 'income') && (
  <span className="text-green-500 dark:text-green-400 font-medium">
    · 收入合计 ¥{filtered.filter(b => b.type === 'income').reduce((s, b) => s + b.amount, 0).toFixed(2)}
  </span>
)}
```

- [ ] **Step 3: catIcon 也支持收入分类**

```typescript
import { incomeCategories } from '@/data/incomeCategories'

const catIcon = (cat1: string) =>
  presetCategories.find((c) => c.name === cat1)?.icon ??
  incomeCategories.find((c) => c.name === cat1)?.icon ??
  '📦'
```

- [ ] **Step 4: 提交**

```bash
git add src/pages/Bills.tsx src/store/index.ts
git commit -m "feat: 账单列表支持收入显示和类型筛选"
```

---

### Task 9: 统计页 — 收入统计

**Files:**
- Modify: `src/pages/Stats.tsx`

- [ ] **Step 1: 同时拉收入 stats**

```typescript
const [incomeStats, setIncomeStats] = useState<StatsResult | null>(null)
```

useEffect 中并行请求：

```typescript
useEffect(() => {
  setLoading(true)
  setError(false)
  Promise.all([
    window.electronAPI.getStats(dateRange.start, dateRange.end, 'expense'),
    window.electronAPI.getStats(dateRange.start, dateRange.end, 'income')
  ])
    .then(([exp, inc]) => { setStats(exp); setIncomeStats(inc); setError(false) })
    .catch((e) => { console.error(e); setError(true) })
    .finally(() => setLoading(false))
}, [dateRange.start, dateRange.end])
```

- [ ] **Step 2: summary 卡片加收入统计**

```jsx
<div className="grid grid-cols-4 gap-4">
  <div className="card ...">
    <p className="text-xs text-gray-500 ...">总支出</p>
    <p className="text-xl font-bold ...">¥{stats.totalAmount.toFixed(2)}</p>
  </div>
  <div className="card ...">
    <p className="text-xs text-gray-500 ...">总收入</p>
    <p className="text-xl font-bold text-green-500">¥{(incomeStats?.totalAmount ?? 0).toFixed(2)}</p>
  </div>
  <div className="card ...">
    <p className="text-xs text-gray-500 ...">总笔数</p>
    <p className="text-xl font-bold ...">{stats.count + (incomeStats?.count ?? 0)}</p>
  </div>
  <div className="card ...">
    <p className="text-xs text-gray-500 ...">结余</p>
    <p className={`text-xl font-bold ${(incomeStats?.totalAmount ?? 0) - stats.totalAmount >= 0 ? 'text-green-500' : 'text-red-500'}`}>
      ¥{((incomeStats?.totalAmount ?? 0) - stats.totalAmount).toFixed(2)}
    </p>
  </div>
</div>
```

- [ ] **Step 3: 提交**

```bash
git add src/pages/Stats.tsx
git commit -m "feat: 统计页增加收入统计和收支结余"
```

---

### Task 10: 构建 + 部署

- [ ] **Step 1: 构建并部署**

```bash
npm run deploy -- minor
```

验证输出：
- ✅ 版本号 minor 升级（如 1.1.x → 1.2.0）
- ✅ 桌面快捷方式更新
- ✅ 开始菜单快捷方式更新

- [ ] **Step 2: 最终提交**

```bash
git add -A
git commit -m "deploy: v1.2.0 首页优化+收入功能"
```
