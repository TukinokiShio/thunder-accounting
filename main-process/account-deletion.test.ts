import { describe, expect, it } from 'vitest'
import { resolveAccountDeletionResponse } from './account-deletion'

describe('resolveAccountDeletionResponse', () => {
  it('accepts completed and pending cleanup responses', () => {
    expect(resolveAccountDeletionResponse(200, { code: 0 })).toEqual({ cleanupPending: false })
    expect(resolveAccountDeletionResponse(200, { code: 202, cleanup_pending: true })).toEqual({ cleanupPending: true })
  })

  it('makes missing deletion-job infrastructure actionable', () => {
    expect(() => resolveAccountDeletionResponse(503, { code: 503, message: 'deletion_job_unavailable' }))
      .toThrow('account_delete_job_unavailable')
  })

  it('separates invalid sessions from invalid deletion verification codes', () => {
    expect(() => resolveAccountDeletionResponse(401, { code: 401, message: 'invalid_session' }))
      .toThrow('account_delete_session_expired')
    expect(() => resolveAccountDeletionResponse(200, { code: 401, message: 'auth_delete_failed' }))
      .toThrow('account_delete_verification_failed')
  })

  it('labels bare HTTP service failures without claiming the account was deleted', () => {
    expect(() => resolveAccountDeletionResponse(503, {})).toThrow('account_delete_service_unavailable')
    expect(() => resolveAccountDeletionResponse(503, { code: 0 })).toThrow('account_delete_service_unavailable')
  })
})
