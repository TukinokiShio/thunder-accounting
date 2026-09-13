/**
 * P1-2 契约门禁：`StoragePort` 注入边界 + `switchToUserDatabase` 的库路径/迁移语义等价。
 *
 * 背景：P1-2 把 `database/index.ts` 的落盘从 `fs` + `path` + `Buffer` 换成 StoragePort。
 * 其中**风险最高**的是共享库迁移那段（原实现 `fs.writeFileSync(sharedDbPath, Buffer.from(new SQL.Database().export()))`）
 * —— 它既涉及 `Buffer` 的移除，也涉及「备份 + 清空共享库」两个副作用，且此前无任何测试覆盖。
 */
// @vitest-environment node
import fs from 'fs'
import os from 'os'
import path from 'path'
import initSqlJs from 'sql.js'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thunder-switchuser-'))

vi.mock('electron', () => ({
  app: { getPath: (_name: string) => tmpDir }
}))

import {
  initDatabase,
  switchToUserDatabase,
  addBill,
  addCategory,
  getBills,
  getCategories,
  getDbPath,
  getCurrentUserId
} from '../main-process/database/index'
import { getStoragePort, setStoragePort } from '../main-process/database/storage'
import { createDesktopStoragePort } from '../main-process/database/desktop-storage'

const sharedPath = path.join(tmpDir, 'thunder-accounting.db')
const user1Path = path.join(tmpDir, 'thunder-accounting-user1.db')
const backupPath = path.join(tmpDir, 'thunder-accounting.db.migrated')

describe('StoragePort 安装门禁（fail-loud，禁止静默回退）', () => {
  it('未安装时 getStoragePort() 明确报错', () => {
    expect(() => getStoragePort()).toThrow(/StoragePort 未安装/)
  })
})

describe('switchToUserDatabase：库路径与共享库迁移语义', () => {
  beforeAll(async () => {
    setStoragePort(createDesktopStoragePort())
    await initDatabase()
  })

  it('initDatabase 落在共享库路径（<dataDir>/thunder-accounting.db）', () => {
    expect(getDbPath()).toBe(sharedPath)
    expect(fs.existsSync(sharedPath)).toBe(true)
  })

  it('首次登录 + migrate=true：迁移共享数据、写备份、清空共享库', async () => {
    addBill({
      amount: 66,
      category1: '共享分类',
      category2: '共享子类',
      date: '2026-09-13',
      note: '共享库原始数据',
      type: 'expense'
    })
    addCategory({ name: '共享自定义分类', type: 'expense' })
    expect(getBills()).toHaveLength(1)

    await switchToUserDatabase('user1', true)

    // 路径与身份切到 per-user 库
    expect(getDbPath()).toBe(user1Path)
    expect(getCurrentUserId()).toBe('user1')
    expect(fs.existsSync(user1Path)).toBe(true)

    // 共享数据已迁入
    expect(getBills()).toHaveLength(1)
    expect(getBills()[0].note).toBe('共享库原始数据')
    expect(getCategories().some((c) => c.name === '共享自定义分类')).toBe(true)

    // 旧共享库已备份
    expect(fs.existsSync(backupPath)).toBe(true)
    expect(fs.statSync(backupPath).size).toBeGreaterThan(0)

    // 共享库文件仍存在，但内容已被替换为「无表结构的新库」（沿用桌面原行为：
    // 原实现为 writeFileSync(sharedDbPath, Buffer.from(new SQL.Database().export()))，
    // 即写入一个全新空库 —— 目的仅是阻止重复迁移，表结构由下次 initDatabase 重建）
    const SQL = await initSqlJs()
    const reopened = new SQL.Database(fs.readFileSync(sharedPath))
    const tables = reopened.exec("SELECT name FROM sqlite_master WHERE type='table'")
    const names = tables.length ? tables[0].values.map((row) => String(row[0])) : []
    expect(names).not.toContain('bills')
  })

  it('migrate=false 的新用户得到空库（不得静默继承他人数据）', async () => {
    await switchToUserDatabase('user2')
    expect(getDbPath()).toBe(path.join(tmpDir, 'thunder-accounting-user2.db'))
    expect(getCurrentUserId()).toBe('user2')
    expect(getBills()).toHaveLength(0)
    // 预设分类仍由 initPresetCategories 初始化
    expect(getCategories().length).toBeGreaterThan(0)
  })

  it('非法 userId 被拒绝（路径遍历防线不得回退）', async () => {
    await expect(switchToUserDatabase('../evil')).rejects.toThrow(/Invalid userId format/)
  })
})
