import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { escapeCSV, exportCSV, exportAllJSON, importAllJSON } from './export'

let db: SqlJsDatabase
let dbPath: string
let currentUserId: string | null = null

/** 供 export 模块获取数据库实例（避免循环依赖直接导入 db 变量） */
export function getDb(): SqlJsDatabase {
  return db
}

/** 获取当前登录用户的 ID */
export function getCurrentUserId(): string | null {
  return currentUserId
}

/** 获取当前数据库文件路径 */
export function getDbPath(): string {
  return dbPath
}

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
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      ,cloud_id TEXT
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

  // v1.7 云同步版本新增 updated_at 列，用于冲突解决。
  // 旧数据库可能缺少此列，同样使用 try/catch 安全迁移。
  try {
    db.run("ALTER TABLE bills ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))")
  } catch (e) {
    if (!String(e).includes('duplicate column')) {
      console.error('数据库迁移失败（添加 bills.updated_at 列）：', e)
    }
  }
  try {
    db.run('ALTER TABLE bills ADD COLUMN cloud_id TEXT')
  } catch (e) {
    if (!String(e).includes('duplicate column')) console.error('数据库迁移失败（添加 bills.cloud_id 列）：', e)
  }
  try {
    db.run("ALTER TABLE categories ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))")
  } catch (e) {
    if (!String(e).includes('duplicate column')) {
      console.error('数据库迁移失败（添加 categories.updated_at 列）：', e)
    }
  }
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_cloud_id ON bills(cloud_id) WHERE cloud_id IS NOT NULL')

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
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      cloud_id TEXT
    )
  `)
  try {
    db.run('ALTER TABLE categories ADD COLUMN cloud_id TEXT')
  } catch (e) {
    if (!String(e).includes('duplicate column')) console.error('数据库迁移失败（添加 categories.cloud_id 列）：', e)
  }
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_cloud_id ON categories(cloud_id) WHERE cloud_id IS NOT NULL')

  // 首次启动：写入预设分类
  initPresetCategories()

  saveDb()
}

/**
 * 切换到用户专有数据库。
 * 首次启动时调用 initDatabase() 加载共享数据库（兼容旧版），
 * 用户登录后调用此函数切换到其专有数据库文件。
 *
 * @param userId - CloudBase 用户 UID
 * @param migrateSharedData - 是否将旧共享 DB 的数据迁移到当前用户（仅首次）
 */
export async function switchToUserDatabase(userId: string, migrateSharedData = false): Promise<void> {
  // 1. 保存当前数据库
  if (db) {
    try {
      saveDb()
    } catch (e) {
      console.error('切换用户数据库前保存失败:', e)
    }
  }

  // 0. 校验 userId 格式（防止路径遍历）
  if (!/^[a-zA-Z0-9_-]+$/.test(userId)) {
    throw new Error(`Invalid userId format: ${userId}`)
  }

  const SQL = await initSqlJs()
  const userDbPath = path.join(app.getPath('userData'), `thunder-accounting-${userId}.db`)
  const sharedDbPath = path.join(app.getPath('userData'), 'thunder-accounting.db')

  // 2. 尝试加载用户专有数据库
  if (fs.existsSync(userDbPath)) {
    const buffer = fs.readFileSync(userDbPath)
    db = new SQL.Database(buffer)
  } else {
    // 首次登录：创建新数据库
    db = new SQL.Database()

    // 如果需要迁移旧共享数据（仅 163 用户首次登录）
    if (migrateSharedData && fs.existsSync(sharedDbPath)) {
      try {
        const sharedBuffer = fs.readFileSync(sharedDbPath)
        db = new SQL.Database(sharedBuffer)
        console.log(`[DB] 已从共享数据库迁移数据到用户 ${userId}`)

        // 备份旧共享数据库，防止重复迁移
        const backupPath = path.join(app.getPath('userData'), 'thunder-accounting.db.migrated')
        fs.copyFileSync(sharedDbPath, backupPath)
        // 清空共享 DB 内容（保留文件以兼容旧版本检测）
        fs.writeFileSync(sharedDbPath, Buffer.from(new SQL.Database().export()))
      } catch (e) {
        console.error('[DB] 共享数据迁移失败，使用空数据库:', e)
        db = new SQL.Database()
      }
    }
  }

  // 3. 更新状态
  dbPath = userDbPath
  currentUserId = userId

  // 4. 确保表结构完整
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
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      cloud_id TEXT
    )
  `)
  db.run('CREATE INDEX IF NOT EXISTS idx_bills_date ON bills(date)')
  db.run('CREATE INDEX IF NOT EXISTS idx_bills_category1 ON bills(category1)')

  // 兼容性迁移
  try {
    db.run("ALTER TABLE bills ADD COLUMN type TEXT NOT NULL DEFAULT 'expense'")
  } catch (e) {
    if (!String(e).includes('duplicate column')) {
      console.error('数据库迁移失败（添加 type 列）：', e)
    }
  }
  try {
    db.run("ALTER TABLE bills ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))")
  } catch (e) {
    if (!String(e).includes('duplicate column')) {
      console.error('数据库迁移失败（添加 bills.updated_at 列）：', e)
    }
  }
  try {
    db.run('ALTER TABLE bills ADD COLUMN cloud_id TEXT')
  } catch (e) {
    if (!String(e).includes('duplicate column')) {
      console.error('数据库迁移失败（添加 bills.cloud_id 列）：', e)
    }
  }
  try {
    db.run("ALTER TABLE categories ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))")
  } catch (e) {
    if (!String(e).includes('duplicate column')) {
      console.error('数据库迁移失败（添加 categories.updated_at 列）：', e)
    }
  }

  db.run(`
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

  try {
    db.run('ALTER TABLE categories ADD COLUMN cloud_id TEXT')
  } catch (e) {
    if (!String(e).includes('duplicate column')) {
      console.error('数据库迁移失败（添加 categories.cloud_id 列）：', e)
    }
  }
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_cloud_id ON bills(cloud_id) WHERE cloud_id IS NOT NULL')
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_cloud_id ON categories(cloud_id) WHERE cloud_id IS NOT NULL')

  // 5. 初始化预设分类
  initPresetCategories()

  // 6. 持久化
  saveDb()

  console.log(`[DB] 已切换到用户数据库: ${userDbPath}`)
}

/** 将内存数据库完整序列化并写入磁盘文件，确保数据持久化 */
export function saveDb(): void {
  try {
    const data = db.export()
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(dbPath, Buffer.from(data))
  } catch (e) {
    console.error('数据库写入磁盘失败：', e)
    throw new Error('数据库保存失败，磁盘空间可能不足')
  }
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
  updated_at: string
  cloud_id?: string | null
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
  { name: '红包转账', icon: '🎁', children: ['微信红包', '亲��转账', '节日礼金'] },
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
  // 注意时序：必须先取 last_insert_rowid() 再 saveDb()。
  // saveDb 内部 db.export() 会关闭并重开 sql.js 连接，重开后的连接 last_insert_rowid() 恒为 0，
  // 若先持久化再取 rowid 会得到 0，导致后续按 id 查询失败（新建分类报错的根因）。
  const result = db.exec('SELECT last_insert_rowid() as id')
  const id = result[0].values[0][0] as number
  saveDb()

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
    db.run(`UPDATE categories SET ${fields.join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`, values)
    saveDb()
  }

  const rows = db.exec('SELECT * FROM categories WHERE id = ?', [id])
  if (!rows.length || !rows[0].values.length) {
    throw new Error(`分类不存在 (id=${id})`)
  }
  const cols = rows[0].columns
  const obj: Record<string, unknown> = {}
  cols.forEach((col: string, i: number) => { obj[col] = rows[0].values[0][i] })
  return rowTo<CategoryRow>(obj)
}

/** 删除分类（预设和自定义均可删除）。预设分类删除后重启应用会通过 initPresetCategories 自动恢复。 */
export function deleteCategory(id: number): void {
  db.run('DELETE FROM categories WHERE id = ?', [id])
  saveDb()
}

/**
 * 拖拽排序：按传入的 ID 顺序重新分配 sort_order（0, 1, 2, ...）。
 * 预设分类和自定义分类均可参与排序。
 */
export function reorderCategories(orderedIds: number[]): void {
  const stmt = db.prepare('UPDATE categories SET sort_order = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?')
  for (let i = 0; i < orderedIds.length; i++) {
    stmt.run([i, orderedIds[i]])
  }
  stmt.free()
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
  updated_at: string
  cloud_id?: string | null
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
 * 注意时序：必须先取 last_insert_rowid() 再 saveDb()——saveDb 内部 db.export()
 * 会关闭并重开 sql.js 连接，重开后的连接 last_insert_rowid() 恒为 0。
 */
function runStmt(sql: string, params?: Record<string, string | number>): number {
  const { sql: stmt, values } = convertNamedParams(sql, params)
  db.run(stmt, values)

  // 时序：先取 last_insert_rowid() 再 saveDb（export 会重置连接状态）
  const result = db.exec('SELECT last_insert_rowid() as id')
  const rowId = result.length && result[0].values.length ? (result[0].values[0][0] as number) : 0
  saveDb()
  return rowId
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
  // 命名参数 @id 语法（convertNamedParams 只转换 @name，? 配 params 对象会得到空绑定）
  return queryOne('SELECT * FROM bills WHERE id = @id', { id: String(id) })!
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
    runStmt(`UPDATE bills SET ${fields.join(', ')}, updated_at = datetime('now','localtime') WHERE id = @id`, values)
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

/** 清除全部账单和自定义分类数据（预设分类保留），操作后立即持久化到磁盘 */
export function clearAllData(): void {
  db.run('DELETE FROM bills')
  db.run('DELETE FROM categories WHERE is_preset = 0')
  saveDb()
}

// ─── Cloud Sync Helpers ─────────────────────────

export interface CloudBillRow {
  amount: number
  category1: string
  category2: string
  date: string
  note: string
  type: string
  created_at: string
  updated_at: string
  localId: number
  _id?: string
}

export interface CloudCategoryRow {
  name: string
  icon: string
  children: string
  type: string
  is_preset: number
  sort_order: number
  created_at: string
  updated_at: string
  localId: number
  _id?: string
}

/**
 * 将云端拉取的账单合并写入本地数据库。
 * 以云端文档 _id 建立稳定映射，避免跨设备本地自增 ID 冲突。
 * 重复登录同步幂等，并按 updated_at 只应用较新的云端记录。
 */
export function insertCloudBills(bills: CloudBillRow[]): void {
  const withCloudId = db.prepare(
    'INSERT OR IGNORE INTO bills (cloud_id, amount, category1, category2, date, note, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  const withoutId = db.prepare(
    'INSERT INTO bills (amount, category1, category2, date, note, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
  for (const b of bills) {
    const values = [b.amount, b.category1, b.category2, b.date, b.note || '', b.type || 'expense', b.created_at || '', b.updated_at || '']
    if (b._id) {
      const existing = db.exec('SELECT id, updated_at FROM bills WHERE cloud_id = ?', [b._id])
      if (existing.length && existing[0].values.length) {
        const localUpdated = String(existing[0].values[0][1] || '')
        if (b.updated_at > localUpdated) {
          db.run('UPDATE bills SET amount=?, category1=?, category2=?, date=?, note=?, type=?, created_at=?, updated_at=? WHERE cloud_id=?', [...values, b._id])
        }
      } else {
        withCloudId.run([b._id, ...values])
      }
    } else {
      withoutId.run(values)
    }
  }
  withCloudId.free()
  withoutId.free()
  saveDb()
}

/**
 * 将云端拉取的分类批量写入本地数据库（仅限非预设分类，预设分类由本地初始化）。
 */
export function insertCloudCategories(cats: CloudCategoryRow[]): void {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO categories (cloud_id, name, icon, children, type, is_preset, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  for (const c of cats) {
    // 跳过预设分类（本地 initPresetCategories 已创建）
    if (c.is_preset === 1) continue
    if (c._id) {
      const existing = db.exec('SELECT id, updated_at FROM categories WHERE cloud_id = ?', [c._id])
      if (existing.length && existing[0].values.length) {
        const localUpdated = String(existing[0].values[0][1] || '')
        if (c.updated_at > localUpdated) {
          db.run('UPDATE categories SET name=?, icon=?, children=?, type=?, is_preset=?, sort_order=?, created_at=?, updated_at=? WHERE cloud_id=?', [c.name, c.icon || '📦', c.children || '[]', c.type || 'expense', c.is_preset || 0, c.sort_order || 0, c.created_at || '', c.updated_at || '', c._id])
        }
      } else {
        stmt.run([c._id, c.name, c.icon || '📦', c.children || '[]', c.type || 'expense', c.is_preset || 0, c.sort_order || 0, c.created_at || '', c.updated_at || ''])
      }
    }
  }
  stmt.free()
  saveDb()
}

/** 将云端文档 ID 回写到本地，后续更新/删除使用稳定映射。 */
export function setBillCloudId(localId: number, cloudId: string): void {
  db.run('UPDATE bills SET cloud_id = ? WHERE id = ?', [cloudId, localId])
  saveDb()
}

export function setCategoryCloudId(localId: number, cloudId: string): void {
  db.run('UPDATE categories SET cloud_id = ? WHERE id = ?', [cloudId, localId])
  saveDb()
}

// ─── Re-export from export module ─────────────────

export { escapeCSV, exportCSV, exportAllJSON, importAllJSON }
