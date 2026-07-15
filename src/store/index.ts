import { create } from 'zustand'
import type { Bill, Category, StatsResult } from '@/types'

function parseCategoryRow(row: { name: string; icon: string; children: string; id: number; is_preset: number }): Category {
  let children: string[] = []
  try {
    children = JSON.parse(row.children)
  } catch {
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
  // 当前选中的侧边栏页面
  activePage: 'home' | 'bills' | 'stats' | 'categories'
  setActivePage: (page: 'home' | 'bills' | 'stats' | 'categories') => void

  // 记一笔弹窗
  isAddDialogOpen: boolean
  editBillId: number | null // 非 null 时为编辑模式
  openAddDialog: () => void
  closeAddDialog: () => void
  openEditDialog: (id: number) => void

  // 账单数据（渲染进程缓存）
  bills: Bill[]
  setBills: (bills: Bill[]) => void
  refreshBills: () => Promise<void>

  // 统计数据
  stats: StatsResult | null
  setStats: (stats: StatsResult) => void

  // 筛选条件
  filterCategory1: string
  filterMonth: string // YYYY-MM
  filterType: '' | 'expense' | 'income'
  setFilterCategory1: (cat: string) => void
  setFilterMonth: (month: string) => void
  setFilterType: (t: '' | 'expense' | 'income') => void

  // 刷新触发器（记一笔后 +1，首页监听触发自动刷新）
  refreshTrigger: number

  // Toast 通知
  toasts: Toast[]
  addToast: (type: Toast['type'], message: string) => void
  removeToast: (id: string) => void

  // 分类管理
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

  refreshTrigger: 0,

  stats: null,
  setStats: (stats) => set({ stats }),

  filterCategory1: '',
  filterMonth: '',
  filterType: '',
  setFilterCategory1: (cat) => set({ filterCategory1: cat }),
  setFilterMonth: (month) => set({ filterMonth: month }),
  setFilterType: (t) => set({ filterType: t }),

  toasts: [],
  addToast: (type, message) => {
    const id = `toast-${++toastId}`
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }))
    setTimeout(() => get().removeToast(id), 3000)
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  expenseCategories: [],
  incomeCategories: [],
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
