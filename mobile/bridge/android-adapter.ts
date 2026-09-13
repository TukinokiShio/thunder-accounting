/**
 * 安卓端宿主适配器 —— 实现 `src/types/index.ts` 的 41 个 `AppAPI` 方法。
 *
 * 契约冻结：方法名 + 返回结构必须与桌面 `main-process/preload.ts` 逐一同名同形
 * （由 `mobile/bridge/contract.test.ts` 的 C1 断言三方集合相等）。
 *
 * 首版范围（用户答复 D1：「首版可以先暂时不做这一步」）：
 * - **纯本地可用**：记账 / 统计 / 分类 / 备份导入导出 / 数据概览，共 15 个方法直接走共享 DB 层。
 * - **云与账号类**：不存在的能力一律「明确不可用」——返回文档化降级值或抛
 *   `CloudUnavailableError`，**绝不返回假成功**（不伪造登录态、不谎报已同步）。
 * - **文件对话框类**：安卓无原生模态文件对话框，返回「用户取消」语义的降级值
 *   （`null` / `false`）。调用方（`SettingsDialog.tsx:41-48`、`Stats.tsx:144-150`）已按
 *   `null` 分支处理，故不抛错、不谎报导出成功；真正的导出/导入通道属 Phase 3
 *   （Capacitor Share/Filesystem）。
 *
 * 与桌面的「一一对应」：本地写方法内的 `trySync(...)` 调用点与
 * `main-process/main.ts:200-214` 的 IPC handler 逐条对应（首版 no-op，见文件末尾）。
 */
import type { AppAPI, Bill, CategoryRow } from '../../src/types'

// ─── 错误类型 ──────────────────────────────────────

/**
 * 云端能力在安卓首版不可用。
 * 调用方按普通错误处理（如 UI 的 catch 分支），语义上**不表示「操作失败」，
 * 而表示「该能力在本平台不存在」** —— 首版无账号体系，故不可能有假成功。
 */
export class CloudUnavailableError extends Error {
  readonly code = 'cloud_unavailable'

  constructor(method: string) {
    super(`云端能力在安卓首版不可用：${method}（首版为纯本地单机，不含账号与云同步）`)
    this.name = 'CloudUnavailableError'
  }
}

function cloudUnavailable(method: string): never {
  throw new CloudUnavailableError(method)
}

// ─── 共享 DB 层的懒加载 ────────────────────────────

type LocalDb = typeof import('../../main-process/database/index')

let localDbPromise: Promise<LocalDb> | undefined

/**
 * 懒加载共享 DB 模块。
 * 用动态 import 而非静态 import：一是让本文件在 jsdom（契约/降级测试）下可加载而不拉起
 * sql.js，二是让 sql.js 只在真正读写数据时才进入执行路径。
 */
function localDb(): Promise<LocalDb> {
  localDbPromise ??= import('../../main-process/database/index')
  return localDbPromise
}

/** 契约账单：sql.js 行的 `type` 声明为 `string`，此处收紧到契约联合类型（取值由 DB 默认值与调用侧保证） */
function asContractBill(row: unknown): Bill {
  return row as Bill
}

// ─── 预留的云端写后同步接缝（首版 no-op） ──────────
//
// 桌面在 `main.ts:172-175` 有同名 helper：已登录才推送，失败静默。
// 首版安卓无账号体系，以下四个占位实现**不会被执行**（`trySync` 为空实现），
// 仅用于把「调用点」固定下来：v2 接入云同步时替换这四个函数即可，
// 本文件 41 个方法的签名与调用点无需改动。

async function upsertRemoteBill(_bill: unknown): Promise<void> {}
async function deleteRemoteBill(_id: number): Promise<void> {}
async function upsertRemoteCategory(_category: unknown): Promise<void> {}
async function deleteRemoteCategory(_id: number): Promise<void> {}

/** 云同步预留位（首版 no-op）。对应桌面 `main-process/main.ts:172-175`。 */
function trySync(_fn: () => Promise<void>): void {
  // 首版纯本地：无登录态、无远端可推。
}

// ─── 降级值（文档化，禁止漂移） ────────────────────

/** `loadCredentials` 的降级值：**必须是对象**（`src/App.tsx:33` 直接读 `.autoLogin`），且不可抛错 */
export const DEGRADED_CREDENTIALS = Object.freeze({
  identifier: '',
  rememberAccount: false,
  autoLogin: false
})

// ─── 适配器本体（41 方法） ─────────────────────────

export const androidAdapter: AppAPI = {
  // ── 账单（本地） ────────────────────────────────
  addBill: async (params) => {
    const db = await localDb()
    const bill = db.addBill(params)
    // 对应桌面 main.ts:201-203（bill:add）的 trySync(() => upsertRemoteBill(bill))
    trySync(() => upsertRemoteBill(bill))
    return asContractBill(bill)
  },

  getBills: async (filters) => {
    const db = await localDb()
    return db.getBills(filters).map(asContractBill)
  },

  updateBill: async (id, params) => {
    const db = await localDb()
    const bill = db.updateBill(id, params)
    // 对应桌面 main.ts:206-210（bill:update）
    trySync(() => upsertRemoteBill(bill))
    return asContractBill(bill)
  },

  deleteBill: async (id) => {
    const db = await localDb()
    db.deleteBill(id)
    // 对应桌面 main.ts:211-214（bill:delete）
    trySync(() => deleteRemoteBill(id))
  },

  // ── 统计（本地） ────────────────────────────────
  getStats: async (startDate, endDate, type) => {
    const db = await localDb()
    return db.getStats(startDate, endDate, type)
  },

  // ── 导出（本地；落盘通道见 showSaveDialog/writeFile 的降级说明） ──
  exportCSV: async (filters) => {
    const db = await localDb()
    return db.exportCSV(filters?.startDate, filters?.endDate)
  },

  // ── 分类（本地） ────────────────────────────────
  getCategories: async (type) => {
    const db = await localDb()
    return db.getCategories(type) as unknown as CategoryRow[]
  },

  addCategory: async (params) => {
    const db = await localDb()
    const category = db.addCategory(params)
    // 对应桌面 main.ts:256-260（category:add）
    trySync(() => upsertRemoteCategory(category))
    return category as unknown as CategoryRow
  },

  updateCategory: async (id, params) => {
    const db = await localDb()
    const category = db.updateCategory(id, params)
    // 对应桌面 main.ts:261-265（category:update）
    trySync(() => upsertRemoteCategory(category))
    return category as unknown as CategoryRow
  },

  deleteCategory: async (id) => {
    const db = await localDb()
    db.deleteCategory(id)
    // 对应桌面 main.ts:266-269（category:delete）
    trySync(() => deleteRemoteCategory(id))
  },

  reorderCategories: async (orderedIds) => {
    const db = await localDb()
    db.reorderCategories(orderedIds)
    // 桌面 main.ts:270-272（category:reorder）无 trySync 调用，此处保持一致
  },

  // ── 备份 / 恢复 / 清空（本地） ───────────────────
  exportBackup: async () => {
    const db = await localDb()
    return db.exportAllJSON()
  },

  importBackup: async (json) => {
    const db = await localDb()
    return db.importAllJSON(json)
  },

  clearAllData: async () => {
    const db = await localDb()
    db.clearAllData()
  },

  // ── 文件对话框（安卓无原生模态对话框 → 返回「用户取消」语义） ──
  //
  // 说明：不抛错、也不返回伪路径。调用方拿到 null 会走「已取消」分支（`SettingsDialog.tsx:46`
  // 的 else 分支），既不会崩、也不会谎报导出成功。真正的保存/分享通道属 Phase 3。
  showSaveDialog: async (_defaultName: string) => {
    return null
  },

  writeFile: async (_filePath: string, _content: string) => {
    // 仅会在 showSaveDialog 返回真实路径后被调用；首版恒为 null，故此处不可达。
    // 返回 false（而非 true）以保证：万一被调用也绝不谎报写入成功。
    return false
  },

  showOpenDialog: async () => {
    return null
  },

  // ── 快捷键（安卓无全局快捷键） ───────────────────
  onShortcut: (_callback: (action: string) => void) => {
    // 返回合法的「取消订阅」空实现：`src/App.tsx:58-63` 会在卸载时调用它，不得为空/抛错。
    return () => {}
  },

  // ── Auth：首版无账号体系 → 读方法降级、写方法明确不可用 ──
  sendCode: async (_target: string, _registeredUserOnly?: boolean) => cloudUnavailable('sendCode'),

  register: async (
    _email: string,
    _password: string,
    _verifyCode: string,
    _verificationId: string
  ) => cloudUnavailable('register'),

  login: async (_email: string, _password: string) => cloudUnavailable('login'),

  loginWithCode: async (_email: string, _code: string, _verificationId: string) =>
    cloudUnavailable('loginWithCode'),

  logout: async () => cloudUnavailable('logout'),

  /** 合法降级值：`null` = 无会话（`src/App.tsx:35` 已按 `session?.user ?? null` 处理） */
  checkSession: async (_allowAutoLogin: boolean) => {
    return null
  },

  /** **必须返回对象且不得抛错**：`src/App.tsx:33` 直接读 `preferences.autoLogin` */
  loadCredentials: async () => {
    return DEGRADED_CREDENTIALS
  },

  saveCredentials: async (
    _identifier: string,
    _rememberAccount: boolean,
    _autoLogin: boolean
  ) => cloudUnavailable('saveCredentials'),

  sendReauthCode: async (_verifyOpt?: 'phone_code' | 'email_code') =>
    cloudUnavailable('sendReauthCode'),

  changePassword: async (_newPassword: string, _verificationCode: string, _oldPassword?: string) =>
    cloudUnavailable('changePassword'),

  resetPassword: async (
    _identifier: string,
    _newPassword: string,
    _verificationCode: string,
    _verificationId: string
  ) => cloudUnavailable('resetPassword'),

  // ── Sync：无云端 → 恒为未登录，绝不谎报「已同步」 ──
  getSyncStatus: async () => {
    return { isLoggedIn: false }
  },

  /** 无云端服务 → `false`（`src/pages/Profile.tsx:111-118` 据此关闭云能力门） */
  isCloudSyncEnabled: async () => {
    return false
  },

  // ── Account：无账号体系 ────────────────────────
  /** 合法降级值：`null` = 无绑定（`src/pages/Profile.tsx:90-98` 已按 `AccountInfo | null` 处理） */
  getAccountBindings: async () => {
    return null
  },

  sendBindCode: async (_target: string) => cloudUnavailable('sendBindCode'),

  sendBindingReauthCode: async () => cloudUnavailable('sendBindingReauthCode'),

  bindPhone: async (_phone: string, _code: string, _verificationId: string) =>
    cloudUnavailable('bindPhone'),

  unbindPhone: async (_code: string, _verificationId: string) => cloudUnavailable('unbindPhone'),

  bindEmail: async (
    _email: string,
    _code: string,
    _verificationId: string,
    _reauthCode: string,
    _reauthVerificationId: string
  ) => cloudUnavailable('bindEmail'),

  unbindEmail: async (_code: string, _verificationId: string) => cloudUnavailable('unbindEmail'),

  deleteAccount: async (_code: string) => cloudUnavailable('deleteAccount'),

  /**
   * 数据概览。桌面 `cloudbase.ts:1382-1402` 的实现**本身就只读本地库**
   * （`getBills()` + `getCategories()`），故此处逐条对齐同一算法，语义与桌面一致。
   */
  getUserStats: async () => {
    try {
      const db = await localDb()
      const bills = db.getBills()
      const categories = db.getCategories()
      const totalExpense = bills
        .filter((b) => b.type === 'expense')
        .reduce((sum, b) => sum + b.amount, 0)
      const totalIncome = bills
        .filter((b) => b.type === 'income')
        .reduce((sum, b) => sum + b.amount, 0)
      return {
        billCount: bills.length,
        categoryCount: categories.length,
        totalExpense: Math.round(totalExpense * 100) / 100,
        totalIncome: Math.round(totalIncome * 100) / 100
      }
    } catch (e) {
      console.error('获取用户统计失败:', e)
      return { billCount: 0, categoryCount: 0, totalExpense: 0, totalIncome: 0 }
    }
  },

  // ── 桌面快捷方式（Windows 专属，`src/` 内零调用） ──
  createShortcut: async () => {
    return { success: false, message: '安卓端不支持创建桌面快捷方式' }
  }
}

// ─── 安装 ──────────────────────────────────────────

/** 安装本适配器到 `window.electronAPI`（仅 `mobile/main.tsx` 调用） */
export function installAndroidBridge(): void {
  const target = window as unknown as { electronAPI?: AppAPI }
  // `??=`：不覆盖已存在的宿主（桌面 preload 或测试替身），仅在缺失时补位。
  target.electronAPI ??= androidAdapter
}
