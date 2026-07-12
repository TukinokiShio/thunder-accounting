import { app, BrowserWindow, ipcMain, dialog, Menu, globalShortcut } from 'electron'
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
  setupMenu()
  registerShortcuts()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ─── Menu ──────────────────────────────────────────

function setupMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const, label: '关于雷霆记账' },
        { type: 'separator' as const },
        { role: 'quit' as const, label: '退出' }
      ]
    }] : []),
    {
      label: '文件',
      submenu: [
        {
          label: '记一笔',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('shortcut:addBill')
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'forceReload', label: '强制刷新' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于雷霆记账',
          click: () => {
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: '关于 雷霆记账',
              message: '⚡ 雷霆记账',
              detail: '轻量级个人日常记账工具\n\n3秒完成一笔记账，分类清晰，统计直观。\n数据存储在本地，安全可靠。'
            })
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// ─── Shortcuts ─────────────────────────────────────

function registerShortcuts(): void {
  // Ctrl+N / Cmd+N → 快速记一笔（渲染进程监听 shortcut:addBill）
  globalShortcut.register('CommandOrControl+N', () => {
    mainWindow?.webContents.send('shortcut:addBill', 'addBill')
  })
}

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
