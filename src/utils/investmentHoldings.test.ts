import { describe, expect, it } from 'vitest'
import {
  computeInvestmentDiff,
  INVESTMENT_FIELD_LIMITS,
  MAX_INVESTMENT_BATCH_ITEMS,
  validateInvestmentBatch,
  type InvestmentHolding
} from './investmentHoldings'

function holding(overrides: Partial<InvestmentHolding> = {}): InvestmentHolding {
  return {
    asset_key: 'US:AAPL',
    name: 'Apple',
    asset_type: 'stock',
    quantity: '12.000000000000000001',
    cost_basis: '123456789012345678.123456789012345678',
    market_value: null,
    currency: 'USD',
    as_of: '2026-09-28',
    source_note: 'Synthetic fixture',
    quantity_kind: 'unknown',
    cost_basis_kind: 'unknown',
    cash_flows: [],
    cash_flows_complete: false,
    ...overrides
  }
}

describe('validateInvestmentBatch', () => {
  it('accepts strict rows and preserves high-precision decimal strings verbatim', () => {
    const row = holding()
    const result = validateInvestmentBatch([row])

    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.holdings).toEqual([row])
      expect(result.holdings[0].quantity).toBe('12.000000000000000001')
      expect(result.holdings[0].cost_basis).toBe('123456789012345678.123456789012345678')
    }
  })

  it('rejects unknown and missing fields', () => {
    const result = validateInvestmentBatch([{ ...holding(), userId: 'synthetic' }])

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ field: 'userId', code: 'unknown_field' })
      ]))
    }

    const missing = { ...holding() } as Record<string, unknown>
    delete missing.source_note
    const missingResult = validateInvestmentBatch([missing])
    expect(missingResult.valid).toBe(false)
    if (!missingResult.valid) {
      expect(missingResult.errors).toContainEqual(expect.objectContaining({ field: 'source_note', code: 'missing_field' }))
    }
  })

  it('rejects malformed decimals without converting through floating point', () => {
    for (const value of ['1e3', '+1', '.5', '1.', '01.2', '1,000', '1.1234567890123456789']) {
      const result = validateInvestmentBatch([holding({ quantity: value })])
      expect(result.valid, value).toBe(false)
      if (!result.valid) expect(result.errors).toContainEqual(expect.objectContaining({ field: 'quantity', code: 'invalid_decimal' }))
    }
  })

  it('allows signed decimals and nullable cost/market values', () => {
    const result = validateInvestmentBatch([holding({ quantity: '-0.125', cost_basis: null, market_value: null })])

    expect(result.valid).toBe(true)
    if (result.valid) expect(result.holdings[0]).toMatchObject({ quantity: '-0.125', cost_basis: null, market_value: null })
  })

  it('rejects duplicate keys, noncanonical currency codes, and impossible dates', () => {
    const result = validateInvestmentBatch([
      holding(),
      holding({ currency: 'usd' }),
      holding({ asset_key: 'US:MSFT', currency: 'USDT' }),
      holding({ asset_key: 'US:TSLA', as_of: '2026-02-29' }),
      holding({ asset_key: 'US:NVDA', as_of: '2026-13-01' }),
      holding()
    ])

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_currency' }),
        expect.objectContaining({ code: 'invalid_date' }),
        expect.objectContaining({ code: 'duplicate_asset_key' })
      ]))
    }
  })

  it('enforces documented string limits and the 200-row batch cap', () => {
    const tooLong = validateInvestmentBatch([holding({ name: 'N'.repeat(INVESTMENT_FIELD_LIMITS.name + 1) })])
    expect(tooLong.valid).toBe(false)
    if (!tooLong.valid) expect(tooLong.errors).toContainEqual(expect.objectContaining({ field: 'name', code: 'invalid_string' }))

    const oversized = validateInvestmentBatch(Array.from({ length: MAX_INVESTMENT_BATCH_ITEMS + 1 }, (_, index) =>
      holding({ asset_key: `SYNTH:${index}` })
    ))
    expect(oversized.valid).toBe(false)
    if (!oversized.valid) expect(oversized.errors).toContainEqual(expect.objectContaining({ code: 'batch_too_large' }))
  })

  it('does not mutate caller-provided rows', () => {
    const row = holding()
    const before = structuredClone(row)

    validateInvestmentBatch([row])

    expect(row).toEqual(before)
  })
})

describe('computeInvestmentDiff', () => {
  it('reports additions, changes, unchanged, and unmentioned rows separately', () => {
    const existing = [
      holding({ asset_key: 'SYNTH:KEEP', name: 'Keep' }),
      holding({ asset_key: 'SYNTH:CHANGE', name: 'Before', quantity: '2' }),
      holding({ asset_key: 'SYNTH:UNMENTIONED', name: 'Unmentioned' })
    ]
    const incoming = [
      holding({ asset_key: 'SYNTH:KEEP', name: 'Keep' }),
      holding({ asset_key: 'SYNTH:CHANGE', name: 'After', quantity: '3' }),
      holding({ asset_key: 'SYNTH:NEW', name: 'New' })
    ]

    const result = computeInvestmentDiff(existing, incoming)

    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.added.map((row) => row.asset_key)).toEqual(['SYNTH:NEW'])
      expect(result.changed).toEqual([{ before: existing[1], after: incoming[1] }])
      expect(result.unchanged.map((row) => row.asset_key)).toEqual(['SYNTH:KEEP'])
      expect(result.unmentioned.map((row) => row.asset_key)).toEqual(['SYNTH:UNMENTIONED'])
    }
  })

  it('keeps every existing row unmentioned for an empty incoming batch', () => {
    const existing = [holding({ asset_key: 'SYNTH:1' }), holding({ asset_key: 'SYNTH:2' })]
    const result = computeInvestmentDiff(existing, [])

    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.added).toEqual([])
      expect(result.changed).toEqual([])
      expect(result.unmentioned).toEqual(existing)
    }
  })

  it('returns validation errors instead of silently diffing duplicate keys', () => {
    const result = computeInvestmentDiff([], [holding(), holding()])

    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContainEqual(expect.objectContaining({ code: 'duplicate_asset_key' }))
  })
})
