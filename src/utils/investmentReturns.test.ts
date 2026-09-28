import { describe, expect, it } from 'vitest'
import type { InvestmentHolding } from './investmentHoldings'
import { calculateInvestmentReturns, type InvestmentSnapshot } from './investmentReturns'

function snapshot(overrides: Partial<InvestmentSnapshot> = {}): InvestmentSnapshot {
  const holding: InvestmentHolding = {
    asset_key: 'SYNTH:A',
    name: 'Synthetic A',
    asset_type: 'fund',
    quantity: '1',
    quantity_kind: 'units',
    cost_basis: '100',
    cost_basis_kind: 'total',
    market_value: '100',
    currency: 'CNY',
    as_of: '2026-09-27',
    source_note: 'synthetic statement',
    cash_flows: [],
    cash_flows_complete: true
  }
  return { ...holding, operation_id: 'synthetic-operation', recorded_at: `${holding.as_of}T12:00:00.000Z`, ...overrides }
}

describe('calculateInvestmentReturns', () => {
  it('adjusts principal flows regardless of inclusion flag and avoids double counting included dividends and fees', () => {
    const base = snapshot()
    const current = snapshot({
      as_of: '2026-09-28',
      recorded_at: '2026-09-28T12:00:00.000Z',
      market_value: '165',
      cash_flows: [
        { flow_id: 'contribution-1', date: '2026-09-28', kind: 'contribution', amount: '50', currency: 'CNY', included_in_market_value: true },
        { flow_id: 'withdrawal-1', date: '2026-09-28', kind: 'withdrawal', amount: '5', currency: 'CNY', included_in_market_value: true },
        { flow_id: 'dividend-1', date: '2026-09-28', kind: 'dividend', amount: '10', currency: 'CNY', included_in_market_value: true },
        { flow_id: 'fee-1', date: '2026-09-28', kind: 'fee', amount: '5', currency: 'CNY', included_in_market_value: true }
      ]
    })
    const report = calculateInvestmentReturns([base, current], [current.asset_key])

    expect(report.assets[0].daily).toMatchObject({ status: 'computed', amount: '20', rate_percent: '20', base_date: base.as_of, as_of: current.as_of })
    expect(report.assets[0].cumulative).toMatchObject({ status: 'computed', amount: '20', rate_percent: '13.79310345', snapshot_dates: [base.as_of, current.as_of] })
  })

  it('adds excluded dividends and deducts excluded fees while principal remains adjusted', () => {
    const base = snapshot()
    const current = snapshot({
      as_of: '2026-09-28', market_value: '160', recorded_at: '2026-09-28T12:00:00.000Z',
      cash_flows: [
        { flow_id: 'contribution-1', date: '2026-09-28', kind: 'contribution', amount: '50', currency: 'CNY', included_in_market_value: false },
        { flow_id: 'withdrawal-1', date: '2026-09-28', kind: 'withdrawal', amount: '5', currency: 'CNY', included_in_market_value: false },
        { flow_id: 'dividend-1', date: '2026-09-28', kind: 'dividend', amount: '10', currency: 'CNY', included_in_market_value: false },
        { flow_id: 'fee-1', date: '2026-09-28', kind: 'fee', amount: '5', currency: 'CNY', included_in_market_value: false }
      ]
    })
    const report = calculateInvestmentReturns([base, current], [current.asset_key])

    expect(report.assets[0].daily).toMatchObject({ status: 'computed', amount: '20' })
    expect(report.assets[0].cumulative).toMatchObject({ status: 'computed', amount: '20' })
  })

  it('marks return uncomputable when interval flow coverage is unknown', () => {
    const report = calculateInvestmentReturns([
      snapshot(),
      snapshot({ as_of: '2026-09-28', market_value: '120', cash_flows_complete: false, recorded_at: '2026-09-28T12:00:00.000Z' })
    ])

    expect(report.assets[0].daily).toMatchObject({ status: 'uncomputable', amount: null, reasons: ['cash_flow_coverage_unknown'] })
    expect(report.assets[0].cumulative).toMatchObject({ status: 'uncomputable', amount: null, reasons: ['cash_flow_coverage_unknown'] })
  })

  it('does not call a multi-day interval daily return', () => {
    const friday = snapshot({ as_of: '2026-09-25', recorded_at: '2026-09-25T12:00:00.000Z' })
    const monday = snapshot({ as_of: '2026-09-28', market_value: '110', recorded_at: '2026-09-28T12:00:00.000Z' })
    const report = calculateInvestmentReturns([friday, monday])

    expect(report.assets[0].daily).toMatchObject({ status: 'uncomputable', base_date: friday.as_of, as_of: monday.as_of, reasons: ['nonconsecutive_snapshot_dates'] })
  })

  it('uses a common baseline for the visible portfolio holdings and ignores historical assets outside that set', () => {
    const histories = [
      snapshot({ asset_key: 'SYNTH:A', name: 'A', market_value: '100', as_of: '2026-09-27' }),
      snapshot({ asset_key: 'SYNTH:A', name: 'A', market_value: '120', as_of: '2026-09-28', recorded_at: '2026-09-28T12:00:00.000Z', cash_flows: [
        { flow_id: 'a-in', date: '2026-09-28', kind: 'contribution', amount: '10', currency: 'CNY', included_in_market_value: true }
      ] }),
      snapshot({ asset_key: 'SYNTH:B', name: 'B', market_value: '200', as_of: '2026-09-27' }),
      snapshot({ asset_key: 'SYNTH:B', name: 'B', market_value: '230', as_of: '2026-09-28', recorded_at: '2026-09-28T12:00:00.000Z', cash_flows: [
        { flow_id: 'b-out', date: '2026-09-28', kind: 'withdrawal', amount: '5', currency: 'CNY', included_in_market_value: true }
      ] }),
      snapshot({ asset_key: 'SYNTH:OLD', name: 'Old', market_value: '900', as_of: '2026-09-27' }),
      snapshot({ asset_key: 'SYNTH:OLD', name: 'Old', market_value: '1000', as_of: '2026-09-28', recorded_at: '2026-09-28T12:00:00.000Z' })
    ]
    const report = calculateInvestmentReturns(histories, ['SYNTH:A', 'SYNTH:B'])

    expect(report.portfolios).toHaveLength(1)
    expect(report.portfolios[0].daily).toMatchObject({ status: 'computed', amount: '45' })
    expect(report.portfolios[0].cumulative).toMatchObject({
      status: 'computed', amount: '45', base_date: '2026-09-27', as_of: '2026-09-28',
      snapshot_dates: ['2026-09-27', '2026-09-28']
    })
  })

  it('marks portfolio metrics uncomputable when current holding snapshots do not share a date', () => {
    const report = calculateInvestmentReturns([
      snapshot({ asset_key: 'SYNTH:A', as_of: '2026-09-27' }),
      snapshot({ asset_key: 'SYNTH:B', as_of: '2026-09-27' }),
      snapshot({ asset_key: 'SYNTH:A', as_of: '2026-09-28', recorded_at: '2026-09-28T12:00:00.000Z' }),
      snapshot({ asset_key: 'SYNTH:B', as_of: '2026-09-29', recorded_at: '2026-09-29T12:00:00.000Z' })
    ], ['SYNTH:A', 'SYNTH:B'])

    expect(report.portfolios[0].floating).toMatchObject({ status: 'uncomputable', amount: null, as_of: null, reasons: ['as_of_mismatch'] })
    expect(report.portfolios[0].daily).toMatchObject({ status: 'uncomputable', reasons: ['as_of_mismatch'] })
    expect(report.portfolios[0].cumulative).toMatchObject({ status: 'uncomputable', reasons: ['as_of_mismatch'] })
  })
})
