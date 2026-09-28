import { describe, expect, it } from 'vitest'
import { isCloudBaseCollectionMissing, readOptionalCloudBaseCollectionPage } from './cloudbase-collection'

describe('optional CloudBase history collection reads', () => {
  it('marks a specifically missing collection as unavailable with no rows', async () => {
    const result = await readOptionalCloudBaseCollectionPage(async () => {
      throw Object.assign(new Error('collection is missing'), { code: 'DATABASE_COLLECTION_NOT_EXIST' })
    })
    expect(result).toEqual({ data: [], collectionAvailable: false })
  })

  it('accepts the SDK errCode spelling for the same documented code', () => {
    expect(isCloudBaseCollectionMissing({ errCode: 'DATABASE_COLLECTION_NOT_EXIST' })).toBe(true)
  })

  it.each([
    { code: 'DATABASE_PERMISSION_DENIED' },
    { code: 'DATABASE_REQUEST_FAILED' },
    { code: 'NETWORK_ERROR' },
    { code: 'DATABASE_NOT_FOUND' }
  ])('does not hide unrelated failures %#', async (error) => {
    await expect(readOptionalCloudBaseCollectionPage(async () => { throw error }))
      .rejects.toBe(error)
  })

  it('marks an existing but empty collection as available', async () => {
    await expect(readOptionalCloudBaseCollectionPage(async () => ({ data: [] })))
      .resolves.toEqual({ data: [], collectionAvailable: true })
  })
})
