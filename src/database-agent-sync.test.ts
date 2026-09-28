// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thunder-agent-db-'))

vi.mock('electron', () => ({ app: { getPath: (_name: string) => tmpDir } }))

import {
  addBill,
  addRecurring,
  exportAllJSON,
  getAgentOperation,
  getDb,
  getInvestmentPositions,
  getInvestmentSyncOutbox,
  getInvestmentSyncState,
  importAllJSON,
  initDatabase,
  saveDb,
  switchToUserDatabase,
  updateRecurring,
  applyAgentExpenses,
  applyAgentInvestments,
  completeInvestmentSync,
  type AgentExpenseRow
} from '../main-process/database/index'
import { createDesktopStoragePort } from '../main-process/database/desktop-storage'
import { setStoragePort } from '../main-process/database/storage'
import type { InvestmentHolding } from './utils/investmentHoldings'

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
  source_note: 'synthetic fixture'
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
    expect(getInvestmentSyncOutbox()).toEqual([
      expect.objectContaining({ asset_key: holding.asset_key, operation: 'upsert', status: 'pending' })
    ])
    expect(getInvestmentSyncState()).toEqual({ pending: 1, failed: 0 })
    expect(getAgentOperation(operationId)).toMatchObject({ payload_hash: payloadHash, operation_type: 'investments' })
    expect(applyAgentInvestments(operationId, payloadHash, [holding])).toBe(0)

    const firstAttempt = getInvestmentSyncOutbox()[0]
    const updateId = randomUUID()
    const updateHash = createHash('sha256').update('newer snapshot').digest('hex')
    applyAgentInvestments(updateId, updateHash, [{ ...holding, as_of: '2026-09-29', market_value: '120.25' }])
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

  it('preserves holdings and the operation ledger for old backups, and replaces them for v3 backups', () => {
    const operationId = getDb().exec("SELECT operation_id FROM agent_operations WHERE operation_type = 'investments'")[0].values[0][0] as string
    importAllJSON(JSON.stringify({ version: 2, bills: [], categories: [], recurrings: [] }))
    expect(getInvestmentPositions().map((row) => row.asset_key)).toEqual([holding.asset_key])
    expect(getAgentOperation(operationId)).not.toBeNull()

    const v3 = JSON.parse(exportAllJSON()) as Record<string, unknown>
    v3.investment_positions = [{ ...holding, asset_key: 'BROKER-A:US:REPLACEMENT', name: 'Replacement Synthetic' }]
    const result = importAllJSON(JSON.stringify(v3))
    expect(result.investments).toBe(1)
    expect(getInvestmentPositions().map((row) => row.asset_key)).toEqual(['BROKER-A:US:REPLACEMENT'])
    expect(getAgentOperation(operationId)).not.toBeNull()
    expect(getInvestmentSyncOutbox().map((row) => row.operation)).toContain('delete')
    expect(getInvestmentSyncOutbox().map((row) => row.operation)).toContain('upsert')
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
