/**
 * Pure validation and preview-diff helpers for investment holding imports.
 * This module deliberately does not read from storage or write/sync data.
 */

export const MAX_INVESTMENT_BATCH_ITEMS = 200
export const MAX_CASH_FLOWS_PER_HOLDING = 200

export const INVESTMENT_FIELD_LIMITS = {
  asset_key: 128,
  name: 120,
  asset_type: 40,
  source_note: 1000
} as const

const INTEGER_DIGIT_LIMIT = 36
const FRACTION_DIGIT_LIMIT = 18
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/
const POSITIVE_DECIMAL_PATTERN = /^(?:[1-9]\d*(?:\.\d+)?|0?\.\d*[1-9]\d*)$/
const CURRENCY_PATTERN = /^[A-Z]{3}$/
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const QUANTITY_KINDS = ['shares', 'units', 'currency_amount', 'unknown'] as const
const COST_BASIS_KINDS = ['total', 'per_unit', 'unknown'] as const
const CASH_FLOW_KINDS = ['contribution', 'withdrawal', 'dividend', 'fee'] as const

const REQUIRED_FIELDS = [
  'asset_key',
  'name',
  'asset_type',
  'quantity',
  'cost_basis',
  'market_value',
  'currency',
  'as_of',
  'source_note',
  'quantity_kind',
  'cost_basis_kind',
  'cash_flows',
  'cash_flows_complete'
] as const

const LEGACY_REQUIRED_FIELDS = [
  'asset_key', 'name', 'asset_type', 'quantity', 'cost_basis', 'market_value', 'currency', 'as_of', 'source_note'
] as const

const ALLOWED_FIELDS = [...REQUIRED_FIELDS] as const

export type InvestmentField = (typeof REQUIRED_FIELDS)[number]

/** Decimal values stay as strings so validation and comparison never round via Number. */
export interface InvestmentHolding {
  asset_key: string
  name: string
  asset_type: string
  quantity: string
  cost_basis: string | null
  market_value: string | null
  currency: string
  as_of: string
  source_note: string
  quantity_kind: InvestmentQuantityKind
  cost_basis_kind: InvestmentCostBasisKind
  cash_flows: InvestmentCashFlow[]
  cash_flows_complete: boolean
}

export type InvestmentQuantityKind = (typeof QUANTITY_KINDS)[number]
export type InvestmentCostBasisKind = (typeof COST_BASIS_KINDS)[number]
export type InvestmentCashFlowKind = (typeof CASH_FLOW_KINDS)[number]

export interface InvestmentCashFlow {
  flow_id: string
  date: string
  kind: InvestmentCashFlowKind
  amount: string
  currency: string
  included_in_market_value: boolean
}

export type InvestmentValidationCode =
  | 'expected_array'
  | 'batch_too_large'
  | 'invalid_record'
  | 'unknown_field'
  | 'missing_field'
  | 'invalid_string'
  | 'invalid_decimal'
  | 'invalid_currency'
  | 'invalid_date'
  | 'invalid_enum'
  | 'invalid_cash_flow'
  | 'duplicate_cash_flow_id'
  | 'duplicate_asset_key'

export interface InvestmentValidationIssue {
  /** Zero-based row index; null means the issue applies to the whole batch. */
  itemIndex: number | null
  field: string | null
  code: InvestmentValidationCode
  message: string
}

export type InvestmentBatchValidation =
  | { valid: true; holdings: InvestmentHolding[]; errors: [] }
  | { valid: false; errors: InvestmentValidationIssue[] }

export interface ChangedInvestmentHolding {
  before: InvestmentHolding
  after: InvestmentHolding
}

export interface InvestmentDiff {
  /** Incoming rows with keys absent from the existing holdings. */
  added: InvestmentHolding[]
  /** Same-key rows whose field values differ. */
  changed: ChangedInvestmentHolding[]
  /** Same-key rows whose field values are identical. */
  unchanged: InvestmentHolding[]
  /** Existing rows not present in the incoming batch; these are never deletions. */
  unmentioned: InvestmentHolding[]
}

export type InvestmentDiffResult =
  | ({ valid: true; errors: [] } & InvestmentDiff)
  | { valid: false; errors: InvestmentValidationIssue[] }

/** Validate the strict JSON-like row shape and retain decimal strings verbatim. */
export function validateInvestmentBatch(input: unknown): InvestmentBatchValidation {
  return validateRows(input, MAX_INVESTMENT_BATCH_ITEMS)
}

/**
 * Compare an incoming batch with current holdings without implying deletion.
 * Incoming rows are subject to the 200-row limit; existing state is validated
 * with the same row rules but no batch-size limit.
 */
export function computeInvestmentDiff(existing: unknown, incoming: unknown): InvestmentDiffResult {
  const existingResult = validateRows(existing, null)
  const incomingResult = validateInvestmentBatch(incoming)
  const errors = [
    ...(existingResult.valid ? [] : existingResult.errors),
    ...(incomingResult.valid ? [] : incomingResult.errors)
  ]

  if (errors.length || !existingResult.valid || !incomingResult.valid) {
    return { valid: false, errors }
  }

  const existingByKey = new Map(existingResult.holdings.map((holding) => [holding.asset_key, holding]))
  const mentionedKeys = new Set<string>()
  const added: InvestmentHolding[] = []
  const changed: ChangedInvestmentHolding[] = []
  const unchanged: InvestmentHolding[] = []

  for (const after of incomingResult.holdings) {
    mentionedKeys.add(after.asset_key)
    const before = existingByKey.get(after.asset_key)
    if (!before) {
      added.push(after)
    } else if (holdingsEqual(before, after)) {
      unchanged.push(after)
    } else {
      changed.push({ before, after })
    }
  }

  const unmentioned = existingResult.holdings.filter((holding) => !mentionedKeys.has(holding.asset_key))
  return { valid: true, errors: [], added, changed, unchanged, unmentioned }
}

function validateRows(input: unknown, maxItems: number | null): InvestmentBatchValidation {
  if (!Array.isArray(input)) {
    return {
      valid: false,
      errors: [{ itemIndex: null, field: null, code: 'expected_array', message: 'Expected an array of investment holdings.' }]
    }
  }

  if (maxItems !== null && input.length > maxItems) {
    return {
      valid: false,
      errors: [{
        itemIndex: null,
        field: null,
        code: 'batch_too_large',
        message: `A batch may contain at most ${maxItems} holdings.`
      }]
    }
  }

  const errors: InvestmentValidationIssue[] = []
  const holdings: InvestmentHolding[] = []
  const seenAssetKeys = new Set<string>()

  for (let itemIndex = 0; itemIndex < input.length; itemIndex++) {
    const row = input[itemIndex]
    const rowErrorsBefore = errors.length
    if (!isPlainRecord(row)) {
      errors.push(issue(itemIndex, null, 'invalid_record', 'Each holding must be a plain object.'))
      continue
    }

    let descriptors: PropertyDescriptorMap
    try {
      descriptors = Object.getOwnPropertyDescriptors(row)
    } catch {
      errors.push(issue(itemIndex, null, 'invalid_record', 'Holding fields could not be inspected.'))
      continue
    }

    const keys = Reflect.ownKeys(row)
    for (const key of keys) {
      if (typeof key !== 'string' || !isInvestmentField(key)) {
        errors.push(issue(itemIndex, typeof key === 'string' ? key : String(key), 'unknown_field', 'Unknown holding field.'))
      } else if (!Object.prototype.hasOwnProperty.call(descriptors[key], 'value')) {
        errors.push(issue(itemIndex, key, 'invalid_record', 'Holding fields must be plain data properties.'))
      }
    }

    for (const field of LEGACY_REQUIRED_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(descriptors, field)) {
        errors.push(issue(itemIndex, field, 'missing_field', 'Required holding field is missing.'))
      }
    }

    const value = (field: InvestmentField): unknown => {
      const descriptor = descriptors[field]
      return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : undefined
    }

    const assetKey = validateBoundedString(value('asset_key'), 'asset_key', itemIndex, 1, INVESTMENT_FIELD_LIMITS.asset_key, errors, true)
    const name = validateBoundedString(value('name'), 'name', itemIndex, 1, INVESTMENT_FIELD_LIMITS.name, errors, true)
    const assetType = validateBoundedString(value('asset_type'), 'asset_type', itemIndex, 1, INVESTMENT_FIELD_LIMITS.asset_type, errors, true)
    const quantity = validateDecimal(value('quantity'), 'quantity', itemIndex, errors, false)
    const costBasis = validateDecimal(value('cost_basis'), 'cost_basis', itemIndex, errors, true)
    const marketValue = validateDecimal(value('market_value'), 'market_value', itemIndex, errors, true)
    const currency = validateCurrency(value('currency'), itemIndex, errors)
    const asOf = validateDate(value('as_of'), itemIndex, errors)
    const sourceNote = validateBoundedString(value('source_note'), 'source_note', itemIndex, 0, INVESTMENT_FIELD_LIMITS.source_note, errors, false)
    const quantityKind = validateEnum(value('quantity_kind'), 'quantity_kind', QUANTITY_KINDS, itemIndex, errors, 'unknown')
    const costBasisKind = validateEnum(value('cost_basis_kind'), 'cost_basis_kind', COST_BASIS_KINDS, itemIndex, errors, 'unknown')
    const cashFlowsComplete = validateCashFlowsComplete(value('cash_flows_complete'), itemIndex, errors)
    const rawCashFlows = value('cash_flows')
    const cashFlows = validateCashFlows(rawCashFlows, asOf, itemIndex, errors)
    if (cashFlowsComplete && rawCashFlows === undefined) {
      errors.push(issue(itemIndex, 'cash_flows', 'invalid_cash_flow', 'A complete cash-flow interval must include its cash_flows array, even when empty.'))
    }

    if (assetKey !== null && seenAssetKeys.has(assetKey)) {
      errors.push(issue(itemIndex, 'asset_key', 'duplicate_asset_key', 'asset_key must be unique within a batch.'))
    }
    if (assetKey !== null) seenAssetKeys.add(assetKey)

    if (errors.length !== rowErrorsBefore) continue

    holdings.push({
      asset_key: assetKey!,
      name: name!,
      asset_type: assetType!,
      quantity: quantity!,
      cost_basis: costBasis,
      market_value: marketValue,
      currency: currency!,
      as_of: asOf!,
      source_note: sourceNote!,
      quantity_kind: quantityKind!,
      cost_basis_kind: costBasisKind!,
      cash_flows: cashFlows!,
      cash_flows_complete: cashFlowsComplete!
    })
  }

  return errors.length ? { valid: false, errors } : { valid: true, holdings, errors: [] }
}

function validateBoundedString(
  value: unknown,
  field: InvestmentField,
  itemIndex: number,
  minLength: number,
  maxLength: number,
  errors: InvestmentValidationIssue[],
  rejectSurroundingWhitespace: boolean
): string | null {
  if (typeof value !== 'string' || value.length < minLength || value.length > maxLength) {
    errors.push(issue(itemIndex, field, 'invalid_string', `Expected a string of ${minLength}–${maxLength} characters.`))
    return null
  }
  if (rejectSurroundingWhitespace && value.trim() !== value) {
    errors.push(issue(itemIndex, field, 'invalid_string', 'Leading or trailing whitespace is not allowed.'))
    return null
  }
  if (minLength > 0 && value.trim().length === 0) {
    errors.push(issue(itemIndex, field, 'invalid_string', 'Value must not be blank.'))
    return null
  }
  return value
}

function validateDecimal(
  value: unknown,
  field: InvestmentField,
  itemIndex: number,
  errors: InvestmentValidationIssue[],
  nullable: boolean
): string | null {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) {
    errors.push(issue(itemIndex, field, 'invalid_decimal', 'Expected a plain decimal string without separators or exponent notation.'))
    return null
  }

  const unsigned = value.startsWith('-') ? value.slice(1) : value
  const [integerPart, fractionPart = ''] = unsigned.split('.')
  if (integerPart.length > INTEGER_DIGIT_LIMIT || fractionPart.length > FRACTION_DIGIT_LIMIT) {
    errors.push(issue(itemIndex, field, 'invalid_decimal', `Decimal precision is limited to ${INTEGER_DIGIT_LIMIT} integer and ${FRACTION_DIGIT_LIMIT} fractional digits.`))
    return null
  }
  return value
}

function validateCurrency(value: unknown, itemIndex: number, errors: InvestmentValidationIssue[]): string | null {
  if (typeof value !== 'string' || !CURRENCY_PATTERN.test(value)) {
    errors.push(issue(itemIndex, 'currency', 'invalid_currency', 'Currency must be a three-letter uppercase ISO 4217 code.'))
    return null
  }
  return value
}

function validateDate(value: unknown, itemIndex: number, errors: InvestmentValidationIssue[]): string | null {
  if (typeof value !== 'string') {
    errors.push(issue(itemIndex, 'as_of', 'invalid_date', 'as_of must be a real calendar date in YYYY-MM-DD format.'))
    return null
  }

  const match = DATE_PATTERN.exec(value)
  if (!match) {
    errors.push(issue(itemIndex, 'as_of', 'invalid_date', 'as_of must be a real calendar date in YYYY-MM-DD format.'))
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0
  if (year === 0 || day < 1 || day > daysInMonth) {
    errors.push(issue(itemIndex, 'as_of', 'invalid_date', 'as_of must be a real calendar date in YYYY-MM-DD format.'))
    return null
  }
  return value
}

function validateEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
  itemIndex: number,
  errors: InvestmentValidationIssue[],
  legacyDefault: T
): T | null {
  if (value === undefined) return legacyDefault
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    errors.push(issue(itemIndex, field, 'invalid_enum', `Expected one of: ${allowed.join(', ')}.`))
    return null
  }
  return value as T
}

function validateCashFlowsComplete(value: unknown, itemIndex: number, errors: InvestmentValidationIssue[]): boolean | null {
  if (value === undefined) return false
  if (typeof value !== 'boolean') {
    errors.push(issue(itemIndex, 'cash_flows_complete', 'invalid_cash_flow', 'cash_flows_complete must be a boolean.'))
    return null
  }
  return value
}

function validateCashFlows(value: unknown, asOf: string | null, itemIndex: number, errors: InvestmentValidationIssue[]): InvestmentCashFlow[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_CASH_FLOWS_PER_HOLDING) {
    errors.push(issue(itemIndex, 'cash_flows', 'invalid_cash_flow', `cash_flows must be an array with at most ${MAX_CASH_FLOWS_PER_HOLDING} items.`))
    return null
  }

  const seenIds = new Set<string>()
  const result: InvestmentCashFlow[] = []
  value.forEach((entry, flowIndex) => {
    const fieldName = `cash_flows[${flowIndex}]`
    if (!isPlainRecord(entry)) {
      errors.push(issue(itemIndex, fieldName, 'invalid_cash_flow', 'Each cash flow must be a plain object.'))
      return
    }
    const allowed = ['flow_id', 'date', 'kind', 'amount', 'currency', 'included_in_market_value']
    let descriptors: PropertyDescriptorMap
    try {
      descriptors = Object.getOwnPropertyDescriptors(entry)
    } catch {
      errors.push(issue(itemIndex, fieldName, 'invalid_cash_flow', 'Cash flow fields could not be inspected.'))
      return
    }
    const keys = Reflect.ownKeys(entry)
    if (keys.some((key) => typeof key !== 'string' || !allowed.includes(key) || !Object.prototype.hasOwnProperty.call(descriptors[key as string], 'value')) ||
      allowed.some((key) => !Object.prototype.hasOwnProperty.call(descriptors, key))) {
      errors.push(issue(itemIndex, fieldName, 'invalid_cash_flow', 'Cash flow has unknown, missing, or accessor fields.'))
      return
    }

    const flow = entry as Record<string, unknown>
    const flowId = flow.flow_id
    const date = flow.date
    const kind = flow.kind
    const amount = flow.amount
    const flowCurrency = flow.currency
    const included = flow.included_in_market_value
    const valid = typeof flowId === 'string' && flowId.length > 0 && flowId.length <= 128 && flowId.trim() === flowId &&
      typeof date === 'string' && isValidDateValue(date) && !!asOf && date <= asOf &&
      typeof kind === 'string' && (CASH_FLOW_KINDS as readonly string[]).includes(kind) &&
      typeof amount === 'string' && POSITIVE_DECIMAL_PATTERN.test(amount) && isDecimalWithinLimits(amount) &&
      typeof flowCurrency === 'string' && CURRENCY_PATTERN.test(flowCurrency) && typeof included === 'boolean'
    if (!valid) {
      errors.push(issue(itemIndex, fieldName, 'invalid_cash_flow', 'Cash flow must have a stable ID, valid date, supported kind, positive decimal amount, ISO currency, and boolean inclusion flag.'))
      return
    }
    if (seenIds.has(flowId as string)) {
      errors.push(issue(itemIndex, `${fieldName}.flow_id`, 'duplicate_cash_flow_id', 'flow_id must be unique within a holding snapshot.'))
      return
    }
    seenIds.add(flowId as string)
    result.push({
      flow_id: flowId as string,
      date: date as string,
      kind: kind as InvestmentCashFlowKind,
      amount: amount as string,
      currency: flowCurrency as string,
      included_in_market_value: included as boolean
    })
  })
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.flow_id.localeCompare(b.flow_id))
}

function isValidDateValue(value: string): boolean {
  const match = DATE_PATTERN.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0
  return year > 0 && day >= 1 && day <= daysInMonth
}

function isDecimalWithinLimits(value: string): boolean {
  if (!DECIMAL_PATTERN.test(value)) return false
  const unsigned = value.startsWith('-') ? value.slice(1) : value
  const [integerPart, fractionPart = ''] = unsigned.split('.')
  return integerPart.length <= INTEGER_DIGIT_LIMIT && fractionPart.length <= FRACTION_DIGIT_LIMIT
}

function holdingsEqual(a: InvestmentHolding, b: InvestmentHolding): boolean {
  return REQUIRED_FIELDS.every((field) => field === 'cash_flows'
    ? JSON.stringify(a.cash_flows) === JSON.stringify(b.cash_flows)
    : a[field] === b[field])
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

function isInvestmentField(value: string): value is InvestmentField {
  return (ALLOWED_FIELDS as readonly string[]).includes(value)
}

function issue(
  itemIndex: number | null,
  field: string | null,
  code: InvestmentValidationCode,
  message: string
): InvestmentValidationIssue {
  return { itemIndex, field, code, message }
}
