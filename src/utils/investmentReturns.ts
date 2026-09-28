import type {
  InvestmentCashFlow,
  InvestmentHolding
} from './investmentHoldings'

export interface InvestmentSnapshot extends InvestmentHolding {
  operation_id: string
  recorded_at: string
}

export type InvestmentMetricReason =
  | 'no_snapshots'
  | 'missing_market_value'
  | 'missing_cost_basis'
  | 'unknown_cost_basis_kind'
  | 'unknown_quantity_kind'
  | 'missing_comparable_snapshot'
  | 'nonconsecutive_snapshot_dates'
  | 'as_of_mismatch'
  | 'currency_mismatch'
  | 'cash_flow_coverage_unknown'
  | 'cash_flow_outside_interval'
  | 'cash_flow_currency_mismatch'
  | 'zero_rate_denominator'

export interface InvestmentMetric {
  status: 'computed' | 'uncomputable'
  amount: string | null
  rate_percent: string | null
  currency: string
  as_of: string | null
  base_date: string | null
  reasons: InvestmentMetricReason[]
  source_notes: string[]
  snapshot_dates: string[]
  formula_id: InvestmentFormulaId
}

/** Stable calculation identifiers; the UI owns localized display labels. */
export type InvestmentFormulaId = 'floating_profit' | 'daily_return' | 'cumulative_return'

export interface InvestmentAssetReturn {
  asset_key: string
  name: string
  currency: string
  as_of: string | null
  market_value: string | null
  floating: InvestmentMetric
  daily: InvestmentMetric
  cumulative: InvestmentMetric
}

export interface InvestmentPortfolioReturn {
  currency: string
  as_of: string | null
  floating: InvestmentMetric
  daily: InvestmentMetric
  cumulative: InvestmentMetric
}

export interface InvestmentReturnsReport {
  assets: InvestmentAssetReturn[]
  portfolios: InvestmentPortfolioReturn[]
}

interface Decimal {
  coefficient: bigint
  scale: number
}

const RATE_SCALE = 8

/**
 * Calculate low-frequency returns from confirmed snapshots only.
 * Values remain decimal strings; no market prices are fetched or inferred.
 */
export function calculateInvestmentReturns(
  snapshots: InvestmentSnapshot[],
  currentAssetKeys?: string[]
): InvestmentReturnsReport {
  const byAsset = new Map<string, InvestmentSnapshot[]>()
  for (const snapshot of snapshots) {
    const list = byAsset.get(snapshot.asset_key) || []
    list.push(snapshot)
    byAsset.set(snapshot.asset_key, list)
  }
  for (const [assetKey, list] of byAsset) {
    list.sort((a, b) => a.as_of.localeCompare(b.as_of) || a.recorded_at.localeCompare(b.recorded_at))
    byAsset.set(assetKey, list)
  }

  const selectedKeys = [...new Set(currentAssetKeys ?? [...byAsset.keys()])].sort()
  const latestByAsset = new Map<string, InvestmentSnapshot>()
  for (const assetKey of selectedKeys) {
    const list = byAsset.get(assetKey)
    if (list?.length) latestByAsset.set(assetKey, list[list.length - 1])
  }

  const assets = selectedKeys.map((assetKey) => {
    const latest = latestByAsset.get(assetKey)
    const history = byAsset.get(assetKey) || []
    return {
      asset_key: assetKey,
      name: latest?.name ?? assetKey,
      currency: latest?.currency ?? '',
      as_of: latest?.as_of ?? null,
      market_value: latest?.market_value ?? null,
      floating: latest ? floatingMetric(latest) : uncomputable('', null, null, ['no_snapshots'], [], 'floating_profit'),
      daily: calculateSingleAssetDaily(history),
      cumulative: calculateSingleAssetCumulative(history)
    }
  })

  const portfolios = groupByCurrency(selectedKeys, latestByAsset).map(({ currency, assetKeys }) => ({
    currency,
    as_of: commonLatestDate(assetKeys, latestByAsset),
    floating: calculatePortfolioFloating(assetKeys, latestByAsset, currency),
    daily: calculatePortfolioDaily(assetKeys, latestByAsset, byAsset, currency),
    cumulative: calculatePortfolioCumulative(assetKeys, latestByAsset, byAsset, currency)
  }))

  return { assets, portfolios }
}

function floatingMetric(snapshot: InvestmentSnapshot): InvestmentMetric {
  const amount = totalCost(snapshot)
  const sources = [snapshot.source_note]
  if (snapshot.market_value === null) return uncomputable(snapshot.currency, snapshot.as_of, null, ['missing_market_value'], sources, 'floating_profit')
  if (!amount.value) return uncomputable(snapshot.currency, snapshot.as_of, null, [amount.reason || 'missing_cost_basis'], sources, 'floating_profit')
  return computed(
    subtract(parseDecimal(snapshot.market_value), amount.value), null, snapshot.currency, snapshot.as_of,
    snapshot.as_of, sources, 'floating_profit'
  )
}

function totalCost(snapshot: InvestmentSnapshot): { value: Decimal | null; reason?: InvestmentMetricReason } {
  if (snapshot.cost_basis === null) return { value: null, reason: 'missing_cost_basis' }
  const basis = parseDecimal(snapshot.cost_basis)
  if (snapshot.cost_basis_kind === 'total') return { value: basis }
  if (snapshot.cost_basis_kind === 'unknown') return { value: null, reason: 'unknown_cost_basis_kind' }
  if (snapshot.quantity_kind === 'unknown' || snapshot.quantity_kind === 'currency_amount') {
    return { value: null, reason: 'unknown_quantity_kind' }
  }
  return { value: multiply(basis, parseDecimal(snapshot.quantity)) }
}

function calculateSingleAssetDaily(history: InvestmentSnapshot[]): InvestmentMetric {
  if (history.length < 2) return uncomputable(history[0]?.currency ?? '', history.at(-1)?.as_of ?? null, null,
    history.length ? ['missing_comparable_snapshot'] : ['no_snapshots'], history.map((item) => item.source_note), 'daily_return')
  const current = history[history.length - 1]
  const previous = history[history.length - 2]
  if (!areConsecutiveCalendarDays(previous.as_of, current.as_of)) {
    return uncomputable(current.currency, current.as_of, previous.as_of, ['nonconsecutive_snapshot_dates'],
      [previous.source_note, current.source_note], 'daily_return')
  }
  return calculateInterval([previous], [current], current.as_of)
}

function calculateSingleAssetCumulative(history: InvestmentSnapshot[]): InvestmentMetric {
  if (history.length < 2) return uncomputable(history[0]?.currency ?? '', history.at(-1)?.as_of ?? null, null,
    history.length ? ['missing_comparable_snapshot'] : ['no_snapshots'], history.map((item) => item.source_note), 'cumulative_return')
  const first = history[0]
  const current = history[history.length - 1]
  return calculateCumulativeInterval([first], [current], new Map([[first.asset_key, history]]))
}

function calculatePortfolioFloating(assetKeys: string[], latestByAsset: Map<string, InvestmentSnapshot>, currency: string): InvestmentMetric {
  const current = assetKeys.map((key) => latestByAsset.get(key)).filter(isSnapshot)
  const missingKeys = assetKeys.filter((key) => !latestByAsset.has(key))
  if (missingKeys.length) return uncomputable(currency, null, null, ['no_snapshots'], current.map((row) => row.source_note), 'floating_profit')
  const asOf = commonDate(current.map((row) => row.as_of))
  if (!asOf) return uncomputable(currency, null, null, ['as_of_mismatch'], current.map((row) => row.source_note), 'floating_profit')
  const metrics = current.map(floatingMetric)
  const invalid = metrics.flatMap((metric) => metric.status === 'uncomputable' ? metric.reasons : [])
  if (invalid.length) return uncomputable(currency, asOf, null, unique(invalid), current.map((row) => row.source_note), 'floating_profit')
  return computed(sum(metrics.map((metric) => parseDecimal(metric.amount!))), null, currency,
    asOf, null, current.map((row) => row.source_note), 'floating_profit')
}

function calculatePortfolioDaily(
  assetKeys: string[], latestByAsset: Map<string, InvestmentSnapshot>, byAsset: Map<string, InvestmentSnapshot[]>, currency: string
): InvestmentMetric {
  const current = assetKeys.map((key) => latestByAsset.get(key)).filter(isSnapshot)
  if (current.length !== assetKeys.length) return uncomputable(currency, null, null, ['no_snapshots'], current.map((row) => row.source_note), 'daily_return')
  const latestDate = commonDate(current.map((row) => row.as_of))
  if (!latestDate) return uncomputable(currency, null, null, ['as_of_mismatch'], current.map((row) => row.source_note), 'daily_return')
  const dateGroups = commonSnapshotDates(assetKeys, byAsset)
  const priorDate = dateGroups.filter((date) => date < latestDate).at(-1)
  if (!priorDate) return uncomputable(currency, latestDate, null, ['missing_comparable_snapshot'], current.map((row) => row.source_note), 'daily_return')
  if (!areConsecutiveCalendarDays(priorDate, latestDate)) {
    return uncomputable(currency, latestDate, priorDate, ['nonconsecutive_snapshot_dates'],
      [...current, ...assetKeys.map((key) => byAsset.get(key)?.find((row) => row.as_of === priorDate)).filter(isSnapshot)].map((row) => row.source_note),
      'daily_return')
  }
  const previous = assetKeys.map((key) => byAsset.get(key)?.find((row) => row.as_of === priorDate)).filter(isSnapshot)
  const currentAtDate = assetKeys.map((key) => byAsset.get(key)?.find((row) => row.as_of === latestDate)).filter(isSnapshot)
  return calculateInterval(previous, currentAtDate, latestDate)
}

function calculatePortfolioCumulative(
  assetKeys: string[], latestByAsset: Map<string, InvestmentSnapshot>, byAsset: Map<string, InvestmentSnapshot[]>, currency: string
): InvestmentMetric {
  const latest = assetKeys.map((key) => latestByAsset.get(key)).filter(isSnapshot)
  if (latest.length !== assetKeys.length) return uncomputable(currency, null, null, ['no_snapshots'], latest.map((row) => row.source_note), 'cumulative_return')
  const latestDate = commonDate(latest.map((row) => row.as_of))
  if (!latestDate) return uncomputable(currency, null, null, ['as_of_mismatch'], latest.map((row) => row.source_note), 'cumulative_return')
  const baselineDate = commonSnapshotDates(assetKeys, byAsset).filter((date) => date < latestDate).at(0)
  if (!baselineDate) return uncomputable(currency, latestDate, null, ['missing_comparable_snapshot'], latest.map((row) => row.source_note), 'cumulative_return')
  const baseline = assetKeys.map((key) => byAsset.get(key)?.find((row) => row.as_of === baselineDate)).filter(isSnapshot)
  return calculateCumulativeInterval(baseline, latest, byAsset)
}

function calculateInterval(previous: InvestmentSnapshot[], current: InvestmentSnapshot[], asOf: string): InvestmentMetric {
  const sources = [...previous, ...current].map((row) => row.source_note)
  const currency = current[0]?.currency || previous[0]?.currency || ''
  if (!previous.length || previous.length !== current.length) return uncomputable(currency, asOf, null, ['missing_comparable_snapshot'], sources, 'daily_return')
  if (new Set([...previous, ...current].map((row) => row.currency)).size !== 1) return uncomputable(currency, asOf, null, ['currency_mismatch'], sources, 'daily_return')
  const previousTotal = sumDecimals(previous.map((row) => row.market_value))
  const currentTotal = sumDecimals(current.map((row) => row.market_value))
  if (!previousTotal || !currentTotal) return uncomputable(currency, asOf, null, ['missing_market_value'], sources, 'daily_return')
  const previousDate = commonDate(previous.map((row) => row.as_of))
  const currentDate = commonDate(current.map((row) => row.as_of))
  if (!previousDate || !currentDate || previousDate >= currentDate) return uncomputable(currency, asOf, null, ['as_of_mismatch'], sources, 'daily_return')
  const cash = intervalAdjustment(current, previousDate, currentDate)
  if (cash.reasons.length) return uncomputable(currency, currentDate, previousDate, cash.reasons, sources, 'daily_return')
  const pnl = add(subtract(currentTotal, previousTotal), cash.adjustment)
  const rate = previousTotal.coefficient === 0n ? null : ratePercent(pnl, previousTotal)
  const reasons = rate === null ? ['zero_rate_denominator' as const] : []
  return computed(pnl, rate, currency, currentDate, previousDate, sources, 'daily_return', reasons)
}

function calculateCumulativeInterval(
  baseline: InvestmentSnapshot[], latest: InvestmentSnapshot[], byAsset: Map<string, InvestmentSnapshot[]>
): InvestmentMetric {
  const currency = latest[0]?.currency || baseline[0]?.currency || ''
  const sources = [...baseline, ...latest].map((row) => row.source_note)
  if (!baseline.length || baseline.length !== latest.length) return uncomputable(currency, commonDate(latest.map((row) => row.as_of)), null, ['missing_comparable_snapshot'], sources, 'cumulative_return')
  if (new Set([...baseline, ...latest].map((row) => row.currency)).size !== 1) return uncomputable(currency, commonDate(latest.map((row) => row.as_of)), null, ['currency_mismatch'], sources, 'cumulative_return')
  const baseDate = commonDate(baseline.map((row) => row.as_of))
  const asOf = commonDate(latest.map((row) => row.as_of))
  if (!baseDate || !asOf || baseDate >= asOf) return uncomputable(currency, asOf, baseDate, ['missing_comparable_snapshot'], sources, 'cumulative_return')
  const baseValue = sumDecimals(baseline.map((row) => row.market_value))
  const currentValue = sumDecimals(latest.map((row) => row.market_value))
  if (!baseValue || !currentValue) return uncomputable(currency, asOf, baseDate, ['missing_market_value'], sources, 'cumulative_return')

  const adjustmentParts: Decimal[] = []
  const capitalParts: Decimal[] = [baseValue]
  const reasons: InvestmentMetricReason[] = []
  const snapshotDates = new Set<string>([baseDate, asOf])
  for (const baseRow of baseline) {
    const history = byAsset.get(baseRow.asset_key) || []
    const rowsInRange = history.filter((row) => row.as_of > baseDate && row.as_of <= asOf)
    for (const row of rowsInRange) {
      snapshotDates.add(row.as_of)
      const priorDate = priorDateFor(row, history)
      if (priorDate >= baseDate) snapshotDates.add(priorDate)
      sources.push(row.source_note)
      if (row.currency !== currency) {
        reasons.push('currency_mismatch')
        continue
      }
      const adjustment = intervalAdjustment([row], priorDate, row.as_of)
      if (adjustment.reasons.length) reasons.push(...adjustment.reasons)
      else {
        adjustmentParts.push(adjustment.adjustment)
        const netContribution = sum(row.cash_flows
          .filter((flow) => flow.currency === row.currency)
          .map((flow) => flow.kind === 'contribution' ? parseDecimal(flow.amount) :
            flow.kind === 'withdrawal' ? negate(parseDecimal(flow.amount)) : zero()))
        capitalParts.push(netContribution)
      }
    }
  }
  if (reasons.length) return uncomputable(currency, asOf, baseDate, unique(reasons), sources, 'cumulative_return', [...snapshotDates])
  const pnl = add(subtract(currentValue, baseValue), sum(adjustmentParts))
  const investedCapital = sum(capitalParts)
  const rate = investedCapital.coefficient === 0n ? null : ratePercent(pnl, investedCapital)
  return computed(pnl, rate, currency, asOf, baseDate, sources,
    'cumulative_return',
    rate === null ? ['zero_rate_denominator'] : [], [...snapshotDates])
}

function intervalAdjustment(rows: InvestmentSnapshot[], fromDate: string, toDate: string): { adjustment: Decimal; reasons: InvestmentMetricReason[] } {
  const reasons: InvestmentMetricReason[] = []
  const adjustments: Decimal[] = []
  for (const row of rows) {
    if (!row.cash_flows_complete) reasons.push('cash_flow_coverage_unknown')
    for (const flow of row.cash_flows) {
      if (flow.date <= fromDate || flow.date > toDate) reasons.push('cash_flow_outside_interval')
      if (flow.currency !== row.currency) reasons.push('cash_flow_currency_mismatch')
      const amount = parseDecimal(flow.amount)
      if (flow.kind === 'contribution') adjustments.push(negate(amount))
      else if (flow.kind === 'withdrawal') adjustments.push(amount)
      else if (!flow.included_in_market_value && flow.kind === 'fee') adjustments.push(negate(amount))
      else if (!flow.included_in_market_value && flow.kind === 'dividend') adjustments.push(amount)
    }
  }
  return { adjustment: sum(adjustments), reasons: unique(reasons) }
}

function priorDateFor(snapshot: InvestmentSnapshot, history: InvestmentSnapshot[]): string {
  return history.filter((row) => row.as_of < snapshot.as_of).at(-1)?.as_of || ''
}

function commonSnapshotDates(assetKeys: string[], byAsset: Map<string, InvestmentSnapshot[]>): string[] {
  if (!assetKeys.length) return []
  const counts = new Map<string, number>()
  for (const assetKey of assetKeys) {
    const distinct = new Set((byAsset.get(assetKey) || []).map((row) => row.as_of))
    for (const date of distinct) counts.set(date, (counts.get(date) || 0) + 1)
  }
  return [...counts.entries()].filter(([, count]) => count === assetKeys.length).map(([date]) => date).sort()
}

function groupByCurrency(assetKeys: string[], latestByAsset: Map<string, InvestmentSnapshot>): Array<{ currency: string; assetKeys: string[] }> {
  const grouped = new Map<string, string[]>()
  for (const assetKey of assetKeys) {
    const latest = latestByAsset.get(assetKey)
    const currency = latest?.currency || ''
    const keys = grouped.get(currency) || []
    keys.push(assetKey)
    grouped.set(currency, keys)
  }
  return [...grouped.entries()].map(([currency, keys]) => ({ currency, assetKeys: keys }))
}

function commonLatestDate(assetKeys: string[], latest: Map<string, InvestmentSnapshot>): string | null {
  return commonDate(assetKeys.map((key) => latest.get(key)?.as_of || null))
}

function commonDate(dates: Array<string | null>): string | null {
  const values = dates.filter((date): date is string => date !== null)
  return values.length === dates.length && values.length && values.every((date) => date === values[0]) ? values[0] : null
}

function areConsecutiveCalendarDays(previous: string, current: string): boolean {
  const previousTime = Date.parse(`${previous}T00:00:00.000Z`)
  const currentTime = Date.parse(`${current}T00:00:00.000Z`)
  return Number.isFinite(previousTime) && currentTime - previousTime === 24 * 60 * 60 * 1000
}

function sumDecimals(values: Array<string | null>): Decimal | null {
  return values.every((value): value is string => value !== null) ? sum(values.map(parseDecimal)) : null
}

function computed(
  amount: Decimal,
  rate: string | null,
  currency: string,
  asOf: string | null,
  baseDate: string | null,
  sourceNotes: string[],
  formulaId: InvestmentFormulaId,
  reasons: InvestmentMetricReason[] = [],
  snapshotDates: string[] = []
): InvestmentMetric {
  return { status: 'computed', amount: decimalToString(amount), rate_percent: rate, currency, as_of: asOf, base_date: baseDate,
    reasons: unique(reasons), source_notes: unique(sourceNotes.filter(Boolean)),
    snapshot_dates: unique(snapshotDates.length ? snapshotDates : [baseDate, asOf].filter((date): date is string => date !== null)), formula_id: formulaId }
}

function uncomputable(
  currency: string,
  asOf: string | null,
  baseDate: string | null,
  reasons: InvestmentMetricReason[],
  sourceNotes: string[],
  formulaId: InvestmentFormulaId,
  snapshotDates: string[] = []
): InvestmentMetric {
  return { status: 'uncomputable', amount: null, rate_percent: null, currency, as_of: asOf, base_date: baseDate,
    reasons: unique(reasons), source_notes: unique(sourceNotes.filter(Boolean)),
    snapshot_dates: unique(snapshotDates.length ? snapshotDates : [baseDate, asOf].filter((date): date is string => date !== null)), formula_id: formulaId }
}

function isSnapshot(snapshot: InvestmentSnapshot | undefined): snapshot is InvestmentSnapshot {
  return snapshot !== undefined
}

function unique<T>(items: T[]): T[] { return [...new Set(items)] }

function parseDecimal(value: string): Decimal {
  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const [integerPart, fractionPart = ''] = unsigned.split('.')
  const coefficient = BigInt(`${integerPart}${fractionPart}` || '0') * (negative ? -1n : 1n)
  return normalize({ coefficient, scale: fractionPart.length })
}

function normalize(value: Decimal): Decimal {
  if (value.coefficient === 0n) return { coefficient: 0n, scale: 0 }
  let coefficient = value.coefficient
  let scale = value.scale
  while (scale > 0 && coefficient % 10n === 0n) { coefficient /= 10n; scale-- }
  return { coefficient, scale }
}

function align(a: Decimal, b: Decimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale)
  return [a.coefficient * 10n ** BigInt(scale - a.scale), b.coefficient * 10n ** BigInt(scale - b.scale), scale]
}

function add(a: Decimal, b: Decimal): Decimal {
  const [left, right, scale] = align(a, b)
  return normalize({ coefficient: left + right, scale })
}

function subtract(a: Decimal, b: Decimal): Decimal {
  const [left, right, scale] = align(a, b)
  return normalize({ coefficient: left - right, scale })
}

function multiply(a: Decimal, b: Decimal): Decimal {
  return normalize({ coefficient: a.coefficient * b.coefficient, scale: a.scale + b.scale })
}

function negate(value: Decimal): Decimal { return { coefficient: -value.coefficient, scale: value.scale } }
function zero(): Decimal { return { coefficient: 0n, scale: 0 } }
function sum(values: Decimal[]): Decimal { return values.reduce(add, zero()) }

function decimalToString(value: Decimal): string {
  const normalized = normalize(value)
  const negative = normalized.coefficient < 0n
  let digits = (negative ? -normalized.coefficient : normalized.coefficient).toString()
  if (normalized.scale > 0) {
    digits = digits.padStart(normalized.scale + 1, '0')
    const split = digits.length - normalized.scale
    digits = `${digits.slice(0, split)}.${digits.slice(split)}`
  }
  return `${negative ? '-' : ''}${digits}`
}

function ratePercent(numerator: Decimal, denominator: Decimal): string {
  const [top, bottom] = align(numerator, denominator)
  const negative = (top < 0n) !== (bottom < 0n)
  const scaledTop = (top < 0n ? -top : top) * 100n * 10n ** BigInt(RATE_SCALE)
  const scaledBottom = bottom < 0n ? -bottom : bottom
  const quotient = scaledTop / scaledBottom
  const remainder = scaledTop % scaledBottom
  const rounded = quotient + (remainder * 2n >= scaledBottom ? 1n : 0n)
  return decimalToString({ coefficient: negative ? -rounded : rounded, scale: RATE_SCALE })
}
