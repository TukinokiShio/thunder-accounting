import { create } from 'zustand'
import type { Bill, StatsResult } from '@/types'

export interface Toast {
  id: string
  type: 'success' | 'error' | 'info'
  message: string
}

interface AppState {
  // 当前选中的侧边栏页面
  activePage: 'home' | 'bills' | 'stats'
  setActivePage: (page: 'home' | 'bills' | 'stats') => void

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
  setFilterCategory1: (cat: string) => void
  setFilterMonth: (month: string) => void

  // Toast 通知
  toasts: Toast[]
  addToast: (type: Toast['type'], message: string) => void
  removeToast: (id: string) => void
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
      set({ bills })
    } catch (e) {
      console.error('Failed to refresh bills:', e)
    }
  },

  stats: null,
  setStats: (stats) => set({ stats }),

  filterCategory1: '',
  filterMonth: '',
  setFilterCategory1: (cat) => set({ filterCategory1: cat }),
  setFilterMonth: (month) => set({ filterMonth: month }),

  toasts: [],
  addToast: (type, message) => {
    const id = `toast-${++toastId}`
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }))
    setTimeout(() => get().removeToast(id), 3000)
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))
