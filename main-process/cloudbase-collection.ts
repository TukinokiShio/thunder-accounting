export interface CloudBaseCollectionPage<T> {
  data?: T[]
}

export interface OptionalCloudBasePage<T> {
  data: T[]
  collectionAvailable: boolean
}

/**
 * CloudBase reports a missing collection with the documented, specific code
 * DATABASE_COLLECTION_NOT_EXIST. Other failures (permission/network/etc.) must
 * not be mistaken for an empty collection.
 */
export function isCloudBaseCollectionMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as { code?: unknown; errCode?: unknown }
  return record.code === 'DATABASE_COLLECTION_NOT_EXIST' || record.errCode === 'DATABASE_COLLECTION_NOT_EXIST'
}

/** Treat only a specifically missing collection as unavailable/empty. */
export async function readOptionalCloudBaseCollectionPage<T>(
  read: () => Promise<CloudBaseCollectionPage<T>>
): Promise<OptionalCloudBasePage<T>> {
  try {
    const result = await read()
    return { data: result.data || [], collectionAvailable: true }
  } catch (error) {
    if (isCloudBaseCollectionMissing(error)) return { data: [], collectionAvailable: false }
    throw error
  }
}
