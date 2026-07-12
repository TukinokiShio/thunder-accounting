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
