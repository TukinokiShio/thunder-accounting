// 注意：本模块**不得**引入 electron / fs / path / Buffer —— 它同时被桌面与安卓复用。
// 所有落盘/读盘走 StoragePort（`./storage`），由平台入口安装实现。
// 保留 `./export` 的静态导入形态：`index.ts` ↔ `export.ts` 是真实的（值级）循环依赖，
// 靠 `getDb()` 的惰性调用绕过静态求值顺序问题，不得为「看起来干净」重排。
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { escapeCSV, exportCSV, exportAllJSON, importAllJSON } from './export'
import { getStoragePort } from './storage'
import type { InvestmentCashFlow, InvestmentHolding } from '../../src/utils/investmentHoldings'
import type { InvestmentSnapshot } from '../../src/utils/investmentReturns'

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
 * 允许 null 值（v2.0 起部分可空列如 bills.recurring_id 以 null 绑定）。
 */
function convertNamedParams(
  sql: string,
  params?: Record<string, string | number | null>
): { sql: string; values: (string | number | null)[] } {
  const values: (string | number | null)[] = []
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
  const storage = getStoragePort()
  dbPath = storage.joinPath(storage.getDataDir(), 'thunder-accounting.db')

  // 尝试加载已有数据库文件；不存在则创建空库
  const SQL = await initSqlJs()
  if (storage.exists(dbPath)) {
    const buffer = storage.readDbFile(dbPath)
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

  // v2.0 周期支出：recurrings 表 + bills 关联列（增量迁移，两处建库路径共用）
  ensureRecurringsSchema()
  ensureInvestmentSchema()

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
  const storage = getStoragePort()
  const userDbPath = storage.joinPath(storage.getDataDir(), `thunder-accounting-${userId}.db`)
  const sharedDbPath = storage.joinPath(storage.getDataDir(), 'thunder-accounting.db')

  // 2. 尝试加载用户专有数据库
  if (storage.exists(userDbPath)) {
    const buffer = storage.readDbFile(userDbPath)
    db = new SQL.Database(buffer)
  } else {
    // 首次登录：创建新数据库
    db = new SQL.Database()

    // 如果需要迁移旧共享数据（仅 163 用户首次登录）
    if (migrateSharedData && storage.exists(sharedDbPath)) {
      try {
        const sharedBuffer = storage.readDbFile(sharedDbPath)
        db = new SQL.Database(sharedBuffer)
        console.log(`[DB] 已从共享数据库迁移数据到用户 ${userId}`)

        // 备份旧共享数据库，防止重复迁移
        const backupPath = storage.joinPath(storage.getDataDir(), 'thunder-accounting.db.migrated')
        storage.copyFile(sharedDbPath, backupPath)
        // 清空共享 DB 内容（保留文件以兼容旧版本检测）
        storage.writeDbFile(sharedDbPath, new SQL.Database().export())
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

  // v2.0 周期支出：recurrings 表 + bills 关联列（增量迁移，与 initDatabase 共用）
  ensureRecurringsSchema()
  ensureInvestmentSchema()

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
    const storage = getStoragePort()
    const dir = storage.dirname(dbPath)
    storage.mkdirp(dir)
    storage.writeDbFile(dbPath, data)
  } catch (e) {
    console.error('数据库写入磁盘失败：', e)
    throw new Error('数据库保存失败，磁盘空间可能不足')
  }
}

// ─── v2.0 Recurring（周期支出）schema ─────────────

/**
 * 确保 recurrings 表与 bills 的周期支出关联列存在。
 * 仅做增量变更（CREATE IF NOT EXISTS / ADD COLUMN），绝不触碰既有数据 ——
 * 升级路径的硬约束：v1.x 老库必须无损打开。
 * initDatabase 与 switchToUserDatabase 两条建库路径共用，避免两份漂移的 DDL。
 */
function ensureRecurringsSchema(): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS recurrings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      type TEXT NOT NULL DEFAULT 'subscription',
      cycle_unit TEXT NOT NULL DEFAULT 'month',
      cycle_interval INTEGER NOT NULL DEFAULT 1,
      next_date TEXT NOT NULL,
      category1 TEXT NOT NULL DEFAULT '',
      category2 TEXT,
      payment_platform TEXT,
      fund_account TEXT,
      note TEXT,
      paused INTEGER NOT NULL DEFAULT 0,
      trade_day_only INTEGER NOT NULL DEFAULT 0,
      symbol TEXT,
      auto_post INTEGER NOT NULL DEFAULT 0,
      cloud_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `)
  try {
    db.run('ALTER TABLE bills ADD COLUMN recurring_id INTEGER')
  } catch (e) {
    if (!String(e).includes('duplicate column')) console.error('数据库迁移失败（添加 bills.recurring_id 列）：', e)
  }
  try {
    db.run('ALTER TABLE bills ADD COLUMN payment_platform TEXT')
  } catch (e) {
    if (!String(e).includes('duplicate column')) console.error('数据库迁移失败（添加 bills.payment_platform 列）：', e)
  }
  try {
    db.run('ALTER TABLE bills ADD COLUMN fund_account TEXT')
  } catch (e) {
    if (!String(e).includes('duplicate column')) console.error('数据库迁移失败（添加 bills.fund_account 列）：', e)
  }
  // v2.0.1：定投仅在交易日执行（周末顺延）；老库增量补列
  try {
    db.run('ALTER TABLE recurrings ADD COLUMN trade_day_only INTEGER NOT NULL DEFAULT 0')
  } catch (e) {
    if (!String(e).includes('duplicate column')) console.error('数据库迁移失败（添加 recurrings.trade_day_only 列）：', e)
  }
  // v2.0.4：标的代码（定投选填）；老库增量补列
  try {
    db.run('ALTER TABLE recurrings ADD COLUMN symbol TEXT')
  } catch (e) {
    if (!String(e).includes('duplicate column')) console.error('数据库迁移失败（添加 recurrings.symbol 列）：', e)
  }
  // v2.0.5：到期自动入账；老库增量补列
  try {
    db.run('ALTER TABLE recurrings ADD COLUMN auto_post INTEGER NOT NULL DEFAULT 0')
  } catch (e) {
    if (!String(e).includes('duplicate column')) console.error('数据库迁移失败（添加 recurrings.auto_post 列）：', e)
  }
  db.run('CREATE INDEX IF NOT EXISTS idx_bills_recurring_id ON bills(recurring_id) WHERE recurring_id IS NOT NULL')
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_recurrings_cloud_id ON recurrings(cloud_id) WHERE cloud_id IS NOT NULL')
}

/** v2.1.1 low-frequency investment snapshots and idempotency ledger. */
function ensureInvestmentSchema(): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS investment_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      quantity TEXT NOT NULL,
      quantity_kind TEXT NOT NULL DEFAULT 'unknown',
      cost_basis TEXT,
      cost_basis_kind TEXT NOT NULL DEFAULT 'unknown',
      market_value TEXT,
      currency TEXT NOT NULL,
      as_of TEXT NOT NULL,
      source_note TEXT NOT NULL DEFAULT '',
      cloud_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `)
  const positionColumns = db.exec('PRAGMA table_info(investment_positions)')[0]?.values || []
  if (!positionColumns.some((row) => String(row[1]) === 'quantity_kind')) {
    db.run("ALTER TABLE investment_positions ADD COLUMN quantity_kind TEXT NOT NULL DEFAULT 'unknown'")
  }
  if (!positionColumns.some((row) => String(row[1]) === 'cost_basis_kind')) {
    db.run("ALTER TABLE investment_positions ADD COLUMN cost_basis_kind TEXT NOT NULL DEFAULT 'unknown'")
  }
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_investment_positions_asset_key ON investment_positions(asset_key)')
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_investment_positions_cloud_id ON investment_positions(cloud_id) WHERE cloud_id IS NOT NULL')
  db.run(`
    CREATE TABLE IF NOT EXISTS investment_sync_outbox (
      asset_key TEXT PRIMARY KEY,
      operation TEXT NOT NULL DEFAULT 'upsert',
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `)
  const outboxColumns = db.exec('PRAGMA table_info(investment_sync_outbox)')[0]?.values || []
  if (!outboxColumns.some((row) => String(row[1]) === 'revision')) {
    db.run('ALTER TABLE investment_sync_outbox ADD COLUMN revision INTEGER NOT NULL DEFAULT 1')
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_operations (
      operation_id TEXT PRIMARY KEY,
      payload_hash TEXT NOT NULL,
      operation_type TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS investment_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_key TEXT NOT NULL,
      name TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      quantity TEXT NOT NULL,
      quantity_kind TEXT NOT NULL DEFAULT 'unknown',
      cost_basis TEXT,
      cost_basis_kind TEXT NOT NULL DEFAULT 'unknown',
      market_value TEXT,
      currency TEXT NOT NULL,
      as_of TEXT NOT NULL,
      source_note TEXT NOT NULL DEFAULT '',
      cash_flows_complete INTEGER NOT NULL DEFAULT 0,
      operation_id TEXT NOT NULL,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE(asset_key, as_of)
    )
  `)
  const snapshotColumns = db.exec('PRAGMA table_info(investment_snapshots)')[0]?.values || []
  if (!snapshotColumns.some((row) => String(row[1]) === 'quantity_kind')) {
    db.run("ALTER TABLE investment_snapshots ADD COLUMN quantity_kind TEXT NOT NULL DEFAULT 'unknown'")
  }
  if (!snapshotColumns.some((row) => String(row[1]) === 'cost_basis_kind')) {
    db.run("ALTER TABLE investment_snapshots ADD COLUMN cost_basis_kind TEXT NOT NULL DEFAULT 'unknown'")
  }
  if (!snapshotColumns.some((row) => String(row[1]) === 'cash_flows_complete')) {
    db.run('ALTER TABLE investment_snapshots ADD COLUMN cash_flows_complete INTEGER NOT NULL DEFAULT 0')
  }
  if (!snapshotColumns.some((row) => String(row[1]) === 'operation_id')) {
    db.run("ALTER TABLE investment_snapshots ADD COLUMN operation_id TEXT NOT NULL DEFAULT ''")
  }
  if (!snapshotColumns.some((row) => String(row[1]) === 'recorded_at')) {
    // SQLite ADD COLUMN only permits a constant DEFAULT. Backfill after the
    // structural migration so legacy rows remain readable on the next launch.
    db.run("ALTER TABLE investment_snapshots ADD COLUMN recorded_at TEXT NOT NULL DEFAULT ''")
    db.run("UPDATE investment_snapshots SET recorded_at = datetime('now', 'localtime') WHERE recorded_at = ''")
  }
  db.run('CREATE INDEX IF NOT EXISTS idx_investment_snapshots_date ON investment_snapshots(as_of, asset_key)')
  db.run(`
    CREATE TABLE IF NOT EXISTS investment_cash_flows (
      asset_key TEXT NOT NULL,
      flow_id TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      date TEXT NOT NULL,
      kind TEXT NOT NULL,
      amount TEXT NOT NULL,
      currency TEXT NOT NULL,
      included_in_market_value INTEGER NOT NULL,
      source_note TEXT NOT NULL DEFAULT '',
      operation_id TEXT NOT NULL,
      PRIMARY KEY(asset_key, flow_id)
    )
  `)
}

// ─── Recurring CRUD（周期支出规则） ───────────────

export interface RecurringRow {
  id: number
  name: string
  amount: number
  type: 'subscription' | 'dca'
  cycle_unit: 'day' | 'week' | 'month' | 'year'
  cycle_interval: number
  next_date: string
  category1: string
  category2: string | null
  payment_platform: string | null
  fund_account: string | null
  note: string | null
  paused: number
  trade_day_only: number
  /** v2.0.4：标的代码（定投选填） */
  symbol?: string | null
  /** v2.0.5：到期自动入账 */
  auto_post: number
  cloud_id?: string | null
  created_at: string
  updated_at: string
}

export interface AddRecurringParams {
  name: string
  amount: number
  type?: 'subscription' | 'dca'
  cycle_unit?: 'day' | 'week' | 'month' | 'year'
  cycle_interval?: number
  next_date: string
  category1: string
  category2?: string | null
  payment_platform?: string | null
  fund_account?: string | null
  note?: string | null
  paused?: number
  trade_day_only?: number
  symbol?: string | null
  auto_post?: number
}

function queryAllRecurring(sql: string, params?: Record<string, string | number | null>): RecurringRow[] {
  const { sql: stmt, values } = convertNamedParams(sql, params)
  const results = db.exec(stmt, values)
  if (!results.length || !results[0].columns.length) return []
  const cols = results[0].columns
  return results[0].values.map((row: unknown[]) => {
    const obj: Record<string, unknown> = {}
    cols.forEach((col: string, i: number) => { obj[col] = row[i] })
    return rowTo<RecurringRow>(obj)
  })
}

/** 查询全部周期支出规则（含已暂停），按下一期日期升序 */
export function getRecurrings(): RecurringRow[] {
  return queryAllRecurring('SELECT * FROM recurrings ORDER BY next_date ASC, id ASC')
}

/** 新增周期支出规则，返回写入后的完整行。注意时序：先取 rowid 再 saveDb（见 runStmt 注释） */
export function addRecurring(params: AddRecurringParams): RecurringRow {
  if (params.type === 'dca') throw new Error('已移除定投周期规则；请改用投资持仓快照。')
  const id = runStmt(`
    INSERT INTO recurrings (name, amount, type, cycle_unit, cycle_interval, next_date, category1, category2, payment_platform, fund_account, note, paused, trade_day_only, symbol, auto_post)
    VALUES (@name, @amount, @type, @cycle_unit, @cycle_interval, @next_date, @category1, @category2, @payment_platform, @fund_account, @note, @paused, @trade_day_only, @symbol, @auto_post)
  `, {
    name: params.name,
    amount: params.amount,
    type: params.type || 'subscription',
    cycle_unit: params.cycle_unit || 'month',
    cycle_interval: params.cycle_interval ?? 1,
    next_date: params.next_date,
    category1: params.category1,
    category2: params.category2 ?? null,
    payment_platform: params.payment_platform ?? null,
    fund_account: params.fund_account ?? null,
    note: params.note ?? null,
    paused: params.paused ?? 0,
    trade_day_only: params.trade_day_only ?? 0,
    symbol: params.symbol ?? null,
    auto_post: params.auto_post ?? 0
  })
  const rows = queryAllRecurring('SELECT * FROM recurrings WHERE id = @id', { id })
  if (!rows.length) throw new Error(`周期支出规则写入后查询失败 (id=${id})`)
  return rows[0]
}

/** 按传入字段动态更新周期支出规则，仅更新非 undefined 字段，返回更新后的完整行 */
export function updateRecurring(id: number, params: Partial<AddRecurringParams>): RecurringRow {
  const existingRecurring = queryAllRecurring('SELECT * FROM recurrings WHERE id = @id', { id })[0]
  if (existingRecurring?.type === 'dca' && (params.type !== undefined || params.auto_post === 1)) {
    throw new Error('旧定投规则不可转换或自动入账。')
  }
  if (params.type === 'dca') throw new Error('已移除定投周期规则；请改用投资持仓快照。')
  const fields: string[] = []
  const values: Record<string, string | number | null> = { id }

  if (params.name !== undefined) { fields.push('name = @name'); values.name = params.name }
  if (params.amount !== undefined) { fields.push('amount = @amount'); values.amount = params.amount }
  if (params.type !== undefined) { fields.push('type = @type'); values.type = params.type }
  if (params.cycle_unit !== undefined) { fields.push('cycle_unit = @cycle_unit'); values.cycle_unit = params.cycle_unit }
  if (params.cycle_interval !== undefined) { fields.push('cycle_interval = @cycle_interval'); values.cycle_interval = params.cycle_interval }
  if (params.next_date !== undefined) { fields.push('next_date = @next_date'); values.next_date = params.next_date }
  if (params.category1 !== undefined) { fields.push('category1 = @category1'); values.category1 = params.category1 }
  if (params.category2 !== undefined) { fields.push('category2 = @category2'); values.category2 = params.category2 }
  if (params.payment_platform !== undefined) { fields.push('payment_platform = @payment_platform'); values.payment_platform = params.payment_platform }
  if (params.fund_account !== undefined) { fields.push('fund_account = @fund_account'); values.fund_account = params.fund_account }
  if (params.note !== undefined) { fields.push('note = @note'); values.note = params.note }
  if (params.paused !== undefined) { fields.push('paused = @paused'); values.paused = params.paused }
  if (params.trade_day_only !== undefined) { fields.push('trade_day_only = @trade_day_only'); values.trade_day_only = params.trade_day_only }
  if (params.symbol !== undefined) { fields.push('symbol = @symbol'); values.symbol = params.symbol }
  if (params.auto_post !== undefined) { fields.push('auto_post = @auto_post'); values.auto_post = params.auto_post }

  if (fields.length > 0) {
    runStmt(`UPDATE recurrings SET ${fields.join(', ')}, updated_at = datetime('now','localtime') WHERE id = @id`, values)
  }
  const rows = queryAllRecurring('SELECT * FROM recurrings WHERE id = @id', { id })
  if (!rows.length) throw new Error(`周期支出规则不存在 (id=${id})`)
  return rows[0]
}

/** 删除周期支出规则（只删规则；已生成的账单带 recurring_id 悬空引用，不受影响） */
export function deleteRecurring(id: number): void {
  runStmt('DELETE FROM recurrings WHERE id = @id', { id })
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
  /** v2.0：由周期支出规则生成的账单关联其规则 id；普通单笔账单为 null */
  recurring_id?: number | null
  payment_platform?: string | null
  fund_account?: string | null
}

export interface AddBillParams {
  amount: number
  category1: string
  category2: string
  date: string
  note?: string
  type?: 'expense' | 'income'
  recurring_id?: number | null
  payment_platform?: string | null
  fund_account?: string | null
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
function runStmt(sql: string, params?: Record<string, string | number | null>): number {
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
  if (params.recurring_id !== undefined && params.recurring_id !== null) {
    const recurring = db.exec('SELECT type FROM recurrings WHERE id = ?', [params.recurring_id])
    if (recurring[0]?.values[0]?.[0] === 'dca') {
      throw new Error('旧定投规则已停用，不能再生成账单。')
    }
  }
  const id = runStmt(`
    INSERT INTO bills (amount, category1, category2, date, note, type, recurring_id, payment_platform, fund_account)
    VALUES (@amount, @category1, @category2, @date, @note, @type, @recurring_id, @payment_platform, @fund_account)
  `, {
    amount: params.amount,
    category1: params.category1,
    category2: params.category2,
    date: params.date,
    note: params.note || '',
    type: params.type || 'expense',
    recurring_id: params.recurring_id ?? null,
    payment_platform: params.payment_platform ?? null,
    fund_account: params.fund_account ?? null
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
  const values: Record<string, string | number | null> = { id }

  if (params.amount !== undefined) { fields.push('amount = @amount'); values.amount = params.amount }
  if (params.category1 !== undefined) { fields.push('category1 = @category1'); values.category1 = params.category1 }
  if (params.category2 !== undefined) { fields.push('category2 = @category2'); values.category2 = params.category2 }
  if (params.date !== undefined) { fields.push('date = @date'); values.date = params.date }
  if (params.note !== undefined) { fields.push('note = @note'); values.note = params.note }
  if (params.type !== undefined) { fields.push('type = @type'); values.type = params.type }
  if (params.recurring_id !== undefined) { fields.push('recurring_id = @recurring_id'); values.recurring_id = params.recurring_id }
  if (params.payment_platform !== undefined) { fields.push('payment_platform = @payment_platform'); values.payment_platform = params.payment_platform }
  if (params.fund_account !== undefined) { fields.push('fund_account = @fund_account'); values.fund_account = params.fund_account }

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

// ─── Investment snapshots and Agent proposal ledger ───────────────

export interface InvestmentPositionRow extends InvestmentHolding {
  id: number
  cloud_id: string | null
  created_at: string
  updated_at: string
  sync_status: 'pending' | 'synced' | 'failed' | 'local'
  sync_error: string | null
}

export interface AgentOperationRow {
  operation_id: string
  payload_hash: string
  operation_type: string
  applied_at: string
}

export interface AgentExpenseRow {
  amount: number
  category1: string
  category2: string
  date: string
  note: string
}

export interface InvestmentOutboxRow {
  asset_key: string
  operation: 'upsert' | 'delete'
  status: 'pending' | 'synced' | 'failed'
  error: string | null
  revision: number
  updated_at: string
}

export interface CloudInvestmentSnapshot extends InvestmentSnapshot {
  userId: string
  _id?: string
}

function assertAgentOperation(operationId: string, payloadHash: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(operationId) || !/^[0-9a-f]{64}$/.test(payloadHash)) {
    throw new Error('agent_operation_reference_invalid')
  }
}

function readAgentOperation(operationId: string): AgentOperationRow | null {
  const result = db.exec('SELECT * FROM agent_operations WHERE operation_id = ?', [operationId])
  if (!result.length || !result[0].values.length) return null
  const obj: Record<string, unknown> = {}
  result[0].columns.forEach((column, index) => { obj[column] = result[0].values[0][index] })
  return rowTo<AgentOperationRow>(obj)
}

function assertOperationCanApply(operationId: string, payloadHash: string): boolean {
  const existing = readAgentOperation(operationId)
  if (!existing) return false
  if (existing.payload_hash !== payloadHash) throw new Error('agent_operation_hash_conflict')
  return true
}

function writeAgentOperation(operationId: string, payloadHash: string, operationType: string): void {
  db.run(
    'INSERT INTO agent_operations (operation_id, payload_hash, operation_type) VALUES (?, ?, ?)',
    [operationId, payloadHash, operationType]
  )
}

export function getAgentOperation(operationId: string): AgentOperationRow | null {
  return readAgentOperation(operationId)
}

export function getInvestmentPositions(): InvestmentPositionRow[] {
  const result = db.exec(`
    SELECT p.*, o.status AS sync_status, o.error AS sync_error,
      s.cash_flows_complete AS cash_flows_complete
    FROM investment_positions p
    LEFT JOIN investment_sync_outbox o ON o.asset_key = p.asset_key
    LEFT JOIN investment_snapshots s ON s.asset_key = p.asset_key AND s.as_of = p.as_of
    ORDER BY p.asset_key ASC
  `)
  if (!result.length || !result[0].columns.length) return []
  return result[0].values.map((values) => {
    const obj: Record<string, unknown> = {}
    result[0].columns.forEach((column, index) => { obj[column] = values[index] })
    if (obj.sync_status == null) obj.sync_status = 'local'
    if (obj.sync_error == null) obj.sync_error = null
    obj.quantity_kind = obj.quantity_kind ?? 'unknown'
    obj.cost_basis_kind = obj.cost_basis_kind ?? 'unknown'
    obj.cash_flows_complete = Boolean(obj.cash_flows_complete)
    obj.cash_flows = getSnapshotCashFlows(String(obj.asset_key), String(obj.as_of))
    return rowTo<InvestmentPositionRow>(obj)
  })
}

export function getInvestmentSnapshotHistory(assetKey?: string): InvestmentSnapshot[] {
  const result = assetKey
    ? db.exec('SELECT * FROM investment_snapshots WHERE asset_key = ? ORDER BY as_of ASC', [assetKey])
    : db.exec('SELECT * FROM investment_snapshots ORDER BY asset_key ASC, as_of ASC')
  if (!result.length || !result[0].columns.length) return []
  return result[0].values.map((values) => {
    const row: Record<string, unknown> = {}
    result[0].columns.forEach((column, index) => { row[column] = values[index] })
    row.quantity_kind = row.quantity_kind ?? 'unknown'
    row.cost_basis_kind = row.cost_basis_kind ?? 'unknown'
    row.cash_flows_complete = Boolean(row.cash_flows_complete)
    row.cash_flows = getSnapshotCashFlows(String(row.asset_key), String(row.as_of))
    return rowTo<InvestmentSnapshot>(row)
  })
}

function getSnapshotCashFlows(assetKey: string, snapshotDate: string): InvestmentCashFlow[] {
  const result = db.exec(`
    SELECT flow_id, date, kind, amount, currency, included_in_market_value
    FROM investment_cash_flows
    WHERE asset_key = ? AND snapshot_date = ?
    ORDER BY date ASC, flow_id ASC
  `, [assetKey, snapshotDate])
  if (!result.length || !result[0].values.length) return []
  return result[0].values.map((values) => ({
    flow_id: String(values[0]),
    date: String(values[1]),
    kind: String(values[2]) as InvestmentCashFlow['kind'],
    amount: String(values[3]),
    currency: String(values[4]),
    included_in_market_value: Boolean(values[5])
  }))
}

export function applyAgentExpenses(operationId: string, payloadHash: string, rows: AgentExpenseRow[]): BillRow[] {
  assertAgentOperation(operationId, payloadHash)
  if (assertOperationCanApply(operationId, payloadHash)) return []

  db.run('BEGIN TRANSACTION')
  try {
    if (assertOperationCanApply(operationId, payloadHash)) {
      db.run('COMMIT')
      return []
    }
    const inserted: BillRow[] = []
    const statement = db.prepare(`
      INSERT INTO bills (amount, category1, category2, date, note, type, recurring_id)
      VALUES (?, ?, ?, ?, ?, 'expense', NULL)
    `)
    try {
      for (const row of rows) {
        statement.run([row.amount, row.category1, row.category2, row.date, row.note])
        const id = Number(db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0])
        const bill = queryOne('SELECT * FROM bills WHERE id = @id', { id })
        if (!bill) throw new Error('agent_expense_insert_readback_failed')
        inserted.push(bill)
      }
    } finally {
      statement.free()
    }
    writeAgentOperation(operationId, payloadHash, 'expenses')
    db.run('COMMIT')
    saveDb()
    return inserted
  } catch (error) {
    try { db.run('ROLLBACK') } catch { /* transaction may already have committed */ }
    throw error
  }
}

export function applyAgentInvestments(operationId: string, payloadHash: string, rows: InvestmentHolding[]): number {
  assertAgentOperation(operationId, payloadHash)
  if (assertOperationCanApply(operationId, payloadHash)) return 0

  db.run('BEGIN TRANSACTION')
  try {
    if (assertOperationCanApply(operationId, payloadHash)) {
      db.run('COMMIT')
      return 0
    }
    let changed = 0
    const current = new Map(getInvestmentPositions().map((position) => [position.asset_key, position]))
    for (const position of rows) {
      const before = current.get(position.asset_key)
      const same = before && before.name === position.name && before.asset_type === position.asset_type &&
        before.quantity === position.quantity && before.cost_basis === position.cost_basis &&
        before.market_value === position.market_value && before.currency === position.currency &&
        before.as_of === position.as_of && before.source_note === position.source_note &&
        before.quantity_kind === position.quantity_kind && before.cost_basis_kind === position.cost_basis_kind
      const snapshotChanged = persistConfirmedInvestmentSnapshot(operationId, position)
      if (same && !snapshotChanged) continue
      const olderThanCurrent = Boolean(before && before.as_of > position.as_of)
      if (!same && !olderThanCurrent) {
        db.run(`
          INSERT INTO investment_positions
            (asset_key, name, asset_type, quantity, quantity_kind, cost_basis, cost_basis_kind, market_value, currency, as_of, source_note, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ON CONFLICT(asset_key) DO UPDATE SET
            name = excluded.name,
            asset_type = excluded.asset_type,
            quantity = excluded.quantity,
            quantity_kind = excluded.quantity_kind,
            cost_basis = excluded.cost_basis,
            cost_basis_kind = excluded.cost_basis_kind,
            market_value = excluded.market_value,
            currency = excluded.currency,
            as_of = excluded.as_of,
            source_note = excluded.source_note,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        `, [position.asset_key, position.name, position.asset_type, position.quantity, position.quantity_kind,
          position.cost_basis, position.cost_basis_kind, position.market_value, position.currency, position.as_of, position.source_note])
      }
      db.run(`
        INSERT INTO investment_sync_outbox (asset_key, operation, status, error, updated_at)
        VALUES (?, 'upsert', 'pending', NULL, datetime('now', 'localtime'))
        ON CONFLICT(asset_key) DO UPDATE SET
          operation = 'upsert', status = 'pending', error = NULL,
          revision = investment_sync_outbox.revision + 1, updated_at = datetime('now', 'localtime')
      `, [position.asset_key])
      changed++
    }
    writeAgentOperation(operationId, payloadHash, 'investments')
    db.run('COMMIT')
    saveDb()
    return changed
  } catch (error) {
    try { db.run('ROLLBACK') } catch { /* transaction may already have committed */ }
    throw error
  }
}

function persistConfirmedInvestmentSnapshot(
  operationId: string,
  holding: InvestmentHolding,
  recordedAt = new Date().toISOString()
): boolean {
  const existingSnapshotResult = db.exec(`
    SELECT name, asset_type, quantity, quantity_kind, cost_basis, cost_basis_kind, market_value,
      currency, source_note, cash_flows_complete
    FROM investment_snapshots WHERE asset_key = ? AND as_of = ?
  `, [holding.asset_key, holding.as_of])
  const existingValues = existingSnapshotResult[0]?.values[0]
  const existingFlows = getSnapshotCashFlows(holding.asset_key, holding.as_of)
  const sameSnapshot = existingValues &&
    String(existingValues[0]) === holding.name && String(existingValues[1]) === holding.asset_type &&
    String(existingValues[2]) === holding.quantity && String(existingValues[3] ?? 'unknown') === holding.quantity_kind &&
    (existingValues[4] === null ? null : String(existingValues[4])) === holding.cost_basis &&
    String(existingValues[5] ?? 'unknown') === holding.cost_basis_kind &&
    (existingValues[6] === null ? null : String(existingValues[6])) === holding.market_value &&
    String(existingValues[7]) === holding.currency && String(existingValues[8]) === holding.source_note &&
    Boolean(existingValues[9]) === holding.cash_flows_complete &&
    JSON.stringify(existingFlows) === JSON.stringify(holding.cash_flows)
  if (sameSnapshot) return false

  db.run(`
    INSERT INTO investment_snapshots
      (asset_key, name, asset_type, quantity, quantity_kind, cost_basis, cost_basis_kind, market_value,
       currency, as_of, source_note, cash_flows_complete, operation_id, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(asset_key, as_of) DO UPDATE SET
      name = excluded.name, asset_type = excluded.asset_type, quantity = excluded.quantity,
      quantity_kind = excluded.quantity_kind, cost_basis = excluded.cost_basis,
      cost_basis_kind = excluded.cost_basis_kind, market_value = excluded.market_value,
      currency = excluded.currency, source_note = excluded.source_note,
      cash_flows_complete = excluded.cash_flows_complete,
      operation_id = excluded.operation_id, recorded_at = excluded.recorded_at
  `, [holding.asset_key, holding.name, holding.asset_type, holding.quantity, holding.quantity_kind,
    holding.cost_basis, holding.cost_basis_kind, holding.market_value, holding.currency, holding.as_of,
    holding.source_note, holding.cash_flows_complete ? 1 : 0, operationId, recordedAt])

  const oldFlows = db.exec('SELECT flow_id FROM investment_cash_flows WHERE asset_key = ? AND snapshot_date = ?', [holding.asset_key, holding.as_of])
  const incomingIds = new Set(holding.cash_flows.map((flow) => flow.flow_id))
  for (const [flowId] of oldFlows[0]?.values || []) {
    if (!incomingIds.has(String(flowId))) {
      db.run('DELETE FROM investment_cash_flows WHERE asset_key = ? AND flow_id = ?', [holding.asset_key, flowId])
    }
  }

  for (const flow of holding.cash_flows) {
    const previous = db.exec('SELECT snapshot_date, date, kind, amount, currency, included_in_market_value FROM investment_cash_flows WHERE asset_key = ? AND flow_id = ?', [holding.asset_key, flow.flow_id])[0]?.values[0]
    if (previous && String(previous[0]) !== holding.as_of) {
      throw new Error('agent_cash_flow_repeated_across_intervals')
    }
    db.run(`
      INSERT INTO investment_cash_flows
        (asset_key, flow_id, snapshot_date, date, kind, amount, currency, included_in_market_value, source_note, operation_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(asset_key, flow_id) DO UPDATE SET
        snapshot_date = excluded.snapshot_date, date = excluded.date, kind = excluded.kind,
        amount = excluded.amount, currency = excluded.currency,
        included_in_market_value = excluded.included_in_market_value,
        source_note = excluded.source_note, operation_id = excluded.operation_id
    `, [holding.asset_key, flow.flow_id, holding.as_of, flow.date, flow.kind, flow.amount, flow.currency,
      flow.included_in_market_value ? 1 : 0, holding.source_note, operationId])
  }
  return true
}

export function getInvestmentSyncOutbox(): InvestmentOutboxRow[] {
  const result = db.exec(`
    SELECT asset_key, operation, status, error, revision, updated_at
    FROM investment_sync_outbox
    WHERE status IN ('pending', 'failed')
    ORDER BY updated_at ASC
  `)
  if (!result.length || !result[0].columns.length) return []
  return result[0].values.map((values) => {
    const row: Record<string, unknown> = {}
    result[0].columns.forEach((column, index) => { row[column] = values[index] })
    return rowTo<InvestmentOutboxRow>(row)
  })
}

export function getInvestmentSyncState(): { pending: number; failed: number } {
  const result = db.exec(`
    SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM investment_sync_outbox
  `)
  const row = result[0]?.values[0] || [0, 0]
  return { pending: Number(row[0] || 0), failed: Number(row[1] || 0) }
}

export function completeInvestmentSync(
  expectedUserId: string,
  assetKey: string,
  expectedRevision: number,
  status: 'synced' | 'failed',
  error: string | null = null,
  cloudId?: string
): boolean {
  if (!expectedUserId || currentUserId !== expectedUserId) return false
  db.run(`
    UPDATE investment_sync_outbox
    SET status = ?, error = ?, updated_at = datetime('now', 'localtime')
    WHERE asset_key = ? AND revision = ? AND status IN ('pending', 'failed')
  `, [status, error, assetKey, expectedRevision])
  if (db.getRowsModified() === 0) return false
  if (cloudId) db.run('UPDATE investment_positions SET cloud_id = ? WHERE asset_key = ?', [cloudId, assetKey])
  saveDb()
  return true
}

export interface CloudInvestmentPosition extends InvestmentHolding {
  userId: string
  created_at: string
  updated_at: string
  _id?: string
}

export function insertCloudInvestmentPositions(rows: CloudInvestmentPosition[]): void {
  db.run('BEGIN TRANSACTION')
  try {
    for (const row of rows) {
      const pending = db.exec('SELECT operation, status FROM investment_sync_outbox WHERE asset_key = ?', [row.asset_key])[0]?.values[0]
      const existing = db.exec('SELECT updated_at, as_of FROM investment_positions WHERE asset_key = ?', [row.asset_key])[0]?.values[0]
      const localUpdatedAt = String(existing?.[0] ?? '')
      const localAsOf = String(existing?.[1] ?? '')
      const hasPendingWrite = pending?.[1] === 'pending' || pending?.[1] === 'failed'
      // A newer confirmed cloud snapshot may advance an older local current row
      // while retaining the pending outbox. The next push will send that newer
      // current row together with local history instead of overwriting cloud.
      const advancePendingCurrent = hasPendingWrite && pending?.[0] === 'upsert' && row.as_of > localAsOf
      if (hasPendingWrite && !advancePendingCurrent) continue
      if (localUpdatedAt && localUpdatedAt >= row.updated_at && !advancePendingCurrent) continue
      db.run(`
        INSERT INTO investment_positions
          (asset_key, name, asset_type, quantity, quantity_kind, cost_basis, cost_basis_kind, market_value, currency, as_of, source_note, cloud_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(asset_key) DO UPDATE SET
          name = excluded.name, asset_type = excluded.asset_type, quantity = excluded.quantity,
          quantity_kind = excluded.quantity_kind, cost_basis_kind = excluded.cost_basis_kind,
          cost_basis = excluded.cost_basis, market_value = excluded.market_value, currency = excluded.currency,
          as_of = excluded.as_of, source_note = excluded.source_note, cloud_id = excluded.cloud_id,
          updated_at = excluded.updated_at
      `, [row.asset_key, row.name, row.asset_type, row.quantity, row.quantity_kind, row.cost_basis,
        row.cost_basis_kind, row.market_value, row.currency, row.as_of, row.source_note, row._id ?? null,
        row.created_at, row.updated_at])
      if (!advancePendingCurrent) {
        db.run(`
          INSERT INTO investment_sync_outbox (asset_key, operation, status, error, updated_at)
          VALUES (?, 'upsert', 'synced', NULL, datetime('now', 'localtime'))
          ON CONFLICT(asset_key) DO UPDATE SET status = 'synced', error = NULL,
            revision = investment_sync_outbox.revision + 1, updated_at = datetime('now', 'localtime')
        `, [row.asset_key])
      }
      const snapshotExists = db.exec('SELECT 1 FROM investment_snapshots WHERE asset_key = ? AND as_of = ?', [row.asset_key, row.as_of])
      if (!snapshotExists[0]?.values.length) {
        persistConfirmedInvestmentSnapshot('cloud-sync', row, row.updated_at)
      }
    }
    db.run('COMMIT')
    saveDb()
  } catch (error) {
    try { db.run('ROLLBACK') } catch { /* transaction may already have committed */ }
    throw error
  }
}

/** Merge historical user-session snapshots without creating a new local write proposal. */
export function insertCloudInvestmentSnapshots(rows: CloudInvestmentSnapshot[]): void {
  db.run('BEGIN TRANSACTION')
  try {
    for (const row of rows) {
      const pending = db.exec('SELECT operation, status FROM investment_sync_outbox WHERE asset_key = ?', [row.asset_key])[0]?.values[0]
      const hasPendingWrite = pending?.[1] === 'pending' || pending?.[1] === 'failed'
      if (hasPendingWrite && pending?.[0] === 'delete') continue
      const existing = db.exec('SELECT recorded_at FROM investment_snapshots WHERE asset_key = ? AND as_of = ?', [row.asset_key, row.as_of])
      const localRecordedAt = String(existing[0]?.values[0]?.[0] ?? '')
      // Never replace the same dated local snapshot while it has an unsynced
      // proposal, but do merge other cloud dates so history can catch up.
      if (hasPendingWrite && localRecordedAt) continue
      if (localRecordedAt && localRecordedAt >= row.recorded_at) continue
      persistConfirmedInvestmentSnapshot(row.operation_id, row, row.recorded_at)
    }
    db.run('COMMIT')
    saveDb()
  } catch (error) {
    try { db.run('ROLLBACK') } catch { /* transaction may already have committed */ }
    throw error
  }
}

/** 清除用户业务数据（预设分类保留）；保留 Agent 幂等账本，并排入云端持仓删除任务。 */
export function clearAllData(): void {
  db.run('BEGIN TRANSACTION')
  try {
    const positions = db.exec('SELECT asset_key FROM investment_positions')
    for (const [assetKey] of (positions[0]?.values || [])) {
      db.run(`
        INSERT INTO investment_sync_outbox (asset_key, operation, status, error, updated_at)
        VALUES (?, 'delete', 'pending', NULL, datetime('now', 'localtime'))
        ON CONFLICT(asset_key) DO UPDATE SET
          operation = 'delete', status = 'pending', error = NULL,
          revision = investment_sync_outbox.revision + 1, updated_at = datetime('now', 'localtime')
      `, [assetKey])
    }
    db.run('DELETE FROM bills')
    db.run('DELETE FROM categories WHERE is_preset = 0')
    db.run('DELETE FROM recurrings')
    db.run('DELETE FROM investment_positions')
    db.run('DELETE FROM investment_snapshots')
    db.run('DELETE FROM investment_cash_flows')
    db.run('COMMIT')
    saveDb()
  } catch (error) {
    try { db.run('ROLLBACK') } catch { /* transaction may already have committed */ }
    throw error
  }
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

// ─── Recurring Cloud Sync Helpers（v2.0 周期支出） ──

export interface CloudRecurringRow {
  localId: number
  userId: string
  name: string
  amount: number
  type: string
  cycle_unit: string
  cycle_interval: number
  next_date: string
  category1: string
  category2?: string | null
  payment_platform?: string | null
  fund_account?: string | null
  note?: string | null
  paused?: number
  trade_day_only?: number
  /** v2.0.4：标的代码（定投选填） */
  symbol?: string | null
  /** v2.0.5：到期自动入账 */
  auto_post?: number
  created_at: string
  updated_at: string
  _id?: string
}

/**
 * 将云端拉取的周期支出规则合并写入本地数据库。
 * 合并策略与 insertCloudBills 一致：以 cloud_id 建立稳定映射、幂等、按 updated_at 只应用较新记录。
 */
export function insertCloudRecurrings(rows: CloudRecurringRow[]): void {
  for (const r of rows) {
    if (!r._id) continue
    const existing = db.exec('SELECT id, updated_at FROM recurrings WHERE cloud_id = ?', [r._id])
    if (existing.length && existing[0].values.length) {
      const localUpdated = String(existing[0].values[0][1] || '')
      if ((r.updated_at || '') > localUpdated) {
        db.run(
          'UPDATE recurrings SET name=?, amount=?, type=?, cycle_unit=?, cycle_interval=?, next_date=?, category1=?, category2=?, payment_platform=?, fund_account=?, note=?, paused=?, trade_day_only=?, symbol=?, auto_post=?, created_at=?, updated_at=? WHERE cloud_id=?',
          [r.name, r.amount, r.type || 'subscription', r.cycle_unit || 'month', r.cycle_interval ?? 1, r.next_date, r.category1 || '', r.category2 ?? null, r.payment_platform ?? null, r.fund_account ?? null, r.note ?? null, r.paused ?? 0, r.trade_day_only ?? 0, r.symbol ?? null, r.auto_post ?? 0, r.created_at || '', r.updated_at || '', r._id]
        )
      }
    } else {
      db.run(
        'INSERT OR IGNORE INTO recurrings (cloud_id, name, amount, type, cycle_unit, cycle_interval, next_date, category1, category2, payment_platform, fund_account, note, paused, trade_day_only, symbol, auto_post, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [r._id, r.name, r.amount, r.type || 'subscription', r.cycle_unit || 'month', r.cycle_interval ?? 1, r.next_date, r.category1 || '', r.category2 ?? null, r.payment_platform ?? null, r.fund_account ?? null, r.note ?? null, r.paused ?? 0, r.trade_day_only ?? 0, r.symbol ?? null, r.auto_post ?? 0, r.created_at || '', r.updated_at || '']
      )
    }
  }
  saveDb()
}

/** 将云端文档 ID 回写到本地周期支出规则，后续更新/删除使用稳定映射。 */
export function setRecurringCloudId(localId: number, cloudId: string): void {
  db.run('UPDATE recurrings SET cloud_id = ? WHERE id = ?', [cloudId, localId])
  saveDb()
}

// ─── Re-export from export module ─────────────────

export { escapeCSV, exportCSV, exportAllJSON, importAllJSON }
