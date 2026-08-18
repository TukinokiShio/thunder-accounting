/**
 * 预加载脚本（Preload Script）。
 * 通过 contextBridge 将受限的 Node.js / Electron API 暴露给渲染进程，
 * 实现进程间通信（IPC），保证渲染进程的沙盒安全性。
 * 暴露的所有方法最终通过 ipcRenderer.invoke 调用主进程的 IPC handler。
 */
import { contextBridge, ipcRenderer } from 'electron'

const electronAPI = {
  // Bills
  addBill: (params: {
    amount: number
    category1: string
    category2: string
    date: string
    note?: string
    type?: 'expense' | 'income'
  }) => ipcRenderer.invoke('bill:add', params),

  getBills: (filters?: {
    startDate?: string
    endDate?: string
    category1?: string
  }) => ipcRenderer.invoke('bill:getAll', filters),

  updateBill: (id: number, params: Partial<{
    amount: number
    category1: string
    category2: string
    date: string
    note: string
    type: string
  }>) => ipcRenderer.invoke('bill:update', id, params),

  deleteBill: (id: number) => ipcRenderer.invoke('bill:delete', id),

  // Stats
  getStats: (startDate: string, endDate: string, type?: 'expense' | 'income') =>
    ipcRenderer.invoke('stats:get', startDate, endDate, type),

  // Export
  exportCSV: (filters?: { startDate?: string; endDate?: string }) =>
    ipcRenderer.invoke('export:csv', filters),

  // Dialog for file save
  showSaveDialog: (defaultName: string) =>
    ipcRenderer.invoke('dialog:save', defaultName),

  // File write
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('file:write', filePath, content),

  // Categories
  getCategories: (type?: 'expense' | 'income') =>
    ipcRenderer.invoke('category:getAll', type),

  addCategory: (params: {
    name: string
    icon?: string
    children?: string[]
    type?: 'expense' | 'income'
  }) => ipcRenderer.invoke('category:add', params),

  updateCategory: (id: number, params: {
    name?: string
    icon?: string
    children?: string[]
  }) => ipcRenderer.invoke('category:update', id, params),

  deleteCategory: (id: number) =>
    ipcRenderer.invoke('category:delete', id),

  reorderCategories: (orderedIds: number[]) =>
    ipcRenderer.invoke('category:reorder', orderedIds),

  // Backup / Restore / Clear
  exportBackup: () =>
    ipcRenderer.invoke('backup:export'),

  importBackup: (json: string) =>
    ipcRenderer.invoke('backup:import', json),

  clearAllData: () =>
    ipcRenderer.invoke('data:clear'),

  // Open file dialog
  showOpenDialog: () =>
    ipcRenderer.invoke('dialog:open'),

  // Shortcut listener
  onShortcut: (callback: (action: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: string) => callback(action)
    ipcRenderer.on('shortcut:addBill', handler)
    return () => ipcRenderer.removeListener('shortcut:addBill', handler)
  },

  // Auth
  sendCode: (email: string, registeredUserOnly = false) =>
    ipcRenderer.invoke('auth:sendCode', email, registeredUserOnly),

  register: (email: string, password: string, verifyCode: string, verificationId: string) =>
    ipcRenderer.invoke('auth:register', email, password, verifyCode, verificationId),

  login: (email: string, password: string) =>
    ipcRenderer.invoke('auth:login', email, password),

  loginWithCode: (email: string, code: string, verificationId: string) =>
    ipcRenderer.invoke('auth:loginWithCode', email, code, verificationId),

  logout: () =>
    ipcRenderer.invoke('auth:logout'),

  checkSession: (allowAutoLogin: boolean) =>
    ipcRenderer.invoke('auth:checkSession', allowAutoLogin),

  saveCredentials: (identifier: string, rememberAccount: boolean, autoLogin: boolean) =>
    ipcRenderer.invoke('auth:saveCredentials', identifier, rememberAccount, autoLogin),

  loadCredentials: () =>
    ipcRenderer.invoke('auth:loadCredentials'),

  sendReauthCode: (verifyOpt?: 'phone_code' | 'email_code') =>
    ipcRenderer.invoke('auth:sendReauthCode', verifyOpt),

  changePassword: (newPassword: string, verificationCode: string, oldPassword?: string) =>
    ipcRenderer.invoke('auth:changePassword', newPassword, verificationCode, oldPassword),

  resetPassword: (identifier: string, newPassword: string, verificationCode: string, verificationId: string) =>
    ipcRenderer.invoke('auth:resetPassword', identifier, newPassword, verificationCode, verificationId),

  // Sync
  getSyncStatus: () =>
    ipcRenderer.invoke('sync:getStatus'),

  // Account Binding
  getAccountBindings: () =>
    ipcRenderer.invoke('account:getBindings'),

  sendBindCode: (target: string) =>
    ipcRenderer.invoke('account:sendBindCode', target),

  bindPhone: (phone: string, code: string, verificationId: string) =>
    ipcRenderer.invoke('account:bindPhone', phone, code, verificationId),

  unbindPhone: (code: string, verificationId: string) =>
    ipcRenderer.invoke('account:unbindPhone', code, verificationId),

  bindEmail: (email: string, code: string, verificationId: string) =>
    ipcRenderer.invoke('account:bindEmail', email, code, verificationId),

  unbindEmail: (code: string, verificationId: string) =>
    ipcRenderer.invoke('account:unbindEmail', code, verificationId),

  deleteAccount: (code: string) =>
    ipcRenderer.invoke('account:deleteAccount', code),

  getUserStats: () =>
    ipcRenderer.invoke('account:getUserStats'),

  // 检查云端服务是否可用（用于 Profile 等模块显示降级提示）
  isCloudSyncEnabled: () =>
    ipcRenderer.invoke('cloud:isEnabled') as Promise<boolean>,

  // Shortcut
  createShortcut: () =>
    ipcRenderer.invoke('app:createShortcut')
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
