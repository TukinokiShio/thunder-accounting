/**
 * 类型定义模块。
 * 包含：Bill（账单）、Category（分类）、AddBillForm（表单）、StatsResult（统计）、
 * AppAPI（平台无关宿主契约，别名 ElectronAPI）、CategoryRow（数据库行）等核心类型。
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
  /** v2.0：由周期支出规则生成的账单关联其规则 id；普通单笔账单为 null */
  recurring_id?: number | null
  payment_platform?: string | null
  fund_account?: string | null
}

/**
 * 周期支出规则（v2.0）：订阅 / 机械定投。
 * 规则 ≠ 账单：规则按周期产生支出事件，入账时落为带 recurring_id 的 Bill。
 */
export interface Recurring {
  id: number
  name: string
  amount: number
  type: 'subscription' | 'dca'
  cycle_unit: 'day' | 'week' | 'month' | 'year'
  cycle_interval: number
  next_date: string
  category1: string
  category2: string | null
  payment_platform: string | null
  fund_account: string | null
  note: string | null
  paused: number
  /** v2.0.1：仅在交易日执行（定投专属；周末自动顺延到下一交易日）。0=否 1=是 */
  trade_day_only: number
  created_at: string
}

/** 周期支出规则表单（新增/编辑共用，金额与间隔用 string 方便输入框双向绑定） */
export interface RecurringForm {
  name: string
  amount: string
  type: 'subscription' | 'dca'
  cycle_unit: 'day' | 'week' | 'month' | 'year'
  cycle_interval: string
  next_date: string
  category1: string
  category2: string
  payment_platform: string
  fund_account: string
  note: string
  trade_day_only: boolean
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

/**
 * 平台无关的宿主 API 契约（UI ↔ 宿主唯一接口）。
 *
 * UI 只依赖本契约的「方法名 + 返回结构」，不关心通道实现：
 * - 桌面：`main-process/preload.ts` 用 ipcRenderer.invoke 实现（preload.ts 末尾
 *   另有 `export type ElectronAPI = typeof electronAPI` 这份独立定义，故契约存在
 *   两份定义，任何一侧漂移都由 `mobile/bridge/contract.test.ts` 的 C1 断言拦截）。
 * - 安卓：`mobile/bridge/android-adapter.ts` 在 `mobile/main.tsx` 入口安装到
 *   `window.electronAPI`，**41 个方法名与桌面逐一同名**。
 *
 * ⚠ 新增/改名方法时必须同时改 preload.ts 与安卓适配器，并让契约测试同步通过。
 */
export interface AppAPI {
  addBill: (params: Omit<Bill, 'id' | 'created_at'>) => Promise<Bill>
  getBills: (filters?: { startDate?: string; endDate?: string; category1?: string }) => Promise<Bill[]>
  updateBill: (id: number, params: Partial<Omit<Bill, 'id' | 'created_at'>>) => Promise<Bill>
  deleteBill: (id: number) => Promise<void>
  // Recurring（周期支出规则，v2.0）
  getRecurrings: () => Promise<Recurring[]>
  addRecurring: (params: Omit<Recurring, 'id' | 'created_at' | 'paused'> & { paused?: number }) => Promise<Recurring>
  updateRecurring: (id: number, params: Partial<Omit<Recurring, 'id' | 'created_at'>>) => Promise<Recurring>
  deleteRecurring: (id: number) => Promise<void>
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
  importBackup: (json: string) => Promise<{ bills: number; categories: number; recurrings?: number }>
  clearAllData: () => Promise<void>
  showOpenDialog: () => Promise<{ filePath: string; content: string } | null>
  onShortcut: (callback: (action: string) => void) => () => void
  // Auth
  sendCode: (target: string, registeredUserOnly?: boolean) => Promise<{ type: 'phone' | 'email'; target: string; verificationId: string; isUser: boolean; expiresIn: number }>
  register: (email: string, password: string, verifyCode: string, verificationId: string) => Promise<{ user: CloudBaseUser; accountId?: string }>
  login: (email: string, password: string) => Promise<{ user: CloudBaseUser; accountId?: string }>
  loginWithCode: (email: string, code: string, verificationId: string) => Promise<{ user: CloudBaseUser; accountId?: string }>
  logout: () => Promise<void>
  checkSession: (allowAutoLogin: boolean) => Promise<{ user: CloudBaseUser; accountId?: string } | null>
  // Sync
  getSyncStatus: () => Promise<{ isLoggedIn: boolean }>
  saveCredentials: (identifier: string, rememberAccount: boolean, autoLogin: boolean) => Promise<void>
  loadCredentials: () => Promise<{ identifier: string; rememberAccount: boolean; autoLogin: boolean }>
  sendReauthCode: (verifyOpt?: 'phone_code' | 'email_code') => Promise<void>
  changePassword: (newPassword: string, verificationCode: string, oldPassword?: string) => Promise<void>
  resetPassword: (identifier: string, newPassword: string, verificationCode: string, verificationId: string) => Promise<void>
  createShortcut: () => Promise<{ success: boolean; message: string }>
  // Account
  getAccountBindings: () => Promise<{ accountId: string; email: string; phone: string } | null>
  sendBindCode: (target: string) => Promise<{ verificationId: string; type: 'email' | 'phone'; expiresIn: number }>
  sendBindingReauthCode: () => Promise<{ verificationId: string; type: 'email' | 'phone'; expiresIn: number }>
  bindPhone: (phone: string, code: string, verificationId: string) => Promise<void>
  unbindPhone: (code: string, verificationId: string) => Promise<void>
  bindEmail: (email: string, code: string, verificationId: string, reauthCode: string, reauthVerificationId: string) => Promise<void>
  unbindEmail: (code: string, verificationId: string) => Promise<void>
  deleteAccount: (code: string) => Promise<{ cleanupPending: boolean }>
  getUserStats: () => Promise<{ billCount: number; categoryCount: number; totalExpense: number; totalIncome: number }>

  /** 检查云端服务是否可用（access_token + CLOUDBASE_API_KEY 都存在） */
  isCloudSyncEnabled: () => Promise<boolean>
}

/**
 * 兼容别名：既有代码仍以 `ElectronAPI` 引用该契约。
 * **类型别名而非新接口** —— 不存在第二份定义，因此不可能与前文 AppAPI 漂移。
 */
export type ElectronAPI = AppAPI

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
