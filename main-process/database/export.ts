import type { BillRow, BillFilters } from './index'
import { getDb, saveDb, getBills } from './index'

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

/** 将全部账单和分类数据导出为 JSON 字符串，用于备份功能 */
export function exportAllJSON(): string {
  const db = getDb()
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
  const db = getDb()
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
