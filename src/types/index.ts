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
  onShortcut: (callback: (action: string) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
