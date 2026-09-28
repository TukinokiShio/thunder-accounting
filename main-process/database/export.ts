import type { BillRow, BillFilters } from './index'
import { getDb, saveDb, getBills } from './index'
import { validateInvestmentBatch } from '../../src/utils/investmentHoldings'

// ─── CSV Helpers ───────────────────────────────────

/**
 * 标准 CSV 字段转义：含逗号、双引号或换行的字段用双引号包裹，内部双引号加倍。
 * 同时抵御 Excel CSV 注入（以 = + - @ 开头的单元格加单引号前缀）。
 */
export function escapeCSV(val: string | number): string {
  const s = String(val)
  // 防御 CSV 注入：以公式字符开头的单元格加单引号前缀
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
    return `"${safe.replace(/"/g, '""')}"`
  }
  return safe
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
  return '\uFEFF' + header + rows
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

/** 将账单、分类、周期支出、投资快照和最小幂等账本导出为 JSON。 */
export function exportAllJSON(): string {
  const db = getDb()
  const bills = db.exec('SELECT * FROM bills ORDER BY id ASC')
  const categories = db.exec('SELECT * FROM categories ORDER BY id ASC')
  const recurrings = db.exec('SELECT * FROM recurrings ORDER BY id ASC')
  const investments = db.exec(`
    SELECT asset_key, name, asset_type, quantity, cost_basis, market_value, currency, as_of, source_note, created_at, updated_at
    FROM investment_positions ORDER BY asset_key ASC
  `)
  const agentOperations = db.exec('SELECT operation_id, payload_hash, operation_type, applied_at FROM agent_operations ORDER BY applied_at ASC')

  const billsJson = bills.length ? rowsToObjects(bills[0]) : []
  const catsJson = categories.length ? rowsToObjects(categories[0]) : []
  const recurringsJson = recurrings.length ? rowsToObjects(recurrings[0]) : []
  const investmentsJson = investments.length ? rowsToObjects(investments[0]) : []
  const agentOperationsJson = agentOperations.length ? rowsToObjects(agentOperations[0]) : []

  return JSON.stringify({
    version: 3,
    exported_at: new Date().toISOString(),
    bills: billsJson,
    categories: catsJson,
    recurrings: recurringsJson,
    investment_positions: investmentsJson,
    agent_operations: agentOperationsJson
  }, null, 2)
}

/**
 * 从 JSON 字符串导入账单和分类数据。
 * 先校验数据格式，再用事务包裹批量写入；中途失败自动回滚，保证数据一致性。
 * 预设分类（is_preset=1）在导入时跳过，由 initPresetCategories 统一管理。
 */
export function importAllJSON(json: string): { bills: number; categories: number; recurrings: number; investments: number } {
  const db = getDb()
  let data: {
    bills?: unknown[]
    categories?: unknown[]
    recurrings?: unknown[]
    investment_positions?: unknown[]
    agent_operations?: unknown[]
    version?: number
  }
  try {
    data = JSON.parse(json)
  } catch (e) {
    console.error('备份文件 JSON 解析失败：', e)
    throw new Error('JSON 格式无效')
  }

  if (!data.bills || !Array.isArray(data.bills)) {
    throw new Error('备份数据中没有 bills 数组')
  }

  const hasInvestmentSnapshot = Object.prototype.hasOwnProperty.call(data, 'investment_positions')
  if (hasInvestmentSnapshot && !Array.isArray(data.investment_positions)) {
    throw new Error('备份文件 investment_positions 必须是数组')
  }
  const investmentPayload = hasInvestmentSnapshot
    ? data.investment_positions!.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value
      const record = value as Record<string, unknown>
      const allowed = new Set(['asset_key', 'name', 'asset_type', 'quantity', 'cost_basis', 'market_value', 'currency', 'as_of', 'source_note', 'created_at', 'updated_at'])
      if (Object.keys(record).some((key) => !allowed.has(key))) return record
      return {
        asset_key: record.asset_key, name: record.name, asset_type: record.asset_type,
        quantity: record.quantity, cost_basis: record.cost_basis, market_value: record.market_value,
        currency: record.currency, as_of: record.as_of, source_note: record.source_note
      }
    })
    : null
  const investmentResult = investmentPayload ? validateInvestmentBatch(investmentPayload) : null
  if (investmentResult && !investmentResult.valid) {
    throw new Error(`投资持仓数据格式无效：${investmentResult.errors[0]?.message || 'unknown'}`)
  }

  const hasAgentOperations = Object.prototype.hasOwnProperty.call(data, 'agent_operations')
  if (hasAgentOperations && !Array.isArray(data.agent_operations)) {
    throw new Error('备份文件 agent_operations 必须是数组')
  }
  const operations = hasAgentOperations ? data.agent_operations as Array<Record<string, unknown>> : null
  if (operations) {
    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i]
      if (typeof operation.operation_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(operation.operation_id) ||
        typeof operation.payload_hash !== 'string' || !/^[0-9a-f]{64}$/.test(operation.payload_hash) ||
        (operation.operation_type !== 'expenses' && operation.operation_type !== 'investments') ||
        typeof operation.applied_at !== 'string') {
        throw new Error(`Agent 幂等账本格式无效，第 ${i + 1} 行`)
      }
    }
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
    // 清空现有数据（周期支出规则一并清空，随后从备份恢复）
    db.run('DELETE FROM bills')
    // 仅删除自定义分类，保留预设分类
    db.run('DELETE FROM categories WHERE is_preset = 0')
    db.run('DELETE FROM recurrings')

    // Version 1/2 backups have no investment fields: retain current holdings,
    // their pending outbox, and the idempotency ledger. Version 3 replaces them.
    let investmentCount = 0
    if (investmentResult?.valid) {
      const current = db.exec('SELECT asset_key FROM investment_positions')
      for (const [assetKey] of (current[0]?.values || [])) {
        db.run(`
          INSERT INTO investment_sync_outbox (asset_key, operation, status, error, updated_at)
          VALUES (?, 'delete', 'pending', NULL, datetime('now', 'localtime'))
          ON CONFLICT(asset_key) DO UPDATE SET
            operation = 'delete', status = 'pending', error = NULL,
            revision = investment_sync_outbox.revision + 1, updated_at = datetime('now', 'localtime')
        `, [assetKey])
      }
      db.run('DELETE FROM investment_positions')
      const investmentStmt = db.prepare(`
        INSERT INTO investment_positions
          (asset_key, name, asset_type, quantity, cost_basis, market_value, currency, as_of, source_note, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const holding of investmentResult.holdings) {
        const backupRow = (data.investment_positions as Array<Record<string, unknown>>).find((value) => value?.asset_key === holding.asset_key)
        investmentStmt.run([
          holding.asset_key, holding.name, holding.asset_type, holding.quantity, holding.cost_basis,
          holding.market_value, holding.currency, holding.as_of, holding.source_note,
          typeof backupRow?.created_at === 'string' ? backupRow.created_at : new Date().toISOString(),
          typeof backupRow?.updated_at === 'string' ? backupRow.updated_at : new Date().toISOString()
        ])
        db.run(`
          INSERT INTO investment_sync_outbox (asset_key, operation, status, error, updated_at)
          VALUES (?, 'upsert', 'pending', NULL, datetime('now', 'localtime'))
          ON CONFLICT(asset_key) DO UPDATE SET
            operation = 'upsert', status = 'pending', error = NULL,
            revision = investment_sync_outbox.revision + 1, updated_at = datetime('now', 'localtime')
        `, [holding.asset_key])
        investmentCount++
      }
      investmentStmt.free()
    }

    if (operations) {
      db.run('DELETE FROM agent_operations')
      const operationStmt = db.prepare(`
        INSERT INTO agent_operations (operation_id, payload_hash, operation_type, applied_at)
        VALUES (?, ?, ?, ?)
      `)
      for (const operation of operations) {
        operationStmt.run([operation.operation_id, operation.payload_hash, operation.operation_type, operation.applied_at])
      }
      operationStmt.free()
    }

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

    // 恢复周期支出规则（v1.x 备份无此数组时跳过，保持向后兼容）
    let recCount = 0
    if (data.recurrings && Array.isArray(data.recurrings)) {
      const recStmt = db.prepare(
        'INSERT INTO recurrings (id, name, amount, type, cycle_unit, cycle_interval, next_date, category1, category2, payment_platform, fund_account, note, paused, trade_day_only, symbol, auto_post, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      for (const r of data.recurrings as Array<Record<string, unknown>>) {
        recStmt.run([
          r.id, r.name, r.amount, r.type ?? 'subscription', r.cycle_unit ?? 'month',
          r.cycle_interval ?? 1, r.next_date ?? '', r.category1 ?? '', r.category2 ?? null,
          r.payment_platform ?? null, r.fund_account ?? null, r.note ?? null,
          r.paused ?? 0, r.trade_day_only ?? 0, r.symbol ?? null, r.auto_post ?? 0, r.created_at ?? new Date().toISOString()
        ])
        recCount++
      }
      recStmt.free()
    }

    db.run('COMMIT')
    saveDb()
    return { bills: billCount, categories: catCount, recurrings: recCount, investments: investmentCount }
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }
}
