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

export interface Category {
  name: string
  icon: string
  children: string[]
}

export interface AddBillForm {
  amount: string // 用 string 方便表单输入校验
  category1: string
  category2: string
  date: string
  note: string
  type: 'expense' | 'income'
}

export interface StatsResult {
  totalAmount: number
  count: number
  byCategory1: Array<{ category1: string; total: number; count: number }>
  byCategory2: Array<{ category1: string; category2: string; total: number; count: number }>
  byDate: Array<{ date: string; total: number; count: number }>
}

export interface ElectronAPI {
  addBill: (params: Omit<Bill, 'id' | 'created_at'>) => Promise<Bill>
  getBills: (filters?: { startDate?: string; endDate?: string; category1?: string }) => Promise<Bill[]>
  updateBill: (id: number, params: Partial<Omit<Bill, 'id' | 'created_at'>>) => Promise<Bill>
  deleteBill: (id: number) => Promise<void>
  getStats: (startDate: string, endDate: string, type?: 'expense' | 'income') => Promise<StatsResult>
  exportCSV: (filters?: { startDate?: string; endDate?: string }) => Promise<string>
  showSaveDialog: (defaultName: string) => Promise<string | null>
  writeFile: (filePath: string, content: string) => Promise<boolean>
  getCategories: (type?: 'expense' | 'income') => Promise<CategoryRow[]>
  addCategory: (params: { name: string; icon?: string; children?: string[]; type?: 'expense' | 'income' }) => Promise<CategoryRow>
  updateCategory: (id: number, params: { name?: string; icon?: string; children?: string[] }) => Promise<CategoryRow>
  deleteCategory: (id: number) => Promise<void>
  exportBackup: () => Promise<string>
  importBackup: (json: string) => Promise<{ bills: number; categories: number }>
  clearAllData: () => Promise<void>
  showOpenDialog: () => Promise<{ filePath: string; content: string } | null>
  onShortcut: (callback: (action: string) => void) => () => void
}

export interface CategoryRow {
  id: number
  name: string
  icon: string
  children: string  // JSON string
  type: string
  is_preset: number
  created_at: string
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
