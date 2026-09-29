// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { AgentSyncService, type AgentOperationRecord } from './agent-sync'
import type { AgentExpenseItem, AgentProposalProvenance } from '../src/types/agentSync'
import type { InvestmentHolding } from '../src/utils/investmentHoldings'
import type { InvestmentSnapshot } from '../src/utils/investmentReturns'

const fixtureHolding: InvestmentHolding = {
  asset_key: 'BROKER-A:US:ACME',
  name: 'Acme Synthetic',
  asset_type: 'stock',
  quantity: '2.5',
  cost_basis: '100.00',
  market_value: null,
  currency: 'USD',
  as_of: '2026-09-28',
  source_note: 'isolated fixture',
  quantity_kind: 'shares',
  cost_basis_kind: 'total',
  cash_flows: [],
  cash_flows_complete: true
}

function createFixture() {
  let sessionUserId: string | null = 'fixture-a'
  let databaseUserId: string | null = 'fixture-a'
  const operations = new Map<string, AgentOperationRecord>()
  const bills: AgentExpenseItem[] = []
  const cloudSyncedBills: number[] = []
  const holdings: InvestmentHolding[] = []
  const snapshotHistory: InvestmentSnapshot[] = []
  let children = ['午餐']
  const service = new AgentSyncService(fs.mkdtempSync(path.join(os.tmpdir(), 'thunder-agent-sync-')), {
    getSessionUserId: () => sessionUserId,
    getDatabaseUserId: () => databaseUserId,
    getExpenseCategories: () => [{ name: '餐饮食品', children: JSON.stringify(children), type: 'expense' }],
    getBills: () => bills,
    getInvestments: () => holdings,
    getInvestmentSnapshotHistory: () => snapshotHistory,
    getOperation: (operationId) => operations.get(operationId) || null,
    applyExpenses: (operationId, payloadHash, rows) => {
      operations.set(operationId, { payload_hash: payloadHash, operation_type: 'expenses' })
      bills.push(...rows)
      return rows.map((row, index) => ({
        ...row, id: bills.length - rows.length + index + 1, type: 'expense',
        created_at: '2026-09-28T00:00:00.000Z', updated_at: '2026-09-28T00:00:00.000Z'
      }))
    },
    onExpensesApplied: (rows) => cloudSyncedBills.push(...rows.map((row) => row.id)),
    applyInvestments: (operationId, payloadHash, rows) => {
      operations.set(operationId, { payload_hash: payloadHash, operation_type: 'investments' })
      for (const row of rows) {
        const index = holdings.findIndex((existing) => existing.asset_key === row.asset_key)
        if (index >= 0) holdings[index] = row
        else holdings.push(row)
      }
      return rows.length
    }
  })

  return {
    service,
    bills,
    cloudSyncedBills,
    holdings,
    snapshotHistory,
    operations,
    setCategories(next: string[]) { children = next },
    setSession(userId: string) { sessionUserId = userId; databaseUserId = userId }
  }
}

async function writeProposal(
  service: AgentSyncService,
  kind: 'expenses' | 'investments',
  items: unknown[],
  operationId: string = randomUUID(),
  createdAt: string = new Date().toISOString(),
  provenance?: AgentProposalProvenance
): Promise<string> {
  const info = await service.getContextInfo()
  const context = JSON.parse(await fs.promises.readFile(info.contextPath, 'utf8')) as { scope_token: string }
  await fs.promises.writeFile(path.join(info.inboxPath, `${operationId}.json`), JSON.stringify({
    schema_version: 'thunder-agent-proposal/v1',
    operation_id: operationId,
    scope_token: context.scope_token,
    created_at: createdAt,
    kind,
    items,
    ...(provenance || {})
  }))
  return operationId
}

describe('Agent proposal inbox', () => {
  it('imports a portable proposal file into the logged-in account inbox without applying it', async () => {
    const fixture = createFixture()
    await fixture.service.activate('fixture-a')
    const contextInfo = await fixture.service.getContextInfo()
    const context = JSON.parse(await fs.promises.readFile(contextInfo.contextPath, 'utf8')) as { scope_token: string }
    const operationId = randomUUID()
    const sourcePath = path.join(os.tmpdir(), `thunder-proposal-${randomUUID()}.json`)
    await fs.promises.writeFile(sourcePath, JSON.stringify({
      schema_version: 'thunder-agent-proposal/v1', operation_id: operationId,
      scope_token: context.scope_token, created_at: new Date().toISOString(), kind: 'expenses',
      items: [{ amount: 18.5, category1: '餐饮食品', category2: '午餐', date: '2026-09-28', note: 'portable import fixture' }]
    }))

    try {
      const importedName = await fixture.service.importProposalFile(sourcePath)
      const proposals = await fixture.service.listProposals()
      expect(importedName).toBe(`${operationId}.json`)
      expect(proposals).toHaveLength(1)
      expect(proposals[0]).toMatchObject({ kind: 'expenses', operationId, expenses: [{ amount: 18.5 }] })
      expect(fixture.bills).toHaveLength(0)
      expect(fixture.holdings).toHaveLength(0)
    } finally {
      await fs.promises.unlink(sourcePath).catch(() => undefined)
    }
  })

  it('validates, previews, and retains bounded Skill provenance in the local receipt', async () => {
    const fixture = createFixture()
    await fixture.service.activate('fixture-a')
    const operationId = await writeProposal(fixture.service, 'expenses', [{
      amount: 12,
      category1: '餐饮食品',
      category2: '午餐',
      date: '2026-09-28',
      note: 'synthetic source'
    }], randomUUID(), new Date().toISOString(), {
      skill_name: 'thunder-expense-entry',
      skill_version: '1.2.3',
      source_summary: 'Bank statement, 2026-09-28, 1 row'
    })
    const [preview] = await fixture.service.listProposals()
    expect(preview.provenance).toEqual({
      skill_name: 'thunder-expense-entry', skill_version: '1.2.3', source_summary: 'Bank statement, 2026-09-28, 1 row'
    })
    await fixture.service.applyProposal(operationId, preview.payloadHash!, preview.baselineHash!)
    const info = await fixture.service.getContextInfo()
    const processed = path.join(path.dirname(info.inboxPath), 'processed')
    const [receiptFile] = await fs.promises.readdir(processed)
    const receipt = JSON.parse(await fs.promises.readFile(path.join(processed, receiptFile), 'utf8'))
    expect(receipt.provenance).toEqual(preview.provenance)
    expect(JSON.stringify(receipt)).not.toContain('synthetic source')
  })

  it('rejects provenance that mismatches proposal kind or contains sensitive paths', async () => {
    const fixture = createFixture()
    await fixture.service.activate('fixture-a')
    await writeProposal(fixture.service, 'expenses', [{
      amount: 12, category1: '餐饮食品', category2: '午餐', date: '2026-09-28', note: ''
    }], randomUUID(), new Date().toISOString(), {
      skill_name: 'thunder-investment-snapshot', skill_version: '1.0.0', source_summary: 'Bank statement, one row'
    })
    await writeProposal(fixture.service, 'expenses', [{
      amount: 13, category1: '餐饮食品', category2: '午餐', date: '2026-09-28', note: ''
    }], randomUUID(), new Date().toISOString(), {
      skill_name: 'thunder-expense-entry', skill_version: '1.0.0', source_summary: 'Source at C:\\Users\\SyntheticUser\\statement.pdf'
    })
    const previews = await fixture.service.listProposals()
    expect(previews).toHaveLength(2)
    expect(previews.every((preview) => preview.kind === 'invalid')).toBe(true)
    expect(previews.every((preview) => preview.provenance === null)).toBe(true)
  })

  it('exposes only app-held confirmed snapshot history and scrubs it when the session is invalidated', async () => {
    const fixture = createFixture()
    await fixture.service.activate('fixture-a')
    fixture.snapshotHistory.push({
      ...fixtureHolding,
      market_value: '110.25',
      operation_id: 'synthetic-operation',
      recorded_at: '2026-09-28T12:00:00.000Z',
      id: 42
    } as InvestmentSnapshot & { id: number })
    const contextInfo = await fixture.service.getContextInfo()
    const context = JSON.parse(await fs.promises.readFile(contextInfo.contextPath, 'utf8'))
    const expectedSnapshot = structuredClone(fixture.snapshotHistory[0]) as InvestmentSnapshot & { id?: number }
    delete expectedSnapshot.id
    expect(context.investment_snapshot_history).toEqual([expectedSnapshot])
    expect(Object.hasOwn(context.investment_snapshot_history[0], 'id')).toBe(false)
    expect(JSON.stringify(context)).not.toContain('fixture-a')

    await fixture.service.invalidate()
    const scrubbed = JSON.parse(await fs.promises.readFile(contextInfo.contextPath, 'utf8'))
    expect(scrubbed.investment_snapshot_history).toEqual([])
  })

  it('exposes no account identifier and writes only after an explicit apply call', async () => {
    const fixture = createFixture()
    await fixture.service.activate('fixture-a')
    const contextInfo = await fixture.service.getContextInfo()
    const contextText = await fs.promises.readFile(contextInfo.contextPath, 'utf8')
    expect(contextInfo.available).toBe(true)
    expect(contextText).not.toContain('fixture-a')
    expect(contextText).not.toContain('userId')

    const createdAt = new Date().toISOString()
    const operationId = await writeProposal(fixture.service, 'expenses', [{
      amount: 32.5,
      category1: '餐饮食品',
      category2: '午餐',
      date: '2026-09-28',
      note: 'synthetic meal'
    }], randomUUID(), createdAt)
    const [preview] = await fixture.service.listProposals()
    expect(preview.operationId).toBe(operationId)
    expect(preview.expenses).toHaveLength(1)
    expect(fixture.bills).toHaveLength(0)
    expect(fixture.cloudSyncedBills).toHaveLength(0)

    const result = await fixture.service.applyProposal(operationId, preview.payloadHash!, preview.baselineHash!)
    expect(result).toEqual({ duplicate: false, bills: 1, investments: 0 })
    expect(fixture.bills).toEqual([expect.objectContaining({ category1: '餐饮食品', category2: '午餐' })])
    expect(fixture.cloudSyncedBills).toEqual([1])
    expect(await fixture.service.listProposals()).toEqual([])

    // Replaying the identical file is reconciled from the durable operation ledger.
    await writeProposal(fixture.service, 'expenses', [{
      amount: 32.5,
      category1: '餐饮食品',
      category2: '午餐',
      date: '2026-09-28',
      note: 'synthetic meal'
    }], operationId, createdAt)
    expect(await fixture.service.listProposals()).toEqual([])
    expect(fixture.bills).toHaveLength(1)
    expect(fixture.cloudSyncedBills).toEqual([1])
  })

  it('previews stable investment keys and keeps positions omitted from the incoming batch', async () => {
    const fixture = createFixture()
    await fixture.service.activate('fixture-a')
    fixture.holdings.push({ ...fixtureHolding, asset_key: 'BROKER-A:US:KEEP' })
    const operationId = await writeProposal(fixture.service, 'investments', [fixtureHolding])
    const [preview] = await fixture.service.listProposals()

    expect(preview.operationId).toBe(operationId)
    expect(preview.investmentDiff?.added.map((item) => item.asset_key)).toEqual([fixtureHolding.asset_key])
    expect(preview.investmentDiff?.unmentioned.map((item) => item.asset_key)).toEqual(['BROKER-A:US:KEEP'])
    expect(fixture.holdings).toHaveLength(1)

    const result = await fixture.service.applyProposal(operationId, preview.payloadHash!, preview.baselineHash!)
    expect(result.investments).toBe(1)
    expect(fixture.holdings.map((item) => item.asset_key).sort()).toEqual(['BROKER-A:US:ACME', 'BROKER-A:US:KEEP'])
  })

  it('rejects expense rows without a valid second-level category or with sub-cent precision', async () => {
    const fixture = createFixture()
    await fixture.service.activate('fixture-a')
    await writeProposal(fixture.service, 'expenses', [{
      amount: 15,
      category1: '餐饮食品',
      category2: '',
      date: '2026-09-28',
      note: 'missing subcategory fixture'
    }])
    await writeProposal(fixture.service, 'expenses', [{
      amount: 15.555,
      category1: '餐饮食品',
      category2: '午餐',
      date: '2026-09-28',
      note: 'fractional cent fixture'
    }])

    const proposals = await fixture.service.listProposals()
    expect(proposals).toHaveLength(2)
    expect(proposals.every((proposal) => proposal.kind === 'invalid')).toBe(true)
    expect(fixture.bills).toHaveLength(0)
    expect(fixture.cloudSyncedBills).toHaveLength(0)
  })

  it('requires a fresh preview after categories change and rejects proposals from a previous account scope', async () => {
    const fixture = createFixture()
    await fixture.service.activate('fixture-a')
    const operationId = await writeProposal(fixture.service, 'expenses', [{
      amount: 15,
      category1: '餐饮食品',
      category2: '午餐',
      date: '2026-09-28',
      note: 'scope fixture'
    }])
    const [preview] = await fixture.service.listProposals()
    fixture.setCategories(['早餐'])
    await expect(fixture.service.applyProposal(operationId, preview.payloadHash!, preview.baselineHash!))
      .rejects.toThrow(/分类|baseline/i)
    expect(fixture.bills).toHaveLength(0)

    fixture.setSession('fixture-b')
    await fixture.service.activate('fixture-b')
    expect(await fixture.service.listProposals()).toEqual([])
    fixture.setSession('fixture-a')
    await fixture.service.activate('fixture-a')
    const [stale] = await fixture.service.listProposals()
    expect(stale.kind).toBe('invalid')
    expect(stale.errors[0]).toMatch(/scope|账号/)
    expect(fixture.bills).toHaveLength(0)
  })

  it('stores only minimal rejected receipts and scrubs the account context on logout', async () => {
    const fixture = createFixture()
    await fixture.service.activate('fixture-a')
    const contextInfo = await fixture.service.getContextInfo()
    const operationId = await writeProposal(fixture.service, 'expenses', [{
      amount: 15,
      category1: '餐饮食品',
      category2: '午餐',
      date: '2026-09-28',
      note: 'private synthetic note'
    }])
    await fixture.service.rejectProposal(`${operationId}.json`)
    const rejectedDir = path.join(path.dirname(contextInfo.inboxPath), 'rejected')
    const [receiptName] = await fs.promises.readdir(rejectedDir)
    const receiptText = await fs.promises.readFile(path.join(rejectedDir, receiptName), 'utf8')
    expect(receiptText).not.toContain('private synthetic note')
    expect(receiptText).not.toContain('餐饮食品')
    expect(JSON.parse(receiptText)).toMatchObject({ schema_version: 'thunder-agent-receipt/v1', state: 'rejected' })

    await fixture.service.invalidate()
    const scrubbed = JSON.parse(await fs.promises.readFile(contextInfo.contextPath, 'utf8'))
    expect(scrubbed.scope_token).toBe('')
    expect(scrubbed.investment_holdings).toEqual([])
    expect(scrubbed.expense_categories).toEqual([])
  })

  it('refuses an operation id replay with different content', async () => {
    const fixture = createFixture()
    await fixture.service.activate('fixture-a')
    const operationId = await writeProposal(fixture.service, 'expenses', [{
      amount: 12,
      category1: '餐饮食品',
      category2: '午餐',
      date: '2026-09-28',
      note: 'first content'
    }])
    const [first] = await fixture.service.listProposals()
    await fixture.service.applyProposal(operationId, first.payloadHash!, first.baselineHash!)

    await writeProposal(fixture.service, 'expenses', [{
      amount: 13,
      category1: '餐饮食品',
      category2: '午餐',
      date: '2026-09-28',
      note: 'changed content'
    }], operationId)
    const [conflict] = await fixture.service.listProposals()
    expect(conflict.kind).toBe('invalid')
    expect(conflict.errors[0]).toMatch(/冲突/)
    expect(fixture.bills).toHaveLength(1)
  })
})
