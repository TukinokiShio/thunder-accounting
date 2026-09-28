#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readFile, realpath, rename } from 'node:fs/promises'
import path from 'node:path'

const MAX_BYTES = 1024 * 1024
const MAX_CONTEXT_BYTES = 8 * 1024 * 1024
const MAX_ITEMS = 200
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SKILL_NAME = 'thunder-expense-entry'
const SKILL_VERSION = '1.0.0'
const INVESTMENT_BASE_FIELDS = ['asset_key', 'name', 'asset_type', 'quantity', 'cost_basis', 'market_value', 'currency', 'as_of', 'source_note']
const INVESTMENT_SEMANTIC_FIELDS = ['quantity_kind', 'cost_basis_kind', 'cash_flows', 'cash_flows_complete']
const SNAPSHOT_METADATA_FIELDS = ['operation_id', 'recorded_at']
const CASH_FLOW_FIELDS = ['flow_id', 'date', 'kind', 'amount', 'currency', 'included_in_market_value']
const QUANTITY_KINDS = new Set(['shares', 'units', 'currency_amount', 'unknown'])
const COST_BASIS_KINDS = new Set(['total', 'per_unit', 'unknown'])
const CASH_FLOW_KINDS = new Set(['contribution', 'withdrawal', 'dividend', 'fee'])
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/

function fail(message) {
  console.error(`Proposal not created: ${message}`)
  process.exitCode = 1
}

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== '--context' || !argv[1]) {
    throw new Error('Usage: node scripts/submit.mjs --context <app-generated-context.json> < expense-items.json')
  }
  return path.resolve(argv[1])
}

async function readStdin() {
  const chunks = []
  let bytes = 0
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_BYTES) throw new Error('Input exceeds 1 MiB.')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')
  return JSON.parse(text)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function validateContext(context) {
  const required = ['schema_version', 'expires_at', 'scope_token', 'expense_categories', 'investment_holdings']
  const allowed = [...required, 'investment_snapshot_history']
  if (!isRecord(context) || required.some((key) => !Object.hasOwn(context, key)) || Object.keys(context).some((key) => !allowed.includes(key))) {
    throw new Error('Invalid Thunder Accounting context fields.')
  }
  if (context.schema_version !== 'thunder-agent-context/v1' || typeof context.scope_token !== 'string' || !UUID_V4.test(context.scope_token)) throw new Error('Invalid Thunder Accounting context.')
  if (!Number.isFinite(Date.parse(context.expires_at)) || Date.parse(context.expires_at) <= Date.now()) throw new Error('The app context has expired. Refresh it in Thunder Accounting.')
  if (!Array.isArray(context.expense_categories) || context.expense_categories.length > 1000 || context.expense_categories.some((item) =>
    !isRecord(item) || Object.keys(item).length !== 2 || !Object.hasOwn(item, 'name') || !Object.hasOwn(item, 'children') ||
    typeof item.name !== 'string' || item.name.length < 1 || item.name.length > 120 ||
    !Array.isArray(item.children) || item.children.length > 1000 || item.children.some((child) => typeof child !== 'string' || child.length < 1 || child.length > 120)
  )) throw new Error('The context has no valid, bounded expense category tree.')
  if (!Array.isArray(context.investment_holdings) || context.investment_holdings.length > 10000) throw new Error('The context holdings list is invalid or too large.')
  context.investment_holdings.forEach((item) => validateContextPosition(item))
  if (Object.hasOwn(context, 'investment_snapshot_history')) {
    if (!Array.isArray(context.investment_snapshot_history) || context.investment_snapshot_history.length > 10000) throw new Error('The context snapshot history is invalid or too large.')
    context.investment_snapshot_history.forEach((item) => validateContextPosition(item, true))
  }
}

function validateContextPosition(item, isSnapshot = false) {
  const required = isSnapshot ? [...INVESTMENT_BASE_FIELDS, ...INVESTMENT_SEMANTIC_FIELDS, ...SNAPSHOT_METADATA_FIELDS] : INVESTMENT_BASE_FIELDS
  const allowed = [...INVESTMENT_BASE_FIELDS, ...INVESTMENT_SEMANTIC_FIELDS, ...SNAPSHOT_METADATA_FIELDS]
  if (!isRecord(item) || required.some((field) => !Object.hasOwn(item, field)) || Object.keys(item).some((field) => !allowed.includes(field))) {
    throw new Error('The context contains a holding/snapshot with invalid fields.')
  }
  for (const [field, max] of [['asset_key', 128], ['name', 120], ['asset_type', 40], ['source_note', 1000]]) {
    if (typeof item[field] !== 'string' || item[field].length < (field === 'source_note' ? 0 : 1) || item[field].length > max) throw new Error(`The context contains an invalid ${field} string.`)
  }
  for (const field of ['quantity', 'cost_basis', 'market_value']) {
    const value = item[field]
    if (value === null && field !== 'quantity') continue
    if (typeof value !== 'string' || !DECIMAL.test(value)) throw new Error(`The context contains an invalid ${field} decimal.`)
    const unsigned = value.startsWith('-') ? value.slice(1) : value
    const [integer, fraction = ''] = unsigned.split('.')
    if (integer.length > 36 || fraction.length > 18) throw new Error(`The context contains excessive ${field} precision.`)
  }
  if (typeof item.currency !== 'string' || !/^[A-Z]{3}$/.test(item.currency) || !isDate(item.as_of)) throw new Error('The context contains an invalid currency or date.')
  if (Object.hasOwn(item, 'quantity_kind') && !QUANTITY_KINDS.has(item.quantity_kind)) throw new Error('The context contains an invalid quantity_kind.')
  if (Object.hasOwn(item, 'cost_basis_kind') && !COST_BASIS_KINDS.has(item.cost_basis_kind)) throw new Error('The context contains an invalid cost_basis_kind.')
  if (Object.hasOwn(item, 'cash_flows_complete') && typeof item.cash_flows_complete !== 'boolean') throw new Error('The context contains an invalid cash_flows_complete flag.')
  if (Object.hasOwn(item, 'cash_flows')) {
    if (!Array.isArray(item.cash_flows) || item.cash_flows.length > 200) throw new Error('The context contains an invalid/oversized cash_flows list.')
    const ids = new Set()
    for (const flow of item.cash_flows) {
      if (!isRecord(flow) || Object.keys(flow).length !== CASH_FLOW_FIELDS.length || CASH_FLOW_FIELDS.some((field) => !Object.hasOwn(flow, field))) throw new Error('The context contains a cash flow with invalid fields.')
      if (typeof flow.flow_id !== 'string' || flow.flow_id.length < 1 || flow.flow_id.length > 128 || ids.has(flow.flow_id)) throw new Error('The context contains an invalid/duplicate flow_id.')
      ids.add(flow.flow_id)
      if (!isDate(flow.date) || flow.date > item.as_of || !CASH_FLOW_KINDS.has(flow.kind)) throw new Error('The context contains a cash flow with invalid date or kind.')
      if (typeof flow.amount !== 'string' || !DECIMAL.test(flow.amount) || flow.amount.startsWith('-') || /^0(?:\.0+)?$/.test(flow.amount)) throw new Error('The context contains a non-positive cash flow amount.')
      const [integer, fraction = ''] = flow.amount.split('.')
      if (integer.length > 36 || fraction.length > 18 || typeof flow.currency !== 'string' || !/^[A-Z]{3}$/.test(flow.currency) || typeof flow.included_in_market_value !== 'boolean') throw new Error('The context contains an invalid cash flow value.')
    }
  }
  if (isSnapshot && (typeof item.operation_id !== 'string' || !UUID_V4.test(item.operation_id) || !Number.isFinite(Date.parse(item.recorded_at)))) throw new Error('The context contains invalid snapshot confirmation metadata.')
}

function validateItems(items, categories) {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) throw new Error(`Provide 1–${MAX_ITEMS} expense rows.`)
  const allowed = new Map(categories.map((item) => [item.name, new Set(item.children)]))
  for (const [index, item] of items.entries()) {
    const fields = ['amount', 'category1', 'category2', 'date', 'note']
    if (!isRecord(item) || Object.keys(item).length !== fields.length || fields.some((field) => !Object.hasOwn(item, field))) {
      throw new Error(`Row ${index + 1} must contain exactly: ${fields.join(', ')}.`)
    }
    if (typeof item.amount !== 'number' || !Number.isFinite(item.amount) || item.amount <= 0 || item.amount > 1_000_000_000_000 || !/^\d+(?:\.\d{1,2})?$/.test(item.amount.toString())) throw new Error(`Row ${index + 1} has an invalid amount; use at most two decimal places.`)
    if (typeof item.category1 !== 'string' || typeof item.category2 !== 'string' || !allowed.has(item.category1) || !allowed.get(item.category1).has(item.category2)) throw new Error(`Row ${index + 1} does not match a current two-level expense category.`)
    if (!isDate(item.date)) throw new Error(`Row ${index + 1} has an invalid calendar date.`)
    if (typeof item.note !== 'string' || item.note.length > 1000) throw new Error(`Row ${index + 1} has an invalid note.`)
  }
}

function validateSourceSummary(summary) {
  if (typeof summary !== 'string' || summary.trim().length === 0 || summary.length > 500 || summary.trim() !== summary) {
    throw new Error('source_summary must be a concise non-empty string of at most 500 characters.')
  }
  if (/[\u0000-\u001f\u007f]/.test(summary)) throw new Error('source_summary must not contain control characters.')
  const forbidden = [
    /(?:^|\s)[A-Za-z]:[\\/]/,
    /(?:^|\s)\\\\/,
    /\bfile:\/\//i,
    /(?:^|\s)\/(?:Users|home|tmp|private|var|mnt|Volumes)\b/i,
    /\b(?:password|passwd|secret|api[\s_-]?key|bearer|authorization|scope[\s_-]?token)\b/i,
    /\b(?:cloudbase|broker)[\s_-]*(?:key|secret|token|credential)\b/i,
    /(?<!\d)1[3-9]\d{9}(?!\d)/,
    /(?<!\d)\d{16,19}(?!\d)/,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
  ]
  if (forbidden.some((pattern) => pattern.test(summary))) throw new Error('source_summary must not contain paths, credentials, phone/account numbers, or email addresses.')
}

async function main() {
  const contextPath = parseArgs(process.argv.slice(2))
  if (path.basename(contextPath).toLowerCase() !== 'context.json') throw new Error('The context path must be the app-generated context.json.')
  if (path.basename(path.dirname(contextPath)).toLowerCase() !== 'agent-sync') throw new Error('The context must come from the app-managed agent-sync directory.')
  const contextStat = await lstat(contextPath)
  if (!contextStat.isFile() || contextStat.isSymbolicLink() || contextStat.size > MAX_CONTEXT_BYTES) throw new Error('The context must be a regular app-generated file no larger than 8 MiB.')
  const context = JSON.parse(await readFile(contextPath, 'utf8'))
  validateContext(context)
  const input = await readStdin()
  if (!isRecord(input) || Object.keys(input).length !== 2 || !Object.hasOwn(input, 'source_summary') || !Object.hasOwn(input, 'items')) {
    throw new Error('Input must contain exactly source_summary and items.')
  }
  validateSourceSummary(input.source_summary)
  const items = input.items
  validateItems(items, context.expense_categories)

  const parent = path.dirname(contextPath)
  const inboxPath = path.join(parent, 'inbox')
  const parentReal = await realpath(parent)
  const inboxStat = await lstat(inboxPath)
  if (!inboxStat.isDirectory() || inboxStat.isSymbolicLink() || await realpath(inboxPath) !== path.join(parentReal, 'inbox')) throw new Error('The adjacent app inbox is not a regular directory.')

  const operationId = randomUUID()
  const proposal = {
    schema_version: 'thunder-agent-proposal/v1',
    operation_id: operationId,
    scope_token: context.scope_token,
    created_at: new Date().toISOString(),
    kind: 'expenses',
    skill_name: SKILL_NAME,
    skill_version: SKILL_VERSION,
    source_summary: input.source_summary,
    items
  }
  const data = `${JSON.stringify(proposal, null, 2)}\n`
  if (Buffer.byteLength(data, 'utf8') > MAX_BYTES) throw new Error('Serialized proposal exceeds 1 MiB.')

  const finalPath = path.join(inboxPath, `${operationId}.json`)
  const temporaryPath = path.join(inboxPath, `.${operationId}.tmp`)
  const handle = await open(temporaryPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
  try {
    await handle.writeFile(data, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporaryPath, finalPath)
  console.log(`Proposal created for app review: ${finalPath}`)
  console.log('Nothing has been written to the ledger. Confirm this proposal in Thunder Accounting.')
}

main().catch(fail)
