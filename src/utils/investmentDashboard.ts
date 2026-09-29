import type { InvestmentPositionView } from '../types/agentSync'
import type { InvestmentSnapshot } from './investmentReturns'

export interface InvestmentAllocation {
  name: string
  value: number
  percentage: number
  count: number
}

export interface InvestmentTrendPoint {
  date: string
  marketValue: number
}

/** Empty, invalid, and negative valuation values are unknown; zero is valid. */
export function parseMarketValue(value: string | null): number | null {
  if (value === null || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/** Only values with a known currency and market value contribute to the chart. */
export function buildInvestmentAllocation(
  positions: InvestmentPositionView[],
  currency: string
): InvestmentAllocation[] {
  const totals = new Map<string, { value: number; count: number }>()
  for (const position of positions) {
    if (position.currency !== currency) continue
    const value = parseMarketValue(position.market_value)
    if (value === null || value <= 0) continue
    const name = position.asset_type.trim() || position.name
    const row = totals.get(name) ?? { value: 0, count: 0 }
    row.value += value
    row.count += 1
    totals.set(name, row)
  }
  const total = [...totals.values()].reduce((sum, row) => sum + row.value, 0)
  if (!Number.isFinite(total) || total <= 0) return []
  return [...totals.entries()]
    .map(([name, row]) => ({ name, value: row.value, percentage: row.value / total * 100, count: row.count }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
}

/**
 * Builds a strict common-date trend. A date is omitted if any currently held
 * asset lacks a valuation on that date; incomplete totals are never graphed.
 */
export function buildInvestmentTrend(
  snapshots: InvestmentSnapshot[],
  currentAssetKeys: string[],
  currency: string
): InvestmentTrendPoint[] {
  if (currentAssetKeys.length === 0) return []
  const keys = [...new Set(currentAssetKeys)]
  const byKey = new Map<string, InvestmentSnapshot[]>()
  for (const snapshot of snapshots) {
    if (!keys.includes(snapshot.asset_key) || snapshot.currency !== currency) continue
    const rows = byKey.get(snapshot.asset_key) ?? []
    rows.push(snapshot)
    byKey.set(snapshot.asset_key, rows)
  }
  const dateSets = keys.map((key) => new Set((byKey.get(key) ?? []).map((row) => row.as_of)))
  const commonDates = [...(dateSets[0] ?? [])]
    .filter((date) => dateSets.every((dates) => dates.has(date)))
    .sort((a, b) => a.localeCompare(b))

  return commonDates.flatMap((date) => {
    const rows = keys.map((key) => (byKey.get(key) ?? []).find((row) => row.as_of === date))
    if (rows.some((row) => !row || parseMarketValue(row.market_value) === null)) return []
    const marketValue = rows.reduce((sum, row) => sum + parseMarketValue(row!.market_value)!, 0)
    return Number.isFinite(marketValue) ? [{ date, marketValue }] : []
  })
}

export function positionTotalCost(position: InvestmentPositionView): number | null {
  if (position.cost_basis === null) return null
  const basis = Number(position.cost_basis)
  if (!Number.isFinite(basis)) return null
  if (position.cost_basis_kind === 'total') return basis
  if (position.cost_basis_kind !== 'per_unit' || !['shares', 'units'].includes(position.quantity_kind)) return null
  const quantity = Number(position.quantity)
  return Number.isFinite(quantity) ? basis * quantity : null
}

/** Prevents showing returns from an older snapshot as if they describe today's rows. */
export function hasCurrentSnapshotForEveryPosition(
  positions: InvestmentPositionView[],
  snapshots: InvestmentSnapshot[],
  currency: string
): boolean {
  const current = positions.filter((position) => position.currency === currency)
  if (current.length === 0) return false
  return current.every((position) => snapshots.some((snapshot) =>
    snapshot.asset_key === position.asset_key &&
    snapshot.as_of === position.as_of &&
    snapshot.currency === position.currency &&
    snapshot.quantity === position.quantity &&
    snapshot.quantity_kind === position.quantity_kind &&
    snapshot.cost_basis === position.cost_basis &&
    snapshot.cost_basis_kind === position.cost_basis_kind &&
    snapshot.market_value === position.market_value &&
    snapshot.cash_flows_complete === position.cash_flows_complete &&
    JSON.stringify([...snapshot.cash_flows].sort((a, b) => a.flow_id.localeCompare(b.flow_id))) ===
      JSON.stringify([...position.cash_flows].sort((a, b) => a.flow_id.localeCompare(b.flow_id)))
  ))
}
