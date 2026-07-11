import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import { initDatabase, addBill, getBills, updateBill, deleteBill, getStats, exportCSV } from './database'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: '雷霆记账',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // In dev, load from vite dev server
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ─── App lifecycle ─────────────────────────────────

app.whenReady().then(async () => {
  await initDatabase()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ─── IPC Handlers ──────────────────────────────────

function registerIpcHandlers(): void {
  // Bill CRUD
  ipcMain.handle('bill:add', (_event, params) => addBill(params))
  ipcMain.handle('bill:getAll', (_event, filters) => getBills(filters))
  ipcMain.handle('bill:update', (_event, id, params) => updateBill(id, params))
  ipcMain.handle('bill:delete', (_event, id) => { deleteBill(id) })

  // Stats
  ipcMain.handle('stats:get', (_event, startDate, endDate) => getStats(startDate, endDate))

  // Export
  ipcMain.handle('export:csv', (_event, filters) => exportCSV(filters?.startDate, filters?.endDate))

  // File save dialog
  ipcMain.handle('dialog:save', async (_event, defaultName: string) => {
    if (!mainWindow) return null
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: [
        { name: 'CSV 文件', extensions: ['csv'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    return result.canceled ? null : result.filePath
  })

  // File write
  ipcMain.handle('file:write', (_event, filePath: string, content: string) => {
    fs.writeFileSync(filePath, content, 'utf-8')
    return true
  })
}
