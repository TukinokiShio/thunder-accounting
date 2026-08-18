import { app, BrowserWindow, ipcMain, dialog, Menu, globalShortcut, nativeImage, shell } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { initDatabase, addBill, getBills, updateBill, deleteBill, getStats, exportCSV, getCategories, addCategory, updateCategory, deleteCategory, reorderCategories, exportAllJSON, importAllJSON, clearAllData, switchToUserDatabase, getCurrentUserId, insertCloudBills, insertCloudCategories } from './database/index'
import { initCloudBase, registerWithEmail, registerWithPhone, loginWithEmail, loginWithVerificationCode, logout, checkSession, isLoggedIn, getUserId, upsertRemoteBill, deleteRemoteBill, upsertRemoteCategory, deleteRemoteCategory, saveCredentials, loadCredentials, changePassword, sendReauthCode, sendVerificationCode, resetPassword, pullBillsFromCloud, pullCategoriesFromCloud, resolveLoginIdentifier, getAccountBindings, bindPhone, unbindPhone, bindEmail, unbindEmail, sendBindVerificationCode, deleteAccount, getUserStats, isCloudSyncEnabled } from './cloudbase'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  // 运行时图标路径（开发模式 vs 生产模式）
  const iconPath = process.env.ELECTRON_RENDERER_URL
    ? path.join(__dirname, '../resources/icon.png')
    : path.join(process.resourcesPath, 'icon.png')

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: '雷霆记账',
    icon: nativeImage.createFromPath(iconPath),
    // 关键：先不显示窗口，等 renderer ready 再显示，避免看到默认 Electron 图标
    show: false,
    backgroundColor: '#ffffff',
    // 禁用默认菜单栏闪烁
    autoHideMenuBar: false,
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

  // renderer 加载完成后再显示窗口（避免白屏/图标闪烁）
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ─── App lifecycle ─────────────────────────────────

app.whenReady().then(async () => {
  await initDatabase()
  initCloudBase()
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
  try {
    globalShortcut.unregisterAll()
  } catch (e) {
    // unregisterAll 在某些平台上可能抛出异常，静默处理
    console.error('注销全局快捷键失败：', e)
  }
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
        // 生产环境隐藏开发者工具，仅开发模式下可用
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const, label: '开发者工具' }]),
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

/** 后台静默同步辅助函数：已登录时推送数据到云端，失败静默忽略 */
function trySync(fn: () => Promise<void>): void {
  if (!isLoggedIn()) return
  fn().catch(e => console.error('后台同步失败:', e))
}

/** 登录后幂等合并云端数据到本地；本地已有数据时也要拉取新增的跨设备记录。 */
async function syncCloudData(uid: string): Promise<void> {
  try {
    if (isLoggedIn()) {
      console.log(`[Sync] 合并拉取 ${uid} 的云端数据...`)
      const cloudBills = await pullBillsFromCloud()
      if (cloudBills.length > 0) {
        insertCloudBills(cloudBills)
        console.log(`[Sync] 已合并 ${cloudBills.length} 条云端账单到本地`)
      }
      const cloudCategories = await pullCategoriesFromCloud()
      if (cloudCategories.length > 0) {
        insertCloudCategories(cloudCategories)
        console.log(`[Sync] 已合并 ${cloudCategories.length} 条云端分类到本地`)
      }
    }
  } catch (e) {
    console.error('[Sync] 云端数据拉取失败:', e)
  }
}

function registerIpcHandlers(): void {
  // Bill CRUD
  ipcMain.handle('bill:add', (_event, params) => {
    const bill = addBill(params)
    trySync(() => upsertRemoteBill(bill))
    return bill
  })
  ipcMain.handle('bill:getAll', (_event, filters) => getBills(filters))
  ipcMain.handle('bill:update', (_event, id, params) => {
    const bill = updateBill(id, params)
    trySync(() => upsertRemoteBill(bill))
    return bill
  })
  ipcMain.handle('bill:delete', (_event, id) => {
    deleteBill(id)
    trySync(() => deleteRemoteBill(id))
  })

  // Stats
  ipcMain.handle('stats:get', (_event, startDate, endDate, type) => getStats(startDate, endDate, type))

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

  // File write（仅允许写入用户数据目录或文档目录，防止路径遍历攻击）
  ipcMain.handle('file:write', (_event, filePath: string, content: string) => {
    try {
      const allowedPaths = [app.getPath('userData'), app.getPath('documents')]
      const normalized = path.normalize(filePath)
      if (!allowedPaths.some(p => {
        const relative = path.relative(path.normalize(p), normalized)
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
      })) {
        throw new Error('不允许写入此路径')
      }
      writeFileSync(filePath, content, 'utf-8')
      return true
    } catch (e) {
      console.error('文件写入失败：', e)
      throw e
    }
  })

  // Categories
  ipcMain.handle('category:getAll', (_event, type) => getCategories(type))
  ipcMain.handle('category:add', (_event, params) => {
    const cat = addCategory(params)
    trySync(() => upsertRemoteCategory(cat))
    return cat
  })
  ipcMain.handle('category:update', (_event, id, params) => {
    const cat = updateCategory(id, params)
    trySync(() => upsertRemoteCategory(cat))
    return cat
  })
  ipcMain.handle('category:delete', (_event, id) => {
    deleteCategory(id)
    trySync(() => deleteRemoteCategory(id))
  })
  ipcMain.handle('category:reorder', (_event, orderedIds) => {
    reorderCategories(orderedIds)
  })

  // Backup / Restore / Clear
  ipcMain.handle('backup:export', () => exportAllJSON())
  ipcMain.handle('backup:import', (_event, json: string) => importAllJSON(json))
  ipcMain.handle('data:clear', () => { clearAllData() })

  // Open file dialog
  ipcMain.handle('dialog:open', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      filters: [
        { name: 'JSON 文件', extensions: ['json'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths.length) return null
    const filePath = result.filePaths[0]
    const content = await fs.readFile(filePath, 'utf-8')
    return { filePath, content }
  })

  // ─── Auth IPC Handlers ──────────────────────────

  ipcMain.handle('auth:sendCode', async (_event, target: string, registeredUserOnly = false) => {
    return sendVerificationCode(target, registeredUserOnly)
  })

  ipcMain.handle('auth:register', async (_event, identifier: string, password: string, verifyCode: string, verificationId: string) => {
    const isPhone = /^\d{11}$/.test(identifier)
    const result = isPhone
      ? await registerWithPhone(identifier, password, verifyCode, verificationId)
      : await registerWithEmail(identifier, password, verifyCode, verificationId)
    const uid = result.user.uid
    await switchToUserDatabase(uid, false)
    return result
  })

  ipcMain.handle('auth:login', async (_event, identifier: string, password: string) => {
    // 解析标识符（账号 ID / 邮箱 / 手机号 → 邮箱）
    const email = await resolveLoginIdentifier(identifier)
    const result = await loginWithEmail(email, password)
    const uid = result.user.uid
    const shouldMigrate = email === 'd850216088@163.com'
    await switchToUserDatabase(uid, shouldMigrate)
    await syncCloudData(uid)
    return result
  })

  ipcMain.handle('auth:loginWithCode', async (_event, identifier: string, code: string, verificationId: string) => {
    // 验证码登录走 identifier → resolveVerificationTarget（手机号优先）
    const result = await loginWithVerificationCode(identifier, code, verificationId)
    const uid = result.user.uid
    let dbEmail: string | undefined
    if (identifier === 'admin') dbEmail = '15211073887@163.com'
    else if (identifier.includes('@')) dbEmail = identifier
    const shouldMigrate = dbEmail === 'd850216088@163.com'
    await switchToUserDatabase(uid, shouldMigrate)
    await syncCloudData(uid)
    return result
  })

  ipcMain.handle('auth:logout', async () => {
    await logout()
  })

  ipcMain.handle('auth:checkSession', async () => {
    const session = await checkSession()
    if (session?.user.uid) {
      await switchToUserDatabase(session.user.uid, false)
      await syncCloudData(session.user.uid)
    }
    return session
  })

  // ─── Sync IPC Handlers ──────────────────────────

  ipcMain.handle('sync:getStatus', () => {
    return { isLoggedIn: isLoggedIn() }
  })

  // 检查云端服务是否可用（Profile 等模块使用）
  ipcMain.handle('cloud:isEnabled', () => {
    return isCloudSyncEnabled()
  })

  // ─── Remember Credentials ─────────────────────

  ipcMain.handle('auth:saveCredentials', async (_event, email: string, password: string) => {
    await saveCredentials(email, password)
  })

  ipcMain.handle('auth:loadCredentials', async () => {
    return loadCredentials()
  })

  // ─── Change Password ───────────────────────────

  ipcMain.handle('auth:sendReauthCode', async (_event, verifyOpt?: 'phone_code' | 'email_code') => {
    return sendReauthCode(verifyOpt)
  })

  ipcMain.handle('auth:changePassword', async (_event, newPassword: string, verificationCode: string, oldPassword?: string) => {
    return changePassword(newPassword, verificationCode, oldPassword)
  })

  ipcMain.handle('auth:resetPassword', async (_event, identifier: string, newPassword: string, verificationCode: string, verificationId: string) => {
    return resetPassword(identifier, newPassword, verificationCode, verificationId)
  })

  // ─── Account Binding ───────────────────────────

  ipcMain.handle('account:getBindings', async () => {
    return getAccountBindings()
  })

  ipcMain.handle('account:sendBindCode', async (_event, target: string) => {
    return sendBindVerificationCode(target)
  })

  ipcMain.handle('account:bindPhone', async (_event, phone: string, code: string, verificationId: string) => {
    return bindPhone(phone, code, verificationId)
  })

  ipcMain.handle('account:unbindPhone', async (_event, code: string, verificationId: string) => {
    return unbindPhone(code, verificationId)
  })

  ipcMain.handle('account:bindEmail', async (_event, email: string, code: string, verificationId: string) => {
    return bindEmail(email, code, verificationId)
  })

  ipcMain.handle('account:unbindEmail', async (_event, code: string, verificationId: string) => {
    return unbindEmail(code, verificationId)
  })

  ipcMain.handle('account:deleteAccount', async (_event, code: string) => {
    return deleteAccount(code)
  })

  ipcMain.handle('account:getUserStats', async () => {
    return getUserStats()
  })

  // ─── Desktop Shortcut ──────────────────────────

  ipcMain.handle('app:createShortcut', () => {
    const desktopPath = path.join(app.getPath('home'), 'Desktop', '雷霆记账.lnk')
    const exePath = path.join(__dirname, '..', '..', 'release', 'win-unpacked', '雷霆记账.exe')
    // For dev mode, use the actual project path
    const fallbackExe = path.join(app.getAppPath(), '..', 'release', 'win-unpacked', '雷霆记账.exe')

    const target = existsSync(exePath) ? exePath : fallbackExe
    if (!existsSync(target)) {
      return { success: false, message: `EXE not found at ${target}` }
    }

    const result = shell.writeShortcutLink(desktopPath, {
      target: target,
      description: '雷霆记账 - 个人记账工具',
      icon: target,
      iconIndex: 0,
    })
    return { success: result, message: result ? 'Created' : 'Failed to create shortcut' }
  })
}
