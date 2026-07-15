import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlJsStatic = any

let db: SqlJsDatabase
let dbPath: string

export async function initDatabase(): Promise<void> {
  dbPath = path.join(app.getPath('userData'), 'thunder-accounting.db')

  // Load existing database or create new one
  const SQL = await initSqlJs()
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA foreign_keys = ON')

  db.run(`
    CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount REAL NOT NULL,
      category1 TEXT NOT NULL,
      category2 TEXT NOT NULL,
      date TEXT NOT NULL,
      note TEXT DEFAULT '',
      type TEXT NOT NULL DEFAULT 'expense',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `)
  db.run('CREATE INDEX IF NOT EXISTS idx_bills_date ON bills(date)')
  db.run('CREATE INDEX IF NOT EXISTS idx_bills_category1 ON bills(category1)')

  // 兼容旧数据库：尝试添加 type 列
  try {
    db.run("ALTER TABLE bills ADD COLUMN type TEXT NOT NULL DEFAULT 'expense'")
  } catch {
    // 列已存在则忽略
  }

  // ─── Categories table ──────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '📦',
      children TEXT NOT NULL DEFAULT '[]',
      type TEXT NOT NULL DEFAULT 'expense',
      is_preset INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `)

  // 首次启动：写入预设分类
  initPresetCategories()

  saveDb()
}

function saveDb(): void {
  const data = db.export()
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(dbPath, Buffer.from(data))
}

// ─── Category types ──────────────────────────────

export interface CategoryRow {
  id: number
  name: string
  icon: string
  children: string  // JSON array string
  type: string
  is_preset: number
  sort_order: number
  created_at: string
}

export interface AddCategoryParams {
  name: string
  icon?: string
  children?: string[]
  type?: 'expense' | 'income'
}

export interface UpdateCategoryParams {
  name?: string
  icon?: string
  children?: string[]
  sort_order?: number
}

// ─── Preset category data ─────────────────────────

const PRESET_EXPENSE_CATEGORIES = [
  { name: '餐饮食品', icon: '🍽️', children: ['早餐', '午餐', '晚餐', '外卖外带', '聚餐宴请', '买菜做饭'] },
  { name: '交通出行', icon: '🚗', children: ['公交地铁', '出租车/网约车', '燃油充电', '停车费', '火车高铁', '飞机票', '车辆保养维修'] },
  { name: '购物消费', icon: '🛒', children: ['服饰鞋帽', '数码电子', '日用品', '美妆护肤', '家居百货', '宠物用品', '零食饮料', '水果'] },
  { name: '住房物业', icon: '🏠', children: ['房租', '房贷', '水电燃气', '物业费', '维修装修', '家具家电'] },
  { name: '旅游出行', icon: '✈️', children: ['旅行度假', '机票酒店', '景点门票', '旅行团费', '当地交通', '旅行购物'] },
  { name: '医疗健康', icon: '💊', children: ['门诊挂号', '药品购买', '住院治疗', '体检', '牙科眼科', '保健品'] },
  { name: '教育学习', icon: '📚', children: ['书籍教材', '培训课程', '考试报名', '文具用品', '在线订阅'] },
  { name: '娱乐休闲', icon: '🎮', children: ['电影演出', '游戏充值', '运动健身', '咖啡茶馆', 'KTV酒吧'] },
  { name: '人情往来', icon: '🎁', children: ['礼物红包', '婚礼随礼', '聚餐AA', '孝敬长辈'] },
  { name: '金融保险', icon: '💰', children: ['保险缴费', '贷款利息', '手续费', '投资亏损'] },
  { name: '其他杂项', icon: '📦', children: ['快递邮寄', '证件办理', '捐款公益', '其他'] }
]

const PRESET_INCOME_CATEGORIES = [
  { name: '工资薪水', icon: '💼', children: ['基本工资', '奖金绩效', '加班补贴'] },
  { name: '兼职副业', icon: '💻', children: ['自由职业', '稿费版税', '咨询费'] },
  { name: '投资理财', icon: '📈', children: ['股票基金', '利息分红', '房租收入'] },
  { name: '红包转账', icon: '🎁', children: ['微信红包', '亲友转账', '节日礼金'] },
  { name: '退款报销', icon: '↩️', children: ['购物退款', '费用报销', '押金退还'] },
  { name: '其他收入', icon: '📦', children: ['二手出售', '其他'] }
]

function initPresetCategories(): void {
  // Check if presets already exist
  const countResult = db.exec("SELECT COUNT(*) as cnt FROM categories WHERE is_preset = 1")
  const count = countResult.length ? countResult[0].values[0][0] as number : 0
  if (count > 0) return

  const allPresets = [
    ...PRESET_EXPENSE_CATEGORIES.map((c, i) => ({ ...c, type: 'expense', sort_order: i })),
    ...PRESET_INCOME_CATEGORIES.map((c, i) => ({ ...c, type: 'income', sort_order: i }))
  ]

  const stmt = db.prepare(
    "INSERT INTO categories (name, icon, children, type, is_preset, sort_order) VALUES (?, ?, ?, ?, 1, ?)"
  )
  for (const cat of allPresets) {
    stmt.run([cat.name, cat.icon, JSON.stringify(cat.children), cat.type, cat.sort_order])
  }
  stmt.free()
}

// ─── Category CRUD ───────────────────────────────

function rowToCategory(row: Record<string, unknown>): CategoryRow {
  return {
    id: row.id as number,
    name: row.name as string,
    icon: row.icon as string,
    children: row.children as string,
    type: row.type as string,
    is_preset: row.is_preset as number,
    sort_order: row.sort_order as number,
    created_at: row.created_at as string
  }
}

export function getCategories(type?: 'expense' | 'income'): CategoryRow[] {
  let sql = 'SELECT * FROM categories'
  const params: (string | number)[] = []
  if (type) {
    sql += ' WHERE type = ?'
    params.push(type)
  }
  sql += ' ORDER BY type ASC, sort_order ASC, id ASC'
  const result = db.exec(sql, params)
  if (!result.length || !result[0].columns.length) return []
  const cols = result[0].columns
  return result[0].values.map((row: unknown[]) => {
    const obj: Record<string, unknown> = {}
    cols.forEach((col: string, i: number) => { obj[col] = row[i] })
    return rowToCategory(obj)
  })
}

export function addCategory(params: AddCategoryParams): CategoryRow {
  const name = params.name
  const icon = params.icon || '📦'
  const children = JSON.stringify(params.children || [])
  const type = params.type || 'expense'

  // Get max sort_order for this type
  const maxResult = db.exec('SELECT COALESCE(MAX(sort_order), -1) as mx FROM categories WHERE type = ?', [type])
  const sortOrder = (maxResult[0]?.values[0][0] as number) + 1

  db.run(
    'INSERT INTO categories (name, icon, children, type, is_preset, sort_order) VALUES (?, ?, ?, ?, 0, ?)',
    [name, icon, children, type, sortOrder]
  )
  saveDb()

  const result = db.exec('SELECT last_insert_rowid() as id')
  const id = result[0].values[0][0] as number
  const rows = db.exec('SELECT * FROM categories WHERE id = ?', [id])
  const cols = rows[0].columns
  const obj: Record<string, unknown> = {}
  cols.forEach((col: string, i: number) => { obj[col] = rows[0].values[0][i] })
  return rowToCategory(obj)
}

export function updateCategory(id: number, params: UpdateCategoryParams): CategoryRow {
  const fields: string[] = []
  const values: (string | number)[] = []

  if (params.name !== undefined) { fields.push('name = ?'); values.push(params.name) }
  if (params.icon !== undefined) { fields.push('icon = ?'); values.push(params.icon) }
  if (params.children !== undefined) { fields.push('children = ?'); values.push(JSON.stringify(params.children)) }
  if (params.sort_order !== undefined) { fields.push('sort_order = ?'); values.push(params.sort_order) }

  if (fields.length > 0) {
    values.push(id)
    db.run(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`, values)
    saveDb()
  }

  const rows = db.exec('SELECT * FROM categories WHERE id = ?', [id])
  const cols = rows[0].columns
  const obj: Record<string, unknown> = {}
  cols.forEach((col: string, i: number) => { obj[col] = rows[0].values[0][i] })
  return rowToCategory(obj)
}

export function deleteCategory(id: number): void {
  // Only allow deleting custom (non-preset) categories
  db.run('DELETE FROM categories WHERE id = ? AND is_preset = 0', [id])
  saveDb()
}

// ─── Bill CRUD ────────────────────────────────────

export interface BillRow {
  id: number
  amount: number
  category1: string
  category2: string
  date: string
  note: string
  type: string
  created_at: string
}

export interface AddBillParams {
  amount: number
  category1: string
  category2: string
  date: string
  note?: string
  type?: 'expense' | 'income'
}

function rowToBill(row: Record<string, unknown>): BillRow {
  return {
    id: row.id as number,
    amount: row.amount as number,
    category1: row.category1 as string,
    category2: row.category2 as string,
    date: row.date as string,
    note: row.note as string,
    type: row.type as string,
    created_at: row.created_at as string
  }
}

function queryAll(sql: string, params?: Record<string, string | number>): BillRow[] {
  // sql.js uses positional params; convert @named to ? placeholders
  const values: (string | number)[] = []
  const stmt = params
    ? sql.replace(/@(\w+)/g, (_match, name) => {
        values.push(params[name])
        return '?'
      })
    : sql

  const results = db.exec(stmt, values)
  if (!results.length || !results[0].columns.length) return []
  const cols = results[0].columns
  return results[0].values.map((row: unknown[]) => {
    const obj: Record<string, unknown> = {}
    cols.forEach((col: string, i: number) => { obj[col] = row[i] })
    return rowToBill(obj)
  })
}

function queryOne(sql: string, params?: Record<string, string | number>): BillRow | null {
  const rows = queryAll(sql, params)
  return rows.length > 0 ? rows[0] : null
}

function runStmt(sql: string, params?: Record<string, string | number>): number {
  let values: (string | number)[] = []
  if (params) {
    sql = sql.replace(/@(\w+)/g, (_match, name) => {
      values.push(params[name])
      return '?'
    })
  }
  db.run(sql, values)
  saveDb()

  // Get last insert rowid
  const result = db.exec('SELECT last_insert_rowid() as id')
  if (result.length && result[0].values.length) {
    return result[0].values[0][0] as number
  }
  return 0
}

export function addBill(params: AddBillParams): BillRow {
  const id = runStmt(`
    INSERT INTO bills (amount, category1, category2, date, note, type)
    VALUES (@amount, @category1, @category2, @date, @note, @type)
  `, {
    amount: params.amount,
    category1: params.category1,
    category2: params.category2,
    date: params.date,
    note: params.note || '',
    type: params.type || 'expense'
  })
  return queryOne('SELECT * FROM bills WHERE id = ?', { id: String(id) })!
}

export interface BillFilters {
  startDate?: string
  endDate?: string
  category1?: string
}

export function getBills(filters?: BillFilters): BillRow[] {
  let sql = 'SELECT * FROM bills WHERE 1=1'
  const params: Record<string, string | number> = {}

  if (filters?.startDate) {
    sql += ' AND date >= @startDate'
    params.startDate = filters.startDate
  }
  if (filters?.endDate) {
    sql += ' AND date <= @endDate'
    params.endDate = filters.endDate
  }
  if (filters?.category1) {
    sql += ' AND category1 = @category1'
    params.category1 = filters.category1
  }

  sql += ' ORDER BY date DESC, created_at DESC'
  return queryAll(sql, params)
}

export function updateBill(id: number, params: Partial<AddBillParams>): BillRow {
  const fields: string[] = []
  const values: Record<string, string | number> = { id }

  if (params.amount !== undefined) { fields.push('amount = @amount'); values.amount = params.amount }
  if (params.category1 !== undefined) { fields.push('category1 = @category1'); values.category1 = params.category1 }
  if (params.category2 !== undefined) { fields.push('category2 = @category2'); values.category2 = params.category2 }
  if (params.date !== undefined) { fields.push('date = @date'); values.date = params.date }
  if (params.note !== undefined) { fields.push('note = @note'); values.note = params.note }
  if (params.type !== undefined) { fields.push('type = @type'); values.type = params.type }

  if (fields.length > 0) {
    runStmt(`UPDATE bills SET ${fields.join(', ')} WHERE id = @id`, values)
  }
  return queryOne('SELECT * FROM bills WHERE id = @id', { id: String(id) })!
}

export function deleteBill(id: number): void {
  runStmt('DELETE FROM bills WHERE id = @id', { id })
}

// ─── Statistics ────────────────────────────────────

export interface StatsResult {
  totalAmount: number
  count: number
  byCategory1: Array<{ category1: string; total: number; count: number }>
  byCategory2: Array<{ category1: string; category2: string; total: number; count: number }>
  byDate: Array<{ date: string; total: number; count: number }>
}

export function getStats(startDate: string, endDate: string, type?: 'expense' | 'income'): StatsResult {
  let typeFilter = ''
  const params: (string | number)[] = [startDate, endDate]
  if (type) {
    typeFilter = ' AND type = ?'
    params.push(type)
  }

  const totalResult = db.exec(
    `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM bills WHERE date >= ? AND date <= ?${typeFilter}`,
    params
  )
  const totalRow = totalResult[0]?.values[0] ?? [0, 0]
  const totalAmount = totalRow[0] as number
  const count = totalRow[1] as number

  function execStats(sql: string): Array<Record<string, unknown>> {
    const res = db.exec(sql, params)
    if (!res.length || !res[0].columns.length) return []
    return res[0].values.map((row: unknown[]) => {
      const obj: Record<string, unknown> = {}
      res[0].columns.forEach((col, i) => { obj[col] = row[i] })
      return obj
    })
  }

  const byCategory1 = execStats(
    `SELECT category1, SUM(amount) as total, COUNT(*) as count FROM bills WHERE date >= ? AND date <= ?${typeFilter} GROUP BY category1 ORDER BY total DESC`
  ) as Array<{ category1: string; total: number; count: number }>

  const byCategory2 = execStats(
    `SELECT category1, category2, SUM(amount) as total, COUNT(*) as count FROM bills WHERE date >= ? AND date <= ?${typeFilter} GROUP BY category1, category2 ORDER BY total DESC`
  ) as Array<{ category1: string; category2: string; total: number; count: number }>

  const byDate = execStats(
    `SELECT date, SUM(amount) as total, COUNT(*) as count FROM bills WHERE date >= ? AND date <= ?${typeFilter} GROUP BY date ORDER BY date ASC`
  ) as Array<{ date: string; total: number; count: number }>

  return { totalAmount, count, byCategory1, byCategory2, byDate }
}

// ─── Export ─────────────────────────────────────────

export function exportCSV(startDate?: string, endDate?: string): string {
  const bills = getBills({ startDate, endDate })
  const header = 'id,金额,一级分类,二级分类,日期,备注,类型,创建时间\n'
  const rows = bills.map(b =>
    `${b.id},${b.amount},${b.category1},${b.category2},${b.date},"${b.note}",${b.type},${b.created_at}`
  ).join('\n')
  return '﻿' + header + rows // BOM for Excel Chinese support
}

// ─── Backup / Restore ─────────────────────────────

export function exportAllJSON(): string {
  const bills = db.exec('SELECT * FROM bills ORDER BY id ASC')
  const categories = db.exec('SELECT * FROM categories ORDER BY id ASC')

  const billCols = bills.length ? bills[0].columns : []
  const billRows = bills.length ? bills[0].values : []

  const catCols = categories.length ? categories[0].columns : []
  const catRows = categories.length ? categories[0].values : []

  const billsJson = billRows.map((row: unknown[]) => {
    const obj: Record<string, unknown> = {}
    billCols.forEach((col: string, i: number) => { obj[col] = row[i] })
    return obj
  })

  const catsJson = catRows.map((row: unknown[]) => {
    const obj: Record<string, unknown> = {}
    catCols.forEach((col: string, i: number) => { obj[col] = row[i] })
    return obj
  })

  return JSON.stringify({
    version: 1,
    exported_at: new Date().toISOString(),
    bills: billsJson,
    categories: catsJson
  }, null, 2)
}

export function importAllJSON(json: string): { bills: number; categories: number } {
  let data: { bills?: unknown[]; categories?: unknown[] }
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('JSON 格式无效')
  }

  if (!data.bills || !Array.isArray(data.bills)) {
    throw new Error('备份数据中没有 bills 数组')
  }

  // Clear existing data
  db.run('DELETE FROM bills')
  // Delete custom categories only, keep presets
  db.run('DELETE FROM categories WHERE is_preset = 0')

  // Restore bills
  let billCount = 0
  const billStmt = db.prepare(
    'INSERT INTO bills (id, amount, category1, category2, date, note, type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
  for (const b of data.bills as Array<Record<string, unknown>>) {
    billStmt.run([
      b.id, b.amount, b.category1, b.category2, b.date,
      b.note ?? '', b.type ?? 'expense', b.created_at ?? new Date().toISOString()
    ])
    billCount++
  }
  billStmt.free()

  // Restore categories (only custom ones; presets are managed by initPresetCategories)
  let catCount = 0
  if (data.categories && Array.isArray(data.categories)) {
    const catStmt = db.prepare(
      'INSERT INTO categories (id, name, icon, children, type, is_preset, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    for (const c of data.categories as Array<Record<string, unknown>>) {
      if (c.is_preset === 1) continue // skip presets, they are auto-initialized
      catStmt.run([
        c.id, c.name, c.icon, c.children, c.type,
        0, c.sort_order ?? 0, c.created_at ?? new Date().toISOString()
      ])
      catCount++
    }
    catStmt.free()
  }

  saveDb()
  return { bills: billCount, categories: catCount }
}

export function clearAllData(): void {
  db.run('DELETE FROM bills')
  db.run('DELETE FROM categories WHERE is_preset = 0')
  saveDb()
}
