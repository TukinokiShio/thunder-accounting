/**
 * 主进程 database 写操作 rowid 时序回归测试（node 环境 + 真实 sql.js）。
 *
 * 回归背景：addCategory / runStmt 此前在 INSERT 后先调 saveDb() 再取
 * last_insert_rowid()。saveDb 内部 db.export() 会关闭并重开 sql.js 连接，
 * 重开后的连接 last_insert_rowid() 恒为 0，导致按 id 回查失败：
 * - addCategory：SELECT * FROM categories WHERE id = 0 空结果 → rows[0] undefined
 *   TypeError → IPC category:add reject → 前端「保存失败，请重试」（新建分类报错）
 * - addBill（走 runStmt）：queryOne 返回 null → 添加账单同样失败
 * 修复：先取 last_insert_rowid() 再 saveDb()。
 */
// @vitest-environment node
import { describe, it, expect, beforeAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thunder-regression-'))

vi.mock('electron', () => ({
  app: { getPath: (_name: string) => tmpDir },
}))

import { initDatabase, addCategory, addBill, getBills, getCategories } from '../main-process/database/index'

describe('database: addCategory/addBill rowid 时序回归（saveDb 后 last_insert_rowid 被重置）', () => {
  beforeAll(async () => {
    await initDatabase()
  })

  it('addCategory 返回有效行（id > 0）且 getCategories 可查到', () => {
    const cat = addCategory({ name: '宠物', icon: '🐈', children: ['猫粮', '玩具'], type: 'expense' })
    expect(cat.id).toBeGreaterThan(0)
    expect(cat.name).toBe('宠物')
    expect(cat.type).toBe('expense')
    expect(JSON.parse(cat.children)).toEqual(['猫粮', '玩具'])

    const list = getCategories('expense')
    const found = list.find((c) => c.id === cat.id)
    expect(found).toBeDefined()
    expect(found?.name).toBe('宠物')
  })

  it('income 类型 addCategory 正常（id > 0 且可查）', () => {
    const cat = addCategory({ name: '测试收入', icon: '💰', children: ['子项'], type: 'income' })
    expect(cat.id).toBeGreaterThan(0)
    expect(cat.type).toBe('income')
    expect(getCategories('income').some((c) => c.id === cat.id)).toBe(true)
  })

  it('runStmt 路径回归：addBill 返回行 id > 0 且 getBills 可查到', () => {
    const bill = addBill({
      amount: 12.5,
      category1: '餐饮食品',
      category2: '午餐',
      date: '2026-09-01',
      note: 'rowid 回归用例',
      type: 'expense',
    })
    expect(bill).not.toBeNull()
    expect(bill.id).toBeGreaterThan(0)

    const list = getBills()
    const found = list.find((b) => b.id === bill.id)
    expect(found).toBeDefined()
    expect(found?.amount).toBe(12.5)
    expect(found?.note).toBe('rowid 回归用例')
  })
})
