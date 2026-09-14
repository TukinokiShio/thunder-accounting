/**
 * 全局状态管理（Zustand）。
 * 管理：页面路由、记账弹窗开关、账单列表/筛选、分类数据、Toast 通知、数据刷新触发器。
 */
import { create } from 'zustand'
import type { Bill, Category, StatsResult, CloudBaseUser } from '@/types'

/** 将数据库行（children 为 JSON 字符串）解析为前端 Category 类型 */
function parseCategoryRow(row: { name: string; icon: string; children: string; id: number; is_preset: number }): Category {
  let children: string[] = []
  try {
    children = JSON.parse(row.children)
  } catch (e) {
    const raw = String(row.children).substring(0, 100)
    console.error(`分类 "${row.name}" 的 children 字段解析失败（原始值: ${raw}）:`, e)
    // 保留原始字符串片段以便排查，同时返回空数组避免整个列表崩溃
    children = []
  }
  return { name: row.name, icon: row.icon, children }
}

export interface Toast {
  id: string
  type: 'success' | 'error' | 'info'
  message: string
}

interface AppState {
  activePage: 'home' | 'bills' | 'stats' | 'categories' | 'profile'
  setActivePage: (page: 'home' | 'bills' | 'stats' | 'categories' | 'profile') => void

  isAddDialogOpen: boolean
  editBillId: number | null
  openAddDialog: () => void
  closeAddDialog: () => void
  openEditDialog: (id: number) => void

  // 设置弹窗开关。原先由 `App.tsx` 的本地 state 持有，但唯一入口是侧栏（安卓窄屏
  // 隐藏侧栏 → 安卓根本打不开设置、切不了语言）。改为 store 驱动后「我的」页也能开。
  // 语义与 openAddDialog 完全一致：状态 + 打开 + 关闭。
  settingsOpen: boolean
  openSettings: () => void
  closeSettings: () => void

  bills: Bill[]
  /**
   * 最近一次账单加载失败的原因；`null` = 没有失败。
   * 存在的意义：`refreshBills` 的语义是「吞掉异常但不丢信息」（调用方没有 try/catch，
   * rethrow 会变成 unhandled rejection），若失败只进 `console`，UI 就无法把
   * 「读取失败」与「本来就没有数据」区分开 —— 两者都会渲染成「还没有账单记录」。
   */
  billsError: string | null
  setBills: (bills: Bill[]) => void
  refreshBills: () => Promise<void>

  stats: StatsResult | null
  setStats: (stats: StatsResult) => void

  filterCategory1: string
  filterMonth: string
  filterDateRange: { start: string; end: string } | null
  filterType: '' | 'expense' | 'income'
  setFilterCategory1: (cat: string) => void
  setFilterMonth: (month: string) => void
  setFilterDateRange: (range: { start: string; end: string } | null) => void
  setFilterType: (t: '' | 'expense' | 'income') => void

  // refreshBills 不再自动递增 refreshTrigger（否则与 Home 的 useEffect 形成循环）。
  // CRUD 操作后由调用方显式调用 notifyChange() 通知页面刷新统计数据。
  refreshTrigger: number
  notifyChange: () => void

  toasts: Toast[]
  addToast: (type: Toast['type'], message: string) => void
  removeToast: (id: string) => void

  expenseCategories: Category[]
  incomeCategories: Category[]
  refreshCategories: () => Promise<void>

  // ─── Auth State ───
  user: CloudBaseUser | null
  isCheckingSession: boolean
  syncStatus: 'idle' | 'syncing' | 'error' | 'offline'
  syncError: string | null
  setUser: (user: CloudBaseUser | null) => void
  setCheckingSession: (v: boolean) => void
  setSyncStatus: (status: AppState['syncStatus'], error?: string) => void
  appLogout: () => Promise<void>
}

let toastId = 0

export const useStore = create<AppState>((set, get) => ({
  activePage: 'home',
  setActivePage: (page) => set({ activePage: page }),

  isAddDialogOpen: false,
  editBillId: null,
  openAddDialog: () => set({ isAddDialogOpen: true, editBillId: null }),
  closeAddDialog: () => set({ isAddDialogOpen: false, editBillId: null }),
  openEditDialog: (id) => set({ isAddDialogOpen: true, editBillId: id }),

  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  bills: [],
  billsError: null,
  setBills: (bills) => set({ bills }),
  /**
   * 根据当前筛选条件从数据库拉取账单列表。
   * 优先使用 filterDateRange（周/季/半年/年等预设），其次使用 filterMonth（月份选择器）。
   * 失败时不 rethrow（`App.tsx` / `AddBillDialog` / `SettingsDialog` 的调用点都没有 try/catch），
   * 只把原因记进 `billsError`，让 UI 能把失败与空数据区分开。
   */
  refreshBills: async () => {
    const { filterCategory1, filterDateRange, filterMonth } = get()
    const filters: { startDate?: string; endDate?: string; category1?: string } = {}
    if (filterDateRange) {
      filters.startDate = filterDateRange.start
      filters.endDate = filterDateRange.end
    } else if (filterMonth) {
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
      // 成功时一并清空失败记录，否则一次失败会让列表永久停在错误态
      set({ bills, billsError: null })
    } catch (e) {
      console.error('Failed to refresh bills:', e)
      set({ billsError: e instanceof Error ? e.message : String(e) })
    }
  },

  refreshTrigger: 0,
  notifyChange: () => set((s) => ({ refreshTrigger: s.refreshTrigger + 1 })),

  stats: null,
  setStats: (stats) => set({ stats }),

  filterCategory1: '',
  filterMonth: '',
  filterDateRange: null,
  filterType: '',
  setFilterCategory1: (cat) => set({ filterCategory1: cat }),
  setFilterMonth: (month) => set({ filterMonth: month, filterDateRange: null }),
  setFilterDateRange: (range) => set({ filterDateRange: range, filterMonth: '' }),
  setFilterType: (t) => set({ filterType: t }),

  toasts: [],
  /** 添加 Toast 通知，3 秒后自动消失 */
  addToast: (type, message) => {
    const id = `toast-${++toastId}`
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }))
    setTimeout(() => get().removeToast(id), 5000)
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  expenseCategories: [],
  incomeCategories: [],
  /** 并行加载支出和收入分类列表，将数据库行解析为 Category 类型 */
  refreshCategories: async () => {
    try {
      const [expRows, incRows] = await Promise.all([
        window.electronAPI.getCategories('expense'),
        window.electronAPI.getCategories('income')
      ])
      set({
        expenseCategories: expRows.map(parseCategoryRow),
        incomeCategories: incRows.map(parseCategoryRow)
      })
    } catch (e) {
      console.error('Failed to refresh categories:', e)
    }
  },

  // ─── Auth State ───
  user: null,
  isCheckingSession: true,
  syncStatus: 'offline',
  syncError: null,
  setUser: (user) => set({ user, syncStatus: user ? 'idle' : 'offline' }),
  setCheckingSession: (isCheckingSession) => set({ isCheckingSession }),
  setSyncStatus: (syncStatus, syncError) => set({ syncStatus, syncError: syncError || null }),
  appLogout: async () => {
    try {
      await window.electronAPI.logout()
    } catch (e) {
      console.error('退出登录失败:', e)
    }
    set({ user: null, syncStatus: 'offline', syncError: null })
  }
}))
