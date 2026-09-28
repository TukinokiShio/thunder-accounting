import { describe, expect, it } from 'vitest'
import type { InvestmentPositionView } from '@/types/agentSync'
import type { InvestmentSnapshot } from './investmentReturns'
import { buildInvestmentAllocation, buildInvestmentTrend, hasCurrentSnapshotForEveryPosition, positionTotalCost } from './investmentDashboard'

function position(overrides: Partial<InvestmentPositionView> = {}): InvestmentPositionView {
  return {
    id: 1, cloud_id: null, created_at: '2026-09-28', updated_at: '2026-09-28',
    sync_status: 'synced', sync_error: null,
    asset_key: 'fund-a', name: 'Fund A', asset_type: '基金', quantity: '10',
    cost_basis: '100', cost_basis_kind: 'total', quantity_kind: 'shares',
    market_value: '120', currency: 'CNY', as_of: '2026-09-28', source_note: 'confirmed',
    cash_flows: [], cash_flows_complete: true,
    ...overrides
  }
}

function snapshot(overrides: Partial<InvestmentSnapshot> = {}): InvestmentSnapshot {
  return {
    asset_key: 'fund-a', name: 'Fund A', asset_type: '基金', quantity: '10',
    cost_basis: '100', cost_basis_kind: 'total', quantity_kind: 'shares',
    market_value: '120', currency: 'CNY', as_of: '2026-09-28', source_note: 'confirmed',
    cash_flows: [], cash_flows_complete: true, operation_id: 'op-1', recorded_at: '2026-09-28T08:00:00Z',
    ...overrides
  }
}

describe('investment dashboard data', () => {
  it('keeps currencies separate and omits missing or invalid market values from allocation', () => {
    const rows = buildInvestmentAllocation([
      position(),
      position({ asset_key: 'fund-b', asset_type: '基金', market_value: '80' }),
      position({ asset_key: 'cash-usd', currency: 'USD', asset_type: '现金', market_value: '500' }),
      position({ asset_key: 'unknown', market_value: null }),
      position({ asset_key: 'bad', market_value: 'NaN' })
    ], 'CNY')

    expect(rows).toEqual([{ name: '基金', value: 200, percentage: 100, count: 2 }])
  })

  it('plots only dates with complete values across current holdings', () => {
    const rows = buildInvestmentTrend([
      snapshot({ as_of: '2026-09-27', market_value: '100' }),
      snapshot({ asset_key: 'fund-b', as_of: '2026-09-27', market_value: '50' }),
      snapshot({ as_of: '2026-09-28', market_value: '120' }),
      snapshot({ asset_key: 'fund-b', as_of: '2026-09-28', market_value: null }),
      snapshot({ as_of: '2026-09-29', currency: 'USD', market_value: '130' }),
      snapshot({ asset_key: 'fund-b', as_of: '2026-09-29', currency: 'USD', market_value: '70' })
    ], ['fund-a', 'fund-b'], 'CNY')

    expect(rows).toEqual([{ date: '2026-09-27', marketValue: 150 }])
  })

  it('derives total cost only when its quantity and cost semantics are known', () => {
    expect(positionTotalCost(position({ cost_basis: '12', cost_basis_kind: 'per_unit', quantity: '3' }))).toBe(36)
    expect(positionTotalCost(position({ cost_basis_kind: 'unknown' }))).toBeNull()
    expect(positionTotalCost(position({ cost_basis_kind: 'per_unit', quantity_kind: 'currency_amount' }))).toBeNull()
  })

  it('requires the latest confirmed history row to match current values before presenting returns', () => {
    const current = position()
    expect(hasCurrentSnapshotForEveryPosition([current], [snapshot()], 'CNY')).toBe(true)
    expect(hasCurrentSnapshotForEveryPosition([current], [snapshot({ market_value: '110' })], 'CNY')).toBe(false)
    expect(hasCurrentSnapshotForEveryPosition([current], [], 'CNY')).toBe(false)
  })
})
