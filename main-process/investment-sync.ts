import type { InvestmentOutboxRow, InvestmentPositionRow } from './database/index'

export interface InvestmentSyncDependencies {
  isLoggedIn: () => boolean
  getSessionUserId: () => string | null
  getDatabaseUserId: () => string | null
  getOutbox: () => InvestmentOutboxRow[]
  getPositions: () => InvestmentPositionRow[]
  upsert: (position: InvestmentPositionRow) => Promise<string>
  remove: (assetKey: string) => Promise<void>
  complete: (userId: string, assetKey: string, revision: number, status: 'synced' | 'failed', error?: string | null, cloudId?: string) => boolean
}

/**
 * Drain a snapshot of the current account's durable outbox. A completion is
 * acknowledged only if that same account is still active and the outbox
 * revision still matches the row that was sent over the network.
 */
export async function retryPendingInvestmentSync(deps: InvestmentSyncDependencies): Promise<{
  attempted: number
  synced: number
  failed: number
}> {
  const sessionUserId = deps.getSessionUserId()
  const databaseUserId = deps.getDatabaseUserId()
  if (!deps.isLoggedIn() || !sessionUserId || sessionUserId !== databaseUserId) {
    return { attempted: 0, synced: 0, failed: 0 }
  }
  const stillOwnsDatabase = () => deps.isLoggedIn() &&
    deps.getSessionUserId() === sessionUserId && deps.getDatabaseUserId() === databaseUserId
  const queue = deps.getOutbox()
  let synced = 0
  let failed = 0

  for (const item of queue) {
    if (!stillOwnsDatabase()) break
    try {
      let cloudId: string | undefined
      if (item.operation === 'delete') {
        await deps.remove(item.asset_key)
      } else {
        const position = deps.getPositions().find((entry) => entry.asset_key === item.asset_key)
        if (!position) continue
        cloudId = await deps.upsert(position)
      }
      if (!stillOwnsDatabase()) break
      if (deps.complete(databaseUserId, item.asset_key, item.revision, 'synced', null, cloudId)) synced++
    } catch (error) {
      if (!stillOwnsDatabase()) break
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500)
      if (deps.complete(databaseUserId, item.asset_key, item.revision, 'failed', message)) failed++
    }
  }

  return { attempted: queue.length, synced, failed }
}
