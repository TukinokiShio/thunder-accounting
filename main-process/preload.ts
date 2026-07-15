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

  // Shortcut listener
  onShortcut: (callback: (action: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: string) => callback(action)
    ipcRenderer.on('shortcut:addBill', handler)
    return () => ipcRenderer.removeListener('shortcut:addBill', handler)
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
