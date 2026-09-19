/**
 * v2.0 老库升级专项（PRD docs/prd-v2.0.0-recurring.md 验收第 1 条）。
 *
 * 硬约束：**严禁破坏已有用户数据** —— v1.17.x 老库（无 recurrings 表、bills 无
 * recurring_id/payment_platform/fund_account 列）升级后必须无损打开：
 * ① 既有账单/分类的行与列值零变化；② 新表/新列为纯增量；③ 新 CRUD 可用。
 *
 * 本测试用 sql.js 按 v1.17.10 的真实 schema 手工构造老库文件，
 * 再走 initDatabase() 的真实升级路径（与桌面应用完全同一条代码路径）。
 */
// @vitest-environment node
import fs from 'fs'
import os from 'os'
import path from 'path'
import initSqlJs from 'sql.js'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thunder-upgrade-v2-'))

vi.mock('electron', () => ({
  app: { getPath: (_name: string) => tmpDir }
}))

import {
  initDatabase,
  addBill,
  getBills,
  getCategories,
  getRecurrings,
  addRecurring,
  updateRecurring,
  deleteRecurring
} from '../main-process/database/index'
import { setStoragePort } from '../main-process/database/storage'
import { createDesktopStoragePort } from '../main-process/database/desktop-storage'

const dbPath = path.join(tmpDir, 'thunder-accounting.db')

/** v1.17.10 的 bills 真实列集（无 v2.0 的三个新列） */
const OLD_BILLS_DDL = `
  CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    category1 TEXT NOT NULL,
    category2 TEXT NOT NULL,
    date TEXT NOT NULL,
    note TEXT DEFAULT '',
    type TEXT NOT NULL DEFAULT 'expense',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    cloud_id TEXT
  )
`

beforeAll(async () => {
  const SQL = await initSqlJs()
  const old = new SQL.Database()
  old.run('PRAGMA journal_mode = WAL')
  old.run(OLD_BILLS_DDL)
  old.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '📦',
      children TEXT NOT NULL DEFAULT '[]',
      type TEXT NOT NULL DEFAULT 'expense',
      is_preset INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      cloud_id TEXT
    )
  `)
  // 两条老账单 + 一条老自定义分类（模拟真实用户数据）
  old.run("INSERT INTO bills (amount, category1, category2, date, note, type) VALUES (12.34, '餐饮食品', '午餐', '2026-09-01', '老库账单一', 'expense')")
  old.run("INSERT INTO bills (amount, category1, category2, date, note, type) VALUES (99, '工资薪水', '基本工资', '2026-09-02', '老库收入', 'income')")
  old.run("INSERT INTO categories (name, icon, children, type, is_preset, sort_order) VALUES ('老自定义分类', '📦', '[]', 'expense', 0, 99)")
  old.run("INSERT INTO categories (name, icon, children, type, is_preset, sort_order) VALUES ('餐饮食品', '🍽️', '[\"早餐\",\"午餐\"]', 'expense', 1, 0)")
  fs.writeFileSync(dbPath, Buffer.from(old.export()))
  expect(fs.existsSync(dbPath)).toBe(true)

  setStoragePort(createDesktopStoragePort())
  await initDatabase()
})

describe('v2.0 增量迁移：老库无损升级（验收第 1 条）', () => {
  it('既有账单零变化（行数、金额、备注、类型逐字段）', () => {
    const bills = getBills()
    expect(bills).toHaveLength(2)
    const first = bills.find((b) => b.note === '老库账单一')!
    expect(first).toBeDefined()
    expect(first.amount).toBe(12.34)
    expect(first.category1).toBe('餐饮食品')
    expect(first.category2).toBe('午餐')
    expect(first.date).toBe('2026-09-01')
    expect(first.type).toBe('expense')
    const income = bills.find((b) => b.note === '老库收入')!
    expect(income.amount).toBe(99)
    expect(income.type).toBe('income')
  })

  it('既有分类零变化；新列对老行取 NULL/无值', () => {
    const cats = getCategories()
    expect(cats.some((c) => c.name === '老自定义分类' && c.is_preset === 0)).toBe(true)
    expect(cats.some((c) => c.name === '餐饮食品' && c.is_preset === 1)).toBe(true)
    // 老账单的新列可安全读取为空
    const first = getBills()[0]
    expect(first.recurring_id ?? null).toBeNull()
  })

  it('recurrings 表已创建且为空', () => {
    expect(getRecurrings()).toEqual([])
  })

  it('新 CRUD 可用：规则增改查删 + 带关联的账单写入', () => {
    const rec = addRecurring({
      name: 'Codex Plus',
      amount: 20,
      type: 'subscription',
      cycle_unit: 'month',
      cycle_interval: 1,
      next_date: '2026-10-08',
      category1: '其他杂项'
    })
    expect(getRecurrings()).toHaveLength(1)

    // v2.0.1：trade_day_only 列在老库升级后可写可读（增量补列）
    const updated = updateRecurring(rec.id, { next_date: '2026-11-08', paused: 1, trade_day_only: 1 })
    expect(updated.next_date).toBe('2026-11-08')
    expect(updated.paused).toBe(1)
    expect(updated.trade_day_only).toBe(1)

    const bill = addBill({
      amount: 20,
      category1: '其他杂项',
      category2: '其他杂项',
      date: '2026-10-08',
      note: 'Codex Plus',
      type: 'expense',
      recurring_id: rec.id,
      payment_platform: '微信',
      fund_account: '银行卡'
    })
    expect(bill.recurring_id).toBe(rec.id)
    expect(bill.payment_platform).toBe('微信')

    deleteRecurring(rec.id)
    expect(getRecurrings()).toHaveLength(0)
    // 删除规则不删账单（硬约束：只删规则）
    expect(getBills().some((b) => b.recurring_id === rec.id)).toBe(true)
  })
})
