import { createHash } from 'node:crypto'

/** A CloudBase document key stable across devices and isolated by logged-in UID. */
export function investmentDocumentId(userId: string, assetKey: string): string {
  return createHash('sha256').update(`${userId}\0${assetKey}`, 'utf8').digest('hex')
}

/** Stable per-asset/date document key for idempotent confirmed snapshot uploads. */
export function investmentSnapshotDocumentId(userId: string, assetKey: string, asOf: string): string {
  return createHash('sha256').update(`${userId}\0${assetKey}\0${asOf}`, 'utf8').digest('hex')
}
