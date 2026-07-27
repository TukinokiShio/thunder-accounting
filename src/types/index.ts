/**
 * 类型定义模块。
 * 包含：Bill（账单）、Category（分类）、AddBillForm（表单）、StatsResult（统计）、
 * ElectronAPI（IPC 接口）、CategoryRow（数据库行）等核心类型。
 */

/** 账单记录 */
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

/** 分类（前端视图模型，children 已解析为数组） */
export interface Category {
  name: string
  icon: string
  children: string[]
}

/** 记账表单数据（金额用 string 方便输入框双向绑定和校验） */
export interface AddBillForm {
  amount: string
  category1: string
  category2: string
  date: string
  note: string
  type: 'expense' | 'income'
}

/** 统计查询结果（多维度聚合） */
export interface StatsResult {
  totalAmount: number
  count: number
  byCategory1: Array<{ category1: string; total: number; count: number }>
  byCategory2: Array<{ category1: string; category2: string; total: number; count: number }>
  byDate: Array<{ date: string; total: number; count: number }>
}

/** CloudBase 用户信息 */
export interface CloudBaseUser {
  uid: string
  email: string
  emailVerified: boolean
  accountId?: string
  nickname?: string
}

/** 主进程通过 preload.ts 暴露给渲染进程的 IPC API */
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
  reorderCategories: (orderedIds: number[]) => Promise<void>
  exportBackup: () => Promise<string>
  importBackup: (json: string) => Promise<{ bills: number; categories: number }>
  clearAllData: () => Promise<void>
  showOpenDialog: () => Promise<{ filePath: string; content: string } | null>
  onShortcut: (callback: (action: string) => void) => () => void
  // Auth
  sendCode: (email: string) => Promise<void>
  register: (email: string, password: string, verifyCode: string, verificationId: string) => Promise<{ user: CloudBaseUser; accountId?: string }>
  login: (email: string, password: string) => Promise<{ user: CloudBaseUser; accountId?: string }>
  loginWithCode: (email: string, code: string, verificationId: string) => Promise<{ user: CloudBaseUser; accountId?: string }>
  logout: () => Promise<void>
  checkSession: () => Promise<{ user: CloudBaseUser; accountId?: string } | null>
  // Sync
  getSyncStatus: () => Promise<{ isLoggedIn: boolean }>
  saveCredentials: (email: string, password: string) => Promise<void>
  loadCredentials: () => Promise<{ email: string; password: string }>
  sendReauthCode: (currentPassword: string) => Promise<void>
  changePassword: (newPassword: string) => Promise<void>
  resetPassword: (email: string, newPassword: string, verificationCode: string, verificationId: string) => Promise<void>
  createShortcut: () => Promise<{ success: boolean; message: string }>
  // Account
  getAccountBindings: () => Promise<{ accountId: string; email: string; phone: string } | null>
  sendBindCode: (target: string) => Promise<{ verificationId: string; type: 'email' | 'phone' }>
  bindPhone: (phone: string, code: string, verificationId: string) => Promise<void>
  unbindPhone: (code: string, verificationId: string) => Promise<void>
  bindEmail: (email: string, code: string, verificationId: string) => Promise<void>
  unbindEmail: (code: string, verificationId: string) => Promise<void>
  deleteAccount: (code: string, verificationId: string) => Promise<void>
  getUserStats: () => Promise<{ billCount: number; categoryCount: number; totalExpense: number; totalIncome: number }>
}

/** 数据库分类行（children 为 JSON 字符串，需调用处手动解析） */
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
