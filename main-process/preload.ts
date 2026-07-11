import { contextBridge, ipcRenderer } from 'electron'

const electronAPI = {
  // Bills
  addBill: (params: {
    amount: number
    category1: string
    category2: string
    date: string
    note?: string
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
  }>) => ipcRenderer.invoke('bill:update', id, params),

  deleteBill: (id: number) => ipcRenderer.invoke('bill:delete', id),

  // Stats
  getStats: (startDate: string, endDate: string) =>
    ipcRenderer.invoke('stats:get', startDate, endDate),

  // Export
  exportCSV: (filters?: { startDate?: string; endDate?: string }) =>
    ipcRenderer.invoke('export:csv', filters),

  // Dialog for file save
  showSaveDialog: (defaultName: string) =>
    ipcRenderer.invoke('dialog:save', defaultName),

  // File write
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('file:write', filePath, content)
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
