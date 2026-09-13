/**
 * 本地能力门禁：适配器的 15 个本地方法与桌面 IPC handler **逐条等价**。
 *
 * 环境：node + 真实 sql.js + 真实落盘（临时目录），与 `src/database-*.test.ts` 同构。
 * 目的：证明「安卓首版纯本地全链路可用」不是声明，而是被真实执行的。
 * 同时回归 rowid 时序 —— 适配器不得改变 `addCategory`/`addBill` 的「先取 rowid 再 saveDb」顺序。
 */
// @vitest-environment node
import fs from 'fs'
import os from 'os'
import path from 'path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thunder-android-adapter-'))

vi.mock('electron', () => ({
  app: { getPath: (_name: string) => tmpDir }
}))

import { initDatabase } from '../../main-process/database/index'
import { setStoragePort } from '../../main-process/database/storage'
import { createDesktopStoragePort } from '../../main-process/database/desktop-storage'
import { androidAdapter } from './android-adapter'

describe('适配器本地链路（真实 sql.js + 真实落盘）', () => {
  beforeAll(async () => {
    setStoragePort(createDesktopStoragePort())
    await initDatabase()
  })

  it('addBill 返回有效行（id > 0）且 getBills 可查到', async () => {
    const bill = await androidAdapter.addBill({
      amount: 42.5,
      category1: '餐饮食品',
      category2: '午餐',
      date: '2026-09-13',
      note: '安卓冒烟',
      type: 'expense'
    })
    expect(bill.id).toBeGreaterThan(0)
    expect(bill.type).toBe('expense')

    const bills = await androidAdapter.getBills({ category1: '餐饮食品' })
    expect(bills.some((b) => b.id === bill.id)).toBe(true)
  })

  it('addCategory 返回有效行（id > 0）—— rowid 时序未被适配器破坏', async () => {
    const category = await androidAdapter.addCategory({
      name: '安卓测试分类',
      icon: '🤖',
      children: ['子项甲', '子项乙'],
      type: 'expense'
    })
    expect(category.id).toBeGreaterThan(0)
    expect(JSON.parse(category.children)).toEqual(['子项甲', '子项乙'])

    const categories = await androidAdapter.getCategories('expense')
    expect(categories.some((c) => c.id === category.id)).toBe(true)
  })

  it('updateBill / updateCategory 生效并可读回', async () => {
    const bill = await androidAdapter.addBill({
      amount: 10,
      category1: '交通出行',
      category2: '公交地铁',
      date: '2026-09-12',
      note: '',
      type: 'expense'
    })
    const updated = await androidAdapter.updateBill(bill.id, { amount: 12, note: '改过' })
    expect(updated.amount).toBe(12)
    expect(updated.note).toBe('改过')

    const category = await androidAdapter.addCategory({ name: '待改名', type: 'income' })
    const renamed = await androidAdapter.updateCategory(category.id, { name: '已改名', icon: '✅' })
    expect(renamed.name).toBe('已改名')
    expect(renamed.icon).toBe('✅')
  })

  it('reorderCategories 立即持久化', async () => {
    const a = await androidAdapter.addCategory({ name: '排序甲', type: 'income' })
    const b = await androidAdapter.addCategory({ name: '排序乙', type: 'income' })
    await androidAdapter.reorderCategories([b.id, a.id])
    const list = await androidAdapter.getCategories('income')
    expect(list.findIndex((c) => c.id === b.id)).toBeLessThan(list.findIndex((c) => c.id === a.id))
  })

  it('deleteBill / deleteCategory 生效', async () => {
    const bill = await androidAdapter.addBill({
      amount: 1,
      category1: '其他杂项',
      category2: '其他',
      date: '2026-09-01',
      note: '',
      type: 'expense'
    })
    await androidAdapter.deleteBill(bill.id)
    expect((await androidAdapter.getBills()).some((b) => b.id === bill.id)).toBe(false)

    const category = await androidAdapter.addCategory({ name: '待删除', type: 'expense' })
    await androidAdapter.deleteCategory(category.id)
    expect((await androidAdapter.getCategories()).some((c) => c.id === category.id)).toBe(false)
  })

  it('getStats 返回四维聚合结构', async () => {
    const stats = await androidAdapter.getStats('2026-01-01', '2026-12-31', 'expense')
    expect(stats).toMatchObject({
      totalAmount: expect.any(Number),
      count: expect.any(Number)
    })
    expect(Array.isArray(stats.byCategory1)).toBe(true)
    expect(Array.isArray(stats.byCategory2)).toBe(true)
    expect(Array.isArray(stats.byDate)).toBe(true)
  })

  it('exportCSV 带 UTF-8 BOM 与中文表头（与桌面同源实现）', async () => {
    const csv = await androidAdapter.exportCSV({ startDate: '2026-01-01', endDate: '2026-12-31' })
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('id,金额,一级分类,二级分类,日期,备注,类型,创建时间')
  })

  it('getUserStats 与桌面 cloudbase.ts:1382-1402 同算法（本地聚合）', async () => {
    const stats = await androidAdapter.getUserStats()
    const bills = await androidAdapter.getBills()
    const categories = await androidAdapter.getCategories()
    expect(stats.billCount).toBe(bills.length)
    expect(stats.categoryCount).toBe(categories.length)
    expect(stats.totalExpense).toBeCloseTo(
      bills.filter((b) => b.type === 'expense').reduce((s, b) => s + b.amount, 0),
      2
    )
    expect(stats.totalIncome).toBeCloseTo(
      bills.filter((b) => b.type === 'income').reduce((s, b) => s + b.amount, 0),
      2
    )
  })

  it('exportBackup → importBackup 往返一致（跨端互导格式，RL-A3）', async () => {
    const json = await androidAdapter.exportBackup()
    const before = await androidAdapter.getBills()

    const first = await androidAdapter.importBackup(json)
    expect(first.bills).toBe(before.length)

    const after = await androidAdapter.getBills()
    expect(after.length).toBe(before.length)
    expect(after.map((b) => b.id).sort((x, y) => x - y)).toEqual(
      before.map((b) => b.id).sort((x, y) => x - y)
    )
  })

  it('clearAllData 清空账单与自定义分类，统计归零', async () => {
    await androidAdapter.clearAllData()
    expect(await androidAdapter.getBills()).toEqual([])
    const stats = await androidAdapter.getUserStats()
    expect(stats.billCount).toBe(0)
    expect(stats.totalExpense).toBe(0)
    expect(stats.totalIncome).toBe(0)
    // 预设分类保留（与桌面 clearAllData 语义一致）
    expect((await androidAdapter.getCategories()).length).toBeGreaterThan(0)
  })

  it('数据真实落盘到 StoragePort 指定的数据目录', async () => {
    await androidAdapter.addBill({
      amount: 3,
      category1: '其他杂项',
      category2: '其他',
      date: '2026-09-13',
      note: '落盘断言',
      type: 'expense'
    })
    const dbPath = path.join(tmpDir, 'thunder-accounting.db')
    expect(fs.existsSync(dbPath)).toBe(true)
    expect(fs.statSync(dbPath).size).toBeGreaterThan(0)
  })
})
