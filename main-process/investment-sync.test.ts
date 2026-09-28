// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { retryPendingInvestmentSync } from './investment-sync'
import type { InvestmentOutboxRow, InvestmentPositionRow } from './database/index'

function position(quantity: string): InvestmentPositionRow {
  return {
    id: 1, cloud_id: null, created_at: '2026-09-28T00:00:00.000Z', updated_at: '2026-09-28T00:00:00.000Z',
    sync_status: 'pending', sync_error: null, asset_key: 'BROKER-A:US:FIXTURE', name: 'Synthetic Fund',
    asset_type: 'fund', quantity, cost_basis: '100.00', market_value: null, currency: 'USD',
    as_of: '2026-09-28', source_note: 'synthetic fixture', quantity_kind: 'units', cost_basis_kind: 'total',
    cash_flows: [], cash_flows_complete: true
  }
}

function queued(revision: number): InvestmentOutboxRow {
  return { asset_key: 'BROKER-A:US:FIXTURE', operation: 'upsert', status: 'pending', error: null, revision, updated_at: `2026-09-28T00:00:0${revision}.000Z` }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve: (value: T) => resolve(value) }
}

describe('investment sync acknowledgements', () => {
  it('does not write an old account response into the newly active account', async () => {
    let sessionUser = 'user-a'
    let databaseUser = 'user-a'
    const request = deferred<string>()
    const remoteWrites: string[] = []
    const acknowledged: string[] = []
    const task = retryPendingInvestmentSync({
      isLoggedIn: () => true,
      getSessionUserId: () => sessionUser,
      getDatabaseUserId: () => databaseUser,
      getOutbox: () => [queued(1)],
      getPositions: () => [position('1')],
      upsert: () => { remoteWrites.push(sessionUser); return request.promise },
      remove: async () => {},
      complete: (userId) => { acknowledged.push(userId); return false }
    })

    sessionUser = 'user-b'
    databaseUser = 'user-b'
    request.resolve('cloud-id-user-a')
    await task

    expect(remoteWrites).toEqual(['user-a'])
    expect(acknowledged).toEqual([])
  })

  it('leaves a newer holding revision pending when an older cloud write finishes late', async () => {
    const request = deferred<string>()
    let revision = 1
    let current = position('1')
    let completed: number | null = null
    const firstTask = retryPendingInvestmentSync({
      isLoggedIn: () => true,
      getSessionUserId: () => 'user-a',
      getDatabaseUserId: () => 'user-a',
      getOutbox: () => [queued(revision)],
      getPositions: () => [current],
      upsert: (sent) => { expect(sent.quantity).toBe('1'); return request.promise },
      remove: async () => {},
      complete: (_userId, _key, expectedRevision) => {
        if (revision !== expectedRevision) return false
        completed = expectedRevision
        return true
      }
    })

    revision = 2
    current = position('2')
    request.resolve('cloud-id-old')
    const oldResult = await firstTask
    expect(oldResult.synced).toBe(0)
    expect(completed).toBeNull()

    const nextResult = await retryPendingInvestmentSync({
      isLoggedIn: () => true,
      getSessionUserId: () => 'user-a',
      getDatabaseUserId: () => 'user-a',
      getOutbox: () => [queued(revision)],
      getPositions: () => [current],
      upsert: async (sent) => { expect(sent.quantity).toBe('2'); return 'cloud-id-new' },
      remove: async () => {},
      complete: (_userId, _key, expectedRevision) => {
        if (revision !== expectedRevision) return false
        completed = expectedRevision
        return true
      }
    })
    expect(nextResult.synced).toBe(1)
    expect(completed).toBe(2)
  })
})
