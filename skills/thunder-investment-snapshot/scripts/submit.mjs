#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readFile, realpath, rename } from 'node:fs/promises'
import path from 'node:path'

const MAX_BYTES = 1024 * 1024
const MAX_ITEMS = 200
const FIELDS = ['asset_key', 'name', 'asset_type', 'quantity', 'cost_basis', 'market_value', 'currency', 'as_of', 'source_note']
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/

function fail(message) {
  console.error(`Proposal not created: ${message}`)
  process.exitCode = 1
}

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== '--context' || !argv[1]) throw new Error('Usage: node scripts/submit.mjs --context <app-generated-context.json> < holdings.json')
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
  return JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, ''))
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

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) throw new Error(`Provide 1–${MAX_ITEMS} holdings.`)
  const keys = new Set()
  for (const [index, item] of items.entries()) {
    if (!isRecord(item) || Object.keys(item).length !== FIELDS.length || FIELDS.some((field) => !Object.hasOwn(item, field))) throw new Error(`Row ${index + 1} must contain exactly: ${FIELDS.join(', ')}.`)
    for (const [field, max] of [['asset_key', 128], ['name', 120], ['asset_type', 40], ['source_note', 1000]]) {
      if (typeof item[field] !== 'string' || item[field].length > max || (field !== 'source_note' && item[field].trim().length === 0) || (field !== 'source_note' && item[field].trim() !== item[field])) throw new Error(`Row ${index + 1} has an invalid ${field}.`)
    }
    if (keys.has(item.asset_key)) throw new Error(`Duplicate asset_key: ${item.asset_key}`)
    keys.add(item.asset_key)
    for (const field of ['quantity', 'cost_basis', 'market_value']) {
      const value = item[field]
      if (value === null && field !== 'quantity') continue
      if (typeof value !== 'string' || !DECIMAL.test(value)) throw new Error(`Row ${index + 1} has an invalid ${field}; use a decimal string or null for unknown cost/value.`)
      const unsigned = value.startsWith('-') ? value.slice(1) : value
      const [integer, fraction = ''] = unsigned.split('.')
      if (integer.length > 36 || fraction.length > 18) throw new Error(`Row ${index + 1} has excessive ${field} precision.`)
    }
    if (typeof item.currency !== 'string' || !/^[A-Z]{3}$/.test(item.currency)) throw new Error(`Row ${index + 1} has an invalid currency.`)
    if (!isDate(item.as_of)) throw new Error(`Row ${index + 1} has an invalid calendar date.`)
  }
}

async function main() {
  const contextPath = parseArgs(process.argv.slice(2))
  if (path.basename(contextPath).toLowerCase() !== 'context.json') throw new Error('The context path must be the app-generated context.json.')
  if (path.basename(path.dirname(contextPath)).toLowerCase() !== 'agent-sync') throw new Error('The context must come from the app-managed agent-sync directory.')
  const contextStat = await lstat(contextPath)
  if (!contextStat.isFile() || contextStat.isSymbolicLink() || contextStat.size > 64 * 1024) throw new Error('The context must be a regular app-generated file no larger than 64 KiB.')
  const context = JSON.parse(await readFile(contextPath, 'utf8'))
  if (!isRecord(context) || context.schema_version !== 'thunder-agent-context/v1' || typeof context.scope_token !== 'string' || !/^[0-9a-f-]{36}$/i.test(context.scope_token)) throw new Error('Invalid Thunder Accounting context.')
  if (!Number.isFinite(Date.parse(context.expires_at)) || Date.parse(context.expires_at) <= Date.now()) throw new Error('The app context has expired. Refresh it in Thunder Accounting.')
  if (!Array.isArray(context.investment_holdings)) throw new Error('The context has no valid current holdings list.')
  const items = await readStdin()
  validateItems(items)

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
    kind: 'investments',
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
  console.log('Nothing has been written to holdings. Confirm this proposal in Thunder Accounting.')
}

main().catch(fail)
