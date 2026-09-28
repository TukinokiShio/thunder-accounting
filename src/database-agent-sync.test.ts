// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs from 'sql.js'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thunder-agent-db-'))

vi.mock('electron', () => ({ app: { getPath: (_name: string) => tmpDir } }))

import {
  addBill,
  addRecurring,
  exportAllJSON,
  getAgentOperation,
  getDb,
  getInvestmentPositions,
  getInvestmentSnapshotHistory,
  getInvestmentSyncOutbox,
  getInvestmentSyncState,
  importAllJSON,
  initDatabase,
  saveDb,
  switchToUserDatabase,
  updateRecurring,
  insertCloudInvestmentPositions,
  insertCloudInvestmentSnapshots,
  applyAgentExpenses,
  applyAgentInvestments,
  completeInvestmentSync,
  type AgentExpenseRow
} from '../main-process/database/index'
import { createDesktopStoragePort } from '../main-process/database/desktop-storage'
import { getStoragePort, setStoragePort } from '../main-process/database/storage'
import type { InvestmentHolding } from './utils/investmentHoldings'
import type { CloudInvestmentPosition, CloudInvestmentSnapshot } from '../main-process/database/index'

const expense: AgentExpenseRow = {
  amount: 45.5,
  category1: '餐饮食品',
  category2: '午餐',
  date: '2026-09-28',
  note: 'synthetic-only fixture'
}

const holding: InvestmentHolding = {
  asset_key: 'BROKER-A:US:ACME',
  name: 'Acme Synthetic',
  asset_type: 'stock',
  quantity: '1.250000000000000001',
  cost_basis: '100.25',
  market_value: null,
  currency: 'USD',
  as_of: '2026-09-28',
  source_note: 'synthetic fixture',
  quantity_kind: 'shares',
  cost_basis_kind: 'total',
  cash_flows: [{
    flow_id: 'synthetic-contribution-20260928', date: '2026-09-28', kind: 'contribution',
    amount: '100.25', currency: 'USD', included_in_market_value: true
  }],
  cash_flows_complete: true
}

beforeAll(async () => {
  setStoragePort(createDesktopStoragePort())
  await initDatabase()
  await switchToUserDatabase('agent-fixture-a')
})

describe('isolated Agent data operations', () => {
  it('writes expenses with the exact two-level categories and is idempotent by operation hash', () => {
    const operationId = randomUUID()
    const payloadHash = createHash('sha256').update('synthetic expense operation').digest('hex')

    expect(applyAgentExpenses(operationId, payloadHash, [expense])).toHaveLength(1)
    const row = getDb().exec('SELECT * FROM bills WHERE note = ?', [expense.note])[0].values[0]
    const columns = getDb().exec('PRAGMA table_info(bills)')[0].values.map((value) => String(value[1]))
    const bill = Object.fromEntries(columns.map((column, index) => [column, row[index]]))
    expect(bill).toMatchObject({ amount: 45.5, category1: '餐饮食品', category2: '午餐', type: 'expense' })
    expect(applyAgentExpenses(operationId, payloadHash, [expense])).toHaveLength(0)
    expect(() => applyAgentExpenses(operationId, 'f'.repeat(64), [expense])).toThrow(/hash_conflict/)
    expect(getAgentOperation(operationId)?.payload_hash).toBe(payloadHash)
  })

  it('stores high-precision investment values and commits outbox plus idempotency ledger together', () => {
    const operationId = randomUUID()
    const payloadHash = createHash('sha256').update('synthetic investment operation').digest('hex')

    expect(applyAgentInvestments(operationId, payloadHash, [holding])).toBe(1)
    expect(getInvestmentPositions()).toEqual([
      expect.objectContaining({ ...holding, sync_status: 'pending', sync_error: null })
    ])
    expect(getInvestmentSnapshotHistory()).toEqual([
      expect.objectContaining({ ...holding, operation_id: operationId })
    ])
    expect(getInvestmentSyncOutbox()).toEqual([
      expect.objectContaining({ asset_key: holding.asset_key, operation: 'upsert', status: 'pending' })
    ])
    expect(getInvestmentSyncState()).toEqual({ pending: 1, failed: 0 })
    expect(getAgentOperation(operationId)).toMatchObject({ payload_hash: payloadHash, operation_type: 'investments' })
    expect(applyAgentInvestments(operationId, payloadHash, [holding])).toBe(0)

    const firstAttempt = getInvestmentSyncOutbox()[0]
    const updateId = randomUUID()
    const updateHash = createHash('sha256').update('newer snapshot').digest('hex')
    applyAgentInvestments(updateId, updateHash, [{ ...holding, as_of: '2026-09-29', market_value: '120.25', cash_flows: [] }])
    expect(completeInvestmentSync('agent-fixture-a', holding.asset_key, firstAttempt.revision, 'synced', null, 'stale-cloud-id')).toBe(false)
    const latestAttempt = getInvestmentSyncOutbox()[0]
    expect(latestAttempt.revision).toBeGreaterThan(firstAttempt.revision)
    expect(latestAttempt.status).toBe('pending')

    return switchToUserDatabase('agent-fixture-b').then(async () => {
      expect(completeInvestmentSync('agent-fixture-a', holding.asset_key, latestAttempt.revision, 'synced', null, 'wrong-account-id')).toBe(false)
      expect(getInvestmentSyncOutbox()).toHaveLength(0)
      await switchToUserDatabase('agent-fixture-a')
      expect(completeInvestmentSync('agent-fixture-a', holding.asset_key, latestAttempt.revision, 'synced', null, 'current-cloud-id')).toBe(true)
      expect(getInvestmentSyncState()).toEqual({ pending: 0, failed: 0 })
    })
  })

  it('keeps a historical snapshot from rolling back the current holding row', () => {
    const assetKey = 'BROKER-A:US:HISTORICAL'
    const current = { ...holding, asset_key: assetKey, name: 'Historical Synthetic', as_of: '2026-09-30', market_value: '140', cash_flows: [] }
    const historical = { ...current, as_of: '2026-09-28', market_value: '110', source_note: 'synthetic older statement' }
    const currentOperation = randomUUID()
    const historicalOperation = randomUUID()

    expect(applyAgentInvestments(currentOperation, createHash('sha256').update('synthetic newer snapshot').digest('hex'), [current])).toBe(1)
    expect(applyAgentInvestments(historicalOperation, createHash('sha256').update('synthetic historical snapshot').digest('hex'), [historical])).toBe(1)

    expect(getInvestmentPositions().find((row) => row.asset_key === assetKey)).toMatchObject(current)
    expect(getInvestmentSnapshotHistory(assetKey).map(({ as_of, market_value }) => ({ as_of, market_value }))).toEqual([
      { as_of: historical.as_of, market_value: historical.market_value },
      { as_of: current.as_of, market_value: current.market_value }
    ])
    expect(getInvestmentSyncOutbox().find((row) => row.asset_key === assetKey)).toMatchObject({ operation: 'upsert', status: 'pending' })

    const db = getDb()
    db.run('DELETE FROM investment_cash_flows WHERE asset_key = ?', [assetKey])
    db.run('DELETE FROM investment_snapshots WHERE asset_key = ?', [assetKey])
    db.run('DELETE FROM investment_positions WHERE asset_key = ?', [assetKey])
    db.run('DELETE FROM investment_sync_outbox WHERE asset_key = ?', [assetKey])
    saveDb()
  })

  it('merges a newer cloud current row while preserving its pending outbox and local history', () => {
    const assetKey = 'BROKER-A:US:CLOUD-ADVANCE'
    const local = { ...holding, asset_key: assetKey, name: 'Cloud Advance Synthetic', as_of: '2026-09-28', market_value: '110' }
    const cloud = { ...local, as_of: '2026-09-29', market_value: '120', cash_flows: [] }
    const operationId = randomUUID()
    applyAgentInvestments(operationId, createHash('sha256').update('synthetic pending current').digest('hex'), [local])
    const pendingBefore = getInvestmentSyncOutbox().find((row) => row.asset_key === assetKey)
    expect(pendingBefore?.status).toBe('pending')

    const cloudSnapshot: CloudInvestmentSnapshot = {
      ...cloud, userId: 'agent-fixture-a', operation_id: randomUUID(), recorded_at: '2026-09-29T12:00:00.000Z'
    }
    const cloudPosition: CloudInvestmentPosition = {
      ...cloud, userId: 'agent-fixture-a', created_at: '2026-09-27T12:00:00.000Z',
      updated_at: '2026-09-29T12:00:00.000Z'
    }
    insertCloudInvestmentSnapshots([cloudSnapshot])
    insertCloudInvestmentPositions([cloudPosition])

    expect(getInvestmentPositions().find((row) => row.asset_key === assetKey)).toMatchObject(cloud)
    expect(getInvestmentSnapshotHistory(assetKey).map((row) => row.as_of)).toEqual(['2026-09-28', '2026-09-29'])
    expect(getInvestmentSyncOutbox().find((row) => row.asset_key === assetKey)).toMatchObject({
      status: 'pending', revision: pendingBefore?.revision, operation: 'upsert'
    })

    const db = getDb()
    db.run('DELETE FROM investment_cash_flows WHERE asset_key = ?', [assetKey])
    db.run('DELETE FROM investment_snapshots WHERE asset_key = ?', [assetKey])
    db.run('DELETE FROM investment_positions WHERE asset_key = ?', [assetKey])
    db.run('DELETE FROM investment_sync_outbox WHERE asset_key = ?', [assetKey])
    saveDb()
  })

  it('isolates per-user databases even when device-local position ids collide', async () => {
    const userA = getInvestmentPositions()[0]
    await switchToUserDatabase('agent-fixture-b')
    const other = { ...holding, asset_key: 'BROKER-B:US:OTHER', name: 'Other Synthetic' }
    const opB = randomUUID()
    const hashB = createHash('sha256').update('synthetic account b').digest('hex')
    applyAgentInvestments(opB, hashB, [other])
    const userB = getInvestmentPositions()[0]
    expect(userB.id).toBe(userA.id)
    expect(userB.asset_key).not.toBe(userA.asset_key)
    expect(getInvestmentPositions()).toHaveLength(1)

    await switchToUserDatabase('agent-fixture-a')
    expect(getInvestmentPositions().map((row) => row.asset_key)).toEqual([holding.asset_key])
  })

  it('preserves holdings for old backups and round-trips snapshot history in v4 backups', () => {
    const operationId = getDb().exec("SELECT operation_id FROM agent_operations WHERE operation_type = 'investments'")[0].values[0][0] as string
    importAllJSON(JSON.stringify({ version: 2, bills: [], categories: [], recurrings: [] }))
    expect(getInvestmentPositions().map((row) => row.asset_key)).toEqual([holding.asset_key])
    expect(getAgentOperation(operationId)).not.toBeNull()

    const replacement = { ...holding, asset_key: 'BROKER-A:US:REPLACEMENT', name: 'Replacement Synthetic' }
    const backup = JSON.parse(exportAllJSON()) as Record<string, unknown>
    backup.investment_positions = [{ ...replacement, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }]
    backup.investment_snapshots = [{
      ...replacement,
      operation_id: randomUUID(),
      recorded_at: new Date().toISOString()
    }]
    const result = importAllJSON(JSON.stringify(backup))
    expect(result.investments).toBe(1)
    expect(getInvestmentPositions()).toEqual([expect.objectContaining(replacement)])
    expect(getInvestmentSnapshotHistory()).toEqual([expect.objectContaining(replacement)])
    expect(getAgentOperation(operationId)).not.toBeNull()
    expect(getInvestmentSyncOutbox().map((row) => row.operation)).toContain('delete')
    expect(getInvestmentSyncOutbox().map((row) => row.operation)).toContain('upsert')
  })

  it('migrates a legacy snapshot table with no recorded_at column and retains unknown semantics', async () => {
    const SQL = await initSqlJs()
    const legacyDb = new SQL.Database()
    legacyDb.run(`CREATE TABLE investment_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, asset_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      asset_type TEXT NOT NULL, quantity TEXT NOT NULL, cost_basis TEXT, market_value TEXT,
      currency TEXT NOT NULL, as_of TEXT NOT NULL, source_note TEXT NOT NULL DEFAULT '', cloud_id TEXT,
      created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
    )`)
    legacyDb.run(`CREATE TABLE investment_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, asset_key TEXT NOT NULL, name TEXT NOT NULL,
      asset_type TEXT NOT NULL, quantity TEXT NOT NULL, cost_basis TEXT, market_value TEXT,
      currency TEXT NOT NULL, as_of TEXT NOT NULL, source_note TEXT NOT NULL DEFAULT ''
    )`)
    legacyDb.run(`INSERT INTO investment_snapshots
      (asset_key, name, asset_type, quantity, cost_basis, market_value, currency, as_of, source_note)
      VALUES ('BROKER-LEGACY:ASSET', 'Legacy Synthetic', 'fund', '1', '10', NULL, 'CNY', '2026-09-25', 'legacy fixture')`)
    const storage = getStoragePort()
    const legacyPath = storage.joinPath(storage.getDataDir(), 'thunder-accounting-agent-fixture-legacy.db')
    storage.writeDbFile(legacyPath, legacyDb.export())

    await switchToUserDatabase('agent-fixture-legacy')
    const columns = getDb().exec('PRAGMA table_info(investment_snapshots)')[0].values.map((row) => String(row[1]))
    expect(columns).toContain('recorded_at')
    expect(columns).toContain('cash_flows_complete')
    const [migrated] = getInvestmentSnapshotHistory('BROKER-LEGACY:ASSET')
    expect(migrated).toMatchObject({ quantity_kind: 'unknown', cost_basis_kind: 'unknown', cash_flows: [], cash_flows_complete: false })
    expect(migrated.recorded_at).toMatch(/^\d{4}-\d{2}-\d{2}/)

    await switchToUserDatabase('agent-fixture-a')
  })

  it('blocks new DCA rules and refuses a legacy DCA bill-post path', () => {
    expect(() => addRecurring({
      name: 'new dca should be blocked', amount: 1, type: 'dca', next_date: '2026-09-28', category1: '投资'
    })).toThrow(/已移除定投/)

    const db = getDb()
    db.run(`INSERT INTO recurrings (name, amount, type, next_date, category1, auto_post)
      VALUES ('Legacy DCA fixture', 1, 'dca', '2026-09-28', '投资', 1)`)
    const id = Number(db.exec('SELECT last_insert_rowid()')[0].values[0][0])
    expect(() => updateRecurring(id, { auto_post: 1 })).toThrow(/旧定投规则不可转换或自动入账/)
    expect(() => addBill({
      amount: 1,
      category1: '投资',
      category2: '投资',
      date: '2026-09-28',
      note: 'should not post',
      type: 'expense',
      recurring_id: id
    })).toThrow(/旧定投规则已停用/)
    saveDb()
  })
})
