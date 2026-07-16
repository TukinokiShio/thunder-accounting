import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'

let db: SqlJsDatabase
let dbPath: string

// ─── Helpers ───────────────────────────────────────

/**
 * 将 sql.js 查询结果行转换为类型化对象。
 * sql.js 返回 Record<string, unknown>，调用处通过泛型指定目标类型。
 */
function rowTo<T>(row: Record<string, unknown>): T {
  return row as unknown as T
}

/**
 * 将 @name 形式的命名参数转换为 sql.js 所需的 ? 占位符 + values 数组。
 * 避免 queryAll / runStmt 中的重复正则替换逻辑。
 */
function convertNamedParams(
  sql: string,
  params?: Record<string, string | number>
): { sql: string; values: (string | number)[] } {
  const values: (string | number)[] = []
  if (!params) return { sql, values }
  const newSql = sql.replace(/@(\w+)/g, (_match, name) => {
    values.push(params[name])
    return '?'
  })
  return { sql: newSql, values }
}

/**
 * 标准 CSV 字段转义：含逗号、双引号或换行的字段用双引号包裹，内部双引号加倍。
 * 同时抵御 Excel CSV 注入（以 = + - @ 开头的单元格加单引号前缀）。
 */
function escapeCSV(val: string | number): string {
  const s = String(val)
  // 防御 CSV 注入：以公式字符开头的单元格加单引号前缀
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
    return `"${safe.replace(/"/g, '""')}"`
  }
  return safe
}

/**
 * 初始化 SQLite 数据库。
 * 数据库文件存放在 Electron 用户数据目录（userData）下，首次启动自动创建。
 * 包含：建表、索引创建、预设分类写入、旧版本数据库迁移（添加 type 列）。
 */
export async function initDatabase(): Promise<void> {
  dbPath = path.join(app.getPath('userData'), 'thunder-accounting.db')

  // 尝试加载已有数据库文件；不存在则创建空库
  const SQL = await initSqlJs()
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  // WAL（Write-Ahead Logging）模式：写入操作不阻塞读取，
  // 适合频繁小额写入的记账场景，读写并发性能优于默认的 DELETE 模式
  db.run('PRAGMA journal_mode = WAL')
  // 启用外键约束检查，保证数据引用完整性
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

  // v1.4 之前版本创建的数据库缺少 type 列（支出/收入）。
  // 此处尝试添加，若列已存在则 SQLite 报 "duplicate column" 错误，可安全忽略；
  // 其他错误（如磁盘满）需记录日志以便排查。
  try {
    db.run("ALTER TABLE bills ADD COLUMN type TEXT NOT NULL DEFAULT 'expense'")
  } catch (e) {
    if (!String(e).includes('duplicate column')) {
      console.error('数据库迁移失败（添加 type 列）：', e)
    }
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

/** 将内存数据库完整序列化并写入磁盘文件，确保数据持久化 */
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

/** 首次启动时将硬编码的预设分类写入数据库。已有预设数据时跳过，避免重复写入。 */
function initPresetCategories(): void {
  // 检查预设分类是否已写入（避免重复初始化）
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

/** 查询全部或指定 type 的分类列表，按 type → sort_order → id 排序 */
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
    return rowTo<CategoryRow>(obj)
  })
}

/**
 * 新增自定义分类。自动计算 sort_order（该 type 下现有最大序号 + 1），
 * 确保新分类追加到列表末尾。
 */
export function addCategory(params: AddCategoryParams): CategoryRow {
  const name = params.name
  const icon = params.icon || '📦'
  const children = JSON.stringify(params.children || [])
  const type = params.type || 'expense'

  // 获取该 type 下最大的 sort_order；空表时 COALESCE(MAX(...), -1) 返回 -1，sortOrder 从 0 开始
  const maxResult = db.exec('SELECT COALESCE(MAX(sort_order), -1) as mx FROM categories WHERE type = ?', [type])
  const maxVal = maxResult.length > 0 ? (maxResult[0].values[0][0] as number) : -1
  const sortOrder = maxVal + 1

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
  return rowTo<CategoryRow>(obj)
}

/** 按传入字段动态构建 UPDATE 语句，仅更新非 undefined 字段，避免覆盖未修改的列 */
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
  return rowTo<CategoryRow>(obj)
}

/** 删除分类。SQL 层通过 is_preset = 0 保护预设分类不被误删，双保险。 */
export function deleteCategory(id: number): void {
  // 仅允许删除自定义分类，预设分类受保护（SQL WHERE 条件 + 前端拦截双重保护）
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

/**
 * 执行查询并返回 Bill 数组。
 * 将 @named 命名参数转换为 sql.js 的 ? 占位符后执行，结果行通过 rowTo<BillRow> 映射。
 */
function queryAll(sql: string, params?: Record<string, string | number>): BillRow[] {
  const { sql: stmt, values } = convertNamedParams(sql, params)
  const results = db.exec(stmt, values)
  if (!results.length || !results[0].columns.length) return []
  const cols = results[0].columns
  return results[0].values.map((row: unknown[]) => {
    const obj: Record<string, unknown> = {}
    cols.forEach((col: string, i: number) => { obj[col] = row[i] })
    return rowTo<BillRow>(obj)
  })
}

function queryOne(sql: string, params?: Record<string, string | number>): BillRow | null {
  const rows = queryAll(sql, params)
  return rows.length > 0 ? rows[0] : null
}

/**
 * 执行 INSERT/UPDATE/DELETE 语句并持久化，返回 last_insert_rowid。
 * 与 queryAll 行为不同：queryAll 返回查询结果集，runStmt 执行写操作后返回新插入行的 ID。
 */
function runStmt(sql: string, params?: Record<string, string | number>): number {
  const { sql: stmt, values } = convertNamedParams(sql, params)
  db.run(stmt, values)
  saveDb()

  // Get last insert rowid
  const result = db.exec('SELECT last_insert_rowid() as id')
  if (result.length && result[0].values.length) {
    return result[0].values[0][0] as number
  }
  return 0
}

/**
 * 新增账单记录并返回写入后的完整行（含自增 id 和 created_at）。
 * 使用命名参数 @xxx 语法，通过 convertNamedParams 转为 sql.js 的 ? 占位符。
 */
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

/** 多条件查询账单列表，支持日期范围 + 一级分类筛选，按日期降序 → 创建时间降序排列 */
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

/** 按传入字段动态构建 UPDATE，仅更新非 undefined 字段，返回更新后的完整行 */
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

/** 按主键删除一条账单记录，不可恢复 */
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

/**
 * 多维度统计聚合查询。
 * 一次查询返回：总金额/笔数、按一级分类汇总、按二级分类汇总、按日期汇总。
 * 按 type 参数区分支出/收入统计。
 */
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

/**
 * 将账单数据导出为 CSV 格式字符串。
 * 表头使用中文列名；每个字段经过 CSV 转义（逗号/换行/双引号）和公式注入防御。
 * 文件头添加 UTF-8 BOM（﻿），确保 Excel 双击打开时中文字符不乱码。
 */
export function exportCSV(startDate?: string, endDate?: string): string {
  const bills = getBills({ startDate, endDate })
  const header = 'id,金额,一级分类,二级分类,日期,备注,类型,创建时间\n'
  const rows = bills.map(b =>
    [
      escapeCSV(b.id),
      escapeCSV(b.amount),
      escapeCSV(b.category1),
      escapeCSV(b.category2),
      escapeCSV(b.date),
      escapeCSV(b.note),
      escapeCSV(b.type),
      escapeCSV(b.created_at)
    ].join(',')
  ).join('\n')
  // 文件头添加 UTF-8 BOM（﻿），确保 Excel 双击打开时中文字符不乱码
  return '﻿' + header + rows
}

// ─── Backup / Restore ─────────────────────────────

/** 将 sql.js 原始查询结果（columns + values 二维数组）转换为对象数组，方便 JSON 序列化 */
function rowsToObjects(result: { columns: string[]; values: unknown[][] }): Record<string, unknown>[] {
  if (!result.columns.length) return []
  return result.values.map((row) => {
    const obj: Record<string, unknown> = {}
    result.columns.forEach((col, i) => { obj[col] = row[i] })
    return obj
  })
}

/** 将全部账单和分类数据导出为 JSON 字符串，用于备份功能 */
export function exportAllJSON(): string {
  const bills = db.exec('SELECT * FROM bills ORDER BY id ASC')
  const categories = db.exec('SELECT * FROM categories ORDER BY id ASC')

  const billsJson = bills.length ? rowsToObjects(bills[0]) : []
  const catsJson = categories.length ? rowsToObjects(categories[0]) : []

  return JSON.stringify({
    version: 1,
    exported_at: new Date().toISOString(),
    bills: billsJson,
    categories: catsJson
  }, null, 2)
}

/**
 * 从 JSON 字符串导入账单和分类数据。
 * 先校验数据格式，再用事务包裹批量写入；中途失败自动回滚，保证数据一致性。
 * 预设分类（is_preset=1）在导入时跳过，由 initPresetCategories 统一管理。
 */
export function importAllJSON(json: string): { bills: number; categories: number } {
  let data: { bills?: unknown[]; categories?: unknown[]; version?: number }
  try {
    data = JSON.parse(json)
  } catch (e) {
    console.error('备份文件 JSON 解析失败：', e)
    throw new Error('JSON 格式无效')
  }

  if (!data.bills || !Array.isArray(data.bills)) {
    throw new Error('备份数据中没有 bills 数组')
  }

  // 在清空数据前逐条校验账单格式，避免写到一半才发现数据有问题
  const billsArr = data.bills as Array<Record<string, unknown>>
  for (let i = 0; i < billsArr.length; i++) {
    const b = billsArr[i]
    if (typeof b.id !== 'number' || typeof b.amount !== 'number') {
      throw new Error(`账单数据格式无效，第 ${i + 1} 行：缺少 id 或 amount`)
    }
    if (typeof b.category1 !== 'string' || typeof b.category2 !== 'string') {
      throw new Error(`账单数据格式无效，第 ${i + 1} 行：缺少分类信息`)
    }
  }

  // 用事务包裹恢复操作：中途失败自动回滚，保证数据完整性
  db.run('BEGIN TRANSACTION')
  try {
    // 清空现有数据
    db.run('DELETE FROM bills')
    // 仅删除自定义分类，保留预设分类
    db.run('DELETE FROM categories WHERE is_preset = 0')

    // 逐条恢复账单
    let billCount = 0
    const billStmt = db.prepare(
      'INSERT INTO bills (id, amount, category1, category2, date, note, type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    for (const b of billsArr) {
      billStmt.run([
        b.id, b.amount, b.category1, b.category2, b.date ?? '',
        b.note ?? '', b.type ?? 'expense', b.created_at ?? new Date().toISOString()
      ])
      billCount++
    }
    billStmt.free()

    // 恢复自定义分类（预设分类由 initPresetCategories 统一管理，导入时跳过）
    let catCount = 0
    if (data.categories && Array.isArray(data.categories)) {
      const catStmt = db.prepare(
        'INSERT INTO categories (id, name, icon, children, type, is_preset, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      for (const c of data.categories as Array<Record<string, unknown>>) {
        if (c.is_preset === 1) continue // 跳过预设分类，它们由 initPresetCategories 自动初始化
        catStmt.run([
          c.id, c.name, c.icon, c.children, c.type,
          0, c.sort_order ?? 0, c.created_at ?? new Date().toISOString()
        ])
        catCount++
      }
      catStmt.free()
    }

    db.run('COMMIT')
    saveDb()
    return { bills: billCount, categories: catCount }
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }
}

/** 清除全部账单和自定义分类数据（预设分类保留），操作后立即持久化到磁盘 */
export function clearAllData(): void {
  db.run('DELETE FROM bills')
  db.run('DELETE FROM categories WHERE is_preset = 0')
  saveDb()
}
