import { describe, expect, it } from 'vitest'
import {
  upsertInvestmentCloudCurrent,
  upsertInvestmentCloudSnapshot,
  type InvestmentCloudDatabase,
  type InvestmentCloudRecord,
  type InvestmentCloudSnapshotRecord
} from './investment-cloud-write'

interface FakeState {
  current: InvestmentCloudRecord | null
  updates: number
  adds: number
  condition: Record<string, unknown> | null
  readCondition: Record<string, unknown> | null
  beforeUpdate?: () => void
  onAdd?: (record: InvestmentCloudRecord & { _id: string }) => void
  forceZeroUpdate?: boolean
}

function fakeDatabase(state: FakeState): InvestmentCloudDatabase {
  return {
    collection: () => ({
      where: (condition) => ({
        get: async () => {
          state.readCondition = condition
          const matchesOwner = state.current?.userId === condition.userId
          const matchesAsset = state.current?.asset_key === condition.asset_key
          return { data: matchesOwner && matchesAsset ? [{ ...state.current! }] : [] }
        },
        update: async (record) => {
          state.updates++
          state.condition = condition
          state.beforeUpdate?.()
          const asOfFilter = condition.as_of as { lte?: string } | string | undefined
          const asOfMismatch = typeof asOfFilter === 'string'
            ? state.current?.as_of !== asOfFilter
            : asOfFilter?.lte !== undefined && Boolean(state.current) && state.current!.as_of > asOfFilter.lte
          if (!state.current || state.current.userId !== condition.userId ||
            state.current.asset_key !== condition.asset_key ||
            (condition.updated_at !== undefined && state.current.updated_at !== condition.updated_at) ||
            (condition.operation_id !== undefined && state.current.operation_id !== condition.operation_id) ||
            (condition.recorded_at !== undefined && state.current.recorded_at !== condition.recorded_at) ||
            asOfMismatch || state.forceZeroUpdate) return { updated: 0 }
          state.current = { ...state.current, ...record }
          return { updated: 1 }
        }
      }),
      add: async (record) => {
        state.adds++
        if (state.onAdd) state.onAdd(record)
        if (state.current) throw new Error('synthetic duplicate document ID')
        state.current = { ...record }
        return { _id: record._id }
      }
    }),
    command: { lte: (value) => ({ lte: value }) }
  }
}

function row(asOf: string, marketValue: string): InvestmentCloudRecord {
  return { userId: 'fixture-user-a', asset_key: 'SYNTH:ASSET', as_of: asOf, market_value: marketValue, updated_at: '2026-09-01T00:00:00.000Z' }
}

function snapshotRow(operationId: string, recordedAt: string, marketValue: string): InvestmentCloudSnapshotRecord {
  return {
    ...row('2026-09-28', marketValue),
    operation_id: operationId,
    recorded_at: recordedAt
  }
}

describe('monotonic CloudBase current-position writes', () => {
  it('uses an as_of-filtered update for an existing row', async () => {
    const state: FakeState = { current: row('2026-09-27', '100'), updates: 0, adds: 0, condition: null, readCondition: null }
    await upsertInvestmentCloudCurrent(fakeDatabase(state), 'synthetic-id', row('2026-09-28', '110'))

    expect(state.current).toMatchObject({ as_of: '2026-09-28', market_value: '110' })
    expect(state.readCondition).toMatchObject({ _id: 'synthetic-id', userId: 'fixture-user-a', asset_key: 'SYNTH:ASSET' })
    expect(state.condition).toMatchObject({ _id: 'synthetic-id', userId: 'fixture-user-a', asset_key: 'SYNTH:ASSET', as_of: { lte: '2026-09-28' } })
    expect(state.updates).toBe(1)
    expect(state.adds).toBe(0)
  })

  it('refuses to overwrite a cloud row whose as_of is newer', async () => {
    const state: FakeState = { current: row('2026-09-29', '120'), updates: 0, adds: 0, condition: null, readCondition: null }
    await expect(upsertInvestmentCloudCurrent(fakeDatabase(state), 'synthetic-id', row('2026-09-28', '110')))
      .rejects.toThrow('cloud_current_position_newer_than_local')
    expect(state.current).toMatchObject({ as_of: '2026-09-29', market_value: '120' })
    expect(state.updates).toBe(0)
  })

  it('detects a newer value that wins after the initial read but before the conditional write', async () => {
    const state: FakeState = { current: row('2026-09-27', '100'), updates: 0, adds: 0, condition: null, readCondition: null }
    state.beforeUpdate = () => { state.current = row('2026-09-29', '120') }
    await expect(upsertInvestmentCloudCurrent(fakeDatabase(state), 'synthetic-id', row('2026-09-28', '110')))
      .rejects.toThrow('cloud_current_position_newer_than_local')
    expect(state.current).toMatchObject({ as_of: '2026-09-29', market_value: '120' })
    expect(state.updates).toBe(1)
  })

  it('detects a same-date current-row version race by updated_at compare-and-set', async () => {
    const state: FakeState = { current: row('2026-09-28', '100'), updates: 0, adds: 0, condition: null, readCondition: null }
    state.beforeUpdate = () => {
      state.current = { ...row('2026-09-28', '115'), updated_at: '2026-09-29T14:00:00.000Z' }
    }
    await expect(upsertInvestmentCloudCurrent(fakeDatabase(state), 'synthetic-id', row('2026-09-28', '110')))
      .rejects.toThrow('cloud_current_position_changed_retry_sync')
    expect(state.current).toMatchObject({ as_of: '2026-09-28', market_value: '115' })
  })

  it('creates a missing row with a deterministic ID', async () => {
    const state: FakeState = { current: null, updates: 0, adds: 0, condition: null, readCondition: null }
    await upsertInvestmentCloudCurrent(fakeDatabase(state), 'synthetic-id', row('2026-09-28', '110'))
    expect(state.current).toMatchObject({ _id: 'synthetic-id', as_of: '2026-09-28', market_value: '110' })
    expect(state.adds).toBe(1)
    expect(state.updates).toBe(0)
  })

  it('does not read or overwrite a row owned by another user', async () => {
    const foreign = { ...row('2026-09-27', '900'), userId: 'fixture-user-b' }
    const state: FakeState = { current: foreign, updates: 0, adds: 0, condition: null, readCondition: null }
    await expect(upsertInvestmentCloudCurrent(fakeDatabase(state), 'synthetic-id', row('2026-09-28', '110')))
      .rejects.toThrow('synthetic duplicate document ID')

    expect(state.readCondition).toMatchObject({ userId: 'fixture-user-a' })
    expect(state.current).toMatchObject({ userId: 'fixture-user-b', market_value: '900' })
    expect(state.updates).toBe(0)
  })

  it('re-reads and rejects a competing newer create', async () => {
    const state: FakeState = { current: null, updates: 0, adds: 0, condition: null, readCondition: null }
    state.onAdd = () => {
      state.current = { ...row('2026-09-29', '120'), _id: 'synthetic-id' }
    }
    await expect(upsertInvestmentCloudCurrent(fakeDatabase(state), 'synthetic-id', row('2026-09-28', '110')))
      .rejects.toThrow('cloud_current_position_newer_than_local')
    expect(state.current).toMatchObject({ as_of: '2026-09-29', market_value: '120' })
    expect(state.updates).toBe(0)
  })

  it('does not treat an unexplained zero-match update as success', async () => {
    const state: FakeState = { current: row('2026-09-27', '100'), updates: 0, adds: 0, condition: null, readCondition: null }
    state.forceZeroUpdate = true
    await expect(upsertInvestmentCloudCurrent(fakeDatabase(state), 'synthetic-id', row('2026-09-28', '110')))
      .rejects.toThrow('cloud_current_position_changed_retry_sync')
  })

  it('conditionally updates a same-date history snapshot only from the version read', async () => {
    const state: FakeState = {
      current: snapshotRow('operation-before', '2026-09-28T12:00:00.000Z', '100'),
      updates: 0, adds: 0, condition: null, readCondition: null
    }
    await upsertInvestmentCloudSnapshot(fakeDatabase(state), 'synthetic-snapshot-id',
      snapshotRow('operation-after', '2026-09-28T13:00:00.000Z', '110'))
    expect(state.current).toMatchObject({ operation_id: 'operation-after', market_value: '110' })
    expect(state.readCondition).toMatchObject({ _id: 'synthetic-snapshot-id', userId: 'fixture-user-a', asset_key: 'SYNTH:ASSET' })
    expect(state.condition).toMatchObject({
      operation_id: 'operation-before', recorded_at: '2026-09-28T12:00:00.000Z'
    })
  })

  it('refuses to replace a later same-date history snapshot', async () => {
    const state: FakeState = {
      current: snapshotRow('operation-newer', '2026-09-28T14:00:00.000Z', '115'),
      updates: 0, adds: 0, condition: null, readCondition: null
    }
    await expect(upsertInvestmentCloudSnapshot(fakeDatabase(state), 'synthetic-snapshot-id',
      snapshotRow('operation-older', '2026-09-28T13:00:00.000Z', '110')))
      .rejects.toThrow('cloud_snapshot_newer_than_local')
    expect(state.current).toMatchObject({ operation_id: 'operation-newer', market_value: '115' })
    expect(state.updates).toBe(0)
  })

  it('detects a same-day snapshot that changes during the compare-and-set', async () => {
    const state: FakeState = {
      current: snapshotRow('operation-before', '2026-09-28T12:00:00.000Z', '100'),
      updates: 0, adds: 0, condition: null, readCondition: null
    }
    state.beforeUpdate = () => {
      state.current = snapshotRow('operation-racer', '2026-09-28T14:00:00.000Z', '115')
    }
    await expect(upsertInvestmentCloudSnapshot(fakeDatabase(state), 'synthetic-snapshot-id',
      snapshotRow('operation-after', '2026-09-28T13:00:00.000Z', '110')))
      .rejects.toThrow('cloud_snapshot_newer_than_local')
    expect(state.current).toMatchObject({ operation_id: 'operation-racer', market_value: '115' })
  })

  it('re-reads a competing same-date snapshot created under the deterministic ID', async () => {
    const state: FakeState = { current: null, updates: 0, adds: 0, condition: null, readCondition: null }
    state.onAdd = () => {
      state.current = snapshotRow('operation-newer', '2026-09-28T14:00:00.000Z', '115')
    }
    await expect(upsertInvestmentCloudSnapshot(fakeDatabase(state), 'synthetic-snapshot-id',
      snapshotRow('operation-older', '2026-09-28T13:00:00.000Z', '110')))
      .rejects.toThrow('cloud_snapshot_newer_than_local')
    expect(state.current).toMatchObject({ operation_id: 'operation-newer', market_value: '115' })
    expect(state.updates).toBe(0)
  })
})
