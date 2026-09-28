export interface InvestmentCloudRecord {
  userId: string
  asset_key: string
  as_of: string
  [field: string]: unknown
}

export interface InvestmentCloudSnapshotRecord extends InvestmentCloudRecord {
  operation_id: string
  recorded_at: string
}

interface CloudReadResult {
  data?: unknown
}

interface CloudConditionalQuery {
  get(): Promise<CloudReadResult>
  update(data: InvestmentCloudRecord): Promise<{ updated?: number }>
}

interface CloudCollection {
  where(condition: Record<string, unknown>): CloudConditionalQuery
  add(data: InvestmentCloudRecord & { _id: string }): Promise<unknown>
}

export interface InvestmentCloudDatabase {
  collection(name: string): CloudCollection
  command: { lte(value: string): unknown }
}

/**
 * Monotonically update the current cloud position by as_of. Existing rows use
 * an atomic query condition; new rows use the deterministic _id as a unique
 * create key, then recover duplicate-create races through the same condition.
 */
export async function upsertInvestmentCloudCurrent(
  database: InvestmentCloudDatabase,
  documentId: string,
  record: InvestmentCloudRecord
): Promise<void> {
  if (!documentId || !record.userId || !record.asset_key || !isValidDate(record.as_of)) {
    throw new Error('cloud_current_position_invalid')
  }

  const collection = database.collection('investment_positions')
  let current = await readRecord(collection, documentId, record)
  if (!current) {
    try {
      await collection.add({ ...record, _id: documentId })
      return
    } catch (createError) {
      // A competing device may have created this deterministic ID after our
      // first read. Re-read; if it still does not exist, retain the real error.
      current = await readRecord(collection, documentId, record)
      if (!current) throw createError
    }
  }

  assertSameOwner(current, record)
  if (!isValidDate(current.as_of)) throw new Error('cloud_current_position_as_of_invalid')
  if (current.as_of > record.as_of) throw new Error('cloud_current_position_newer_than_local')
  if (typeof current.updated_at !== 'string' || !current.updated_at) {
    throw new Error('cloud_current_position_version_missing')
  }

  const currentUpdatedAt = typeof current.updated_at === 'string' ? Date.parse(current.updated_at) : Number.NaN
  const nextUpdatedAt = new Date(Math.max(Date.now(), Number.isFinite(currentUpdatedAt) ? currentUpdatedAt + 1 : 0)).toISOString()
  const updateRecord = { ...record, updated_at: nextUpdatedAt }

  const result = await collection.where({
    _id: documentId,
    userId: record.userId,
    asset_key: record.asset_key,
    as_of: database.command.lte(record.as_of),
    updated_at: current.updated_at
  }).update(updateRecord)

  if (result.updated === 1) return

  // The row may have changed since the read. Never acknowledge a zero-match
  // conditional write; report newer rows separately for actionable UI status.
  const latest = await readRecord(collection, documentId, record)
  if (latest) {
    assertSameOwner(latest, record)
    if (isValidDate(latest.as_of) && latest.as_of > record.as_of) {
      throw new Error('cloud_current_position_newer_than_local')
    }
  }
  throw new Error('cloud_current_position_changed_retry_sync')
}

/** Compare-and-set a date-keyed history document by its last confirmed version. */
export async function upsertInvestmentCloudSnapshot(
  database: InvestmentCloudDatabase,
  documentId: string,
  record: InvestmentCloudSnapshotRecord
): Promise<void> {
  if (!documentId || !record.userId || !record.asset_key || !isValidDate(record.as_of) ||
    !record.operation_id || !isValidRecordedAt(record.recorded_at)) {
    throw new Error('cloud_snapshot_invalid')
  }

  const collection = database.collection('investment_snapshots')
  let current = await readRecord(collection, documentId, record)
  if (!current) {
    try {
      await collection.add({ ...record, _id: documentId })
      return
    } catch (createError) {
      current = await readRecord(collection, documentId, record)
      if (!current) throw createError
    }
  }

  assertSameOwner(current, record)
  if (current.as_of !== record.as_of) throw new Error('cloud_snapshot_identity_conflict')
  if (typeof current.operation_id !== 'string' || !current.operation_id ||
    typeof current.recorded_at !== 'string' || !isValidRecordedAt(current.recorded_at)) {
    throw new Error('cloud_snapshot_version_missing')
  }
  const version = { operation_id: current.operation_id, recorded_at: current.recorded_at }
  if (version.operation_id === record.operation_id) {
    if (sameRecordFields(current, record)) return
    throw new Error('cloud_snapshot_operation_conflict')
  }
  if (Date.parse(version.recorded_at) > Date.parse(record.recorded_at)) {
    throw new Error('cloud_snapshot_newer_than_local')
  }

  const result = await collection.where({
    _id: documentId,
    userId: record.userId,
    asset_key: record.asset_key,
    as_of: record.as_of,
    operation_id: version.operation_id,
    recorded_at: version.recorded_at
  }).update(record)
  if (result.updated === 1) return

  const latest = await readRecord(collection, documentId, record)
  if (latest) {
    assertSameOwner(latest, record)
    if (latest.operation_id === record.operation_id && sameRecordFields(latest, record)) return
    if (typeof latest.recorded_at === 'string' && isValidRecordedAt(latest.recorded_at) &&
      Date.parse(latest.recorded_at) > Date.parse(record.recorded_at)) {
      throw new Error('cloud_snapshot_newer_than_local')
    }
  }
  throw new Error('cloud_snapshot_changed_retry_sync')
}

async function readRecord(
  collection: CloudCollection,
  documentId: string,
  identity: InvestmentCloudRecord
): Promise<InvestmentCloudRecord | null> {
  // Include the owner in every read query so CloudBase per-document rules can
  // prove the current account scope, including deterministic-ID lookups.
  const result = await collection.where({
    _id: documentId,
    userId: identity.userId,
    asset_key: identity.asset_key
  }).get()
  const data = result.data
  const record = Array.isArray(data) ? data[0] : data
  if (record === undefined || record === null) return null
  if (typeof record !== 'object' || Array.isArray(record)) throw new Error('cloud_current_position_invalid')
  return record as InvestmentCloudRecord
}

function assertSameOwner(current: InvestmentCloudRecord, incoming: InvestmentCloudRecord): void {
  if (current.userId !== incoming.userId || current.asset_key !== incoming.asset_key) {
    throw new Error('cloud_current_position_identity_conflict')
  }
}

function sameRecordFields(current: InvestmentCloudRecord, incoming: InvestmentCloudRecord): boolean {
  return Object.entries(incoming).every(([key, value]) => JSON.stringify(current[key]) === JSON.stringify(value))
}

function isValidDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return year > 0 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function isValidRecordedAt(value: string): boolean {
  return value.length > 0 && Number.isFinite(Date.parse(value))
}
