/**
 * 全局状态管理（Zustand）。
 * 管理：页面路由、记账弹窗开关、账单列表/筛选、分类数据、Toast 通知、数据刷新触发器。
 */
import { create } from 'zustand'
import type { Bill, Category, StatsResult } from '@/types'

/** 将数据库行（children 为 JSON 字符串）解析为前端 Category 类型 */
function parseCategoryRow(row: { name: string; icon: string; children: string; id: number; is_preset: number }): Category {
  let children: string[] = []
  try {
    children = JSON.parse(row.children)
  } catch (e) {
    console.error(`分类 "${row.name}" 的 children 字段解析失败：`, e)
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
  activePage: 'home' | 'bills' | 'stats' | 'categories'
  setActivePage: (page: 'home' | 'bills' | 'stats' | 'categories') => void

  isAddDialogOpen: boolean
  editBillId: number | null
  openAddDialog: () => void
  closeAddDialog: () => void
  openEditDialog: (id: number) => void

  bills: Bill[]
  setBills: (bills: Bill[]) => void
  refreshBills: () => Promise<void>

  stats: StatsResult | null
  setStats: (stats: StatsResult) => void

  filterCategory1: string
  filterMonth: string
  filterType: '' | 'expense' | 'income'
  setFilterCategory1: (cat: string) => void
  setFilterMonth: (month: string) => void
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

  bills: [],
  setBills: (bills) => set({ bills }),
  /**
   * 根据当前筛选条件（月份、分类）从数据库拉取账单列表。
   * 月份筛选转换为该月的起止日期范围（如 2026-07 → 2026-07-01 至 2026-07-31）。
   */
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
      set({ bills })
    } catch (e) {
      console.error('Failed to refresh bills:', e)
    }
  },

  refreshTrigger: 0,
  notifyChange: () => set((s) => ({ refreshTrigger: s.refreshTrigger + 1 })),

  stats: null,
  setStats: (stats) => set({ stats }),

  filterCategory1: '',
  filterMonth: '',
  filterType: '',
  setFilterCategory1: (cat) => set({ filterCategory1: cat }),
  setFilterMonth: (month) => set({ filterMonth: month }),
  setFilterType: (t) => set({ filterType: t }),

  toasts: [],
  /** 添加 Toast 通知，3 秒后自动消失 */
  addToast: (type, message) => {
    const id = `toast-${++toastId}`
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }))
    setTimeout(() => get().removeToast(id), 3000)
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
  }
}))
