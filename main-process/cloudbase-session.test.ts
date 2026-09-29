import { describe, expect, it, vi } from 'vitest'
import { bindCloudbaseUserDatabase, bindCloudbaseUserDatabaseWithRefresh, isExplicitAccessTokenExpiredError, safeCloudbaseErrorCode } from './cloudbase-session'

function fakeClient(userId: unknown, error: unknown = null) {
  const database = { identity: 'session-database' }
  const setSession = vi.fn(async () => ({ data: { user: { id: userId } }, error }))
  const getAuth = vi.fn(() => ({ setSession }))
  const getDatabase = vi.fn(() => database)
  return { client: { auth: getAuth, database: getDatabase }, database, setSession, getAuth, getDatabase }
}

describe('CloudBase user-session database binding', () => {
  it('accepts only the UID confirmed by JS SDK for the externally authenticated session', async () => {
    const fixture = fakeClient('fixture-user-a')
    const bound = await bindCloudbaseUserDatabase(fixture.client, {
      access_token: 'synthetic-access', refresh_token: 'synthetic-refresh'
    }, 'fixture-user-a')

    expect(bound).toEqual({ userId: 'fixture-user-a', database: fixture.database })
    expect(fixture.getAuth).toHaveBeenCalledOnce()
    expect(fixture.setSession).toHaveBeenCalledOnce()
    expect(fixture.getDatabase).toHaveBeenCalledOnce()
  })

  it('does not return a database when the SDK identity differs from the local account', async () => {
    const fixture = fakeClient('fixture-user-b')
    await expect(bindCloudbaseUserDatabase(fixture.client, {
      access_token: 'synthetic-access', refresh_token: 'synthetic-refresh'
    }, 'fixture-user-a')).rejects.toThrow('cloud_session_uid_mismatch')
    expect(fixture.getDatabase).not.toHaveBeenCalled()
    expect(fixture.getAuth).toHaveBeenCalledOnce()
  })

  it('does not return a database when CloudBase rejects the supplied session', async () => {
    const fixture = fakeClient('fixture-user-a', new Error('synthetic rejection'))
    await expect(bindCloudbaseUserDatabase(fixture.client, {
      access_token: 'synthetic-access', refresh_token: 'synthetic-refresh'
    }, 'fixture-user-a')).rejects.toThrow('cloud_session_rejected')
    expect(fixture.getDatabase).not.toHaveBeenCalled()
  })

  it('converts SDK transport failures into a generic session error without exposing details', async () => {
    const fixture = fakeClient('fixture-user-a')
    fixture.setSession.mockRejectedValueOnce(new Error('synthetic transport detail'))
    await expect(bindCloudbaseUserDatabase(fixture.client, {
      access_token: 'synthetic-access', refresh_token: 'synthetic-refresh'
    }, 'fixture-user-a')).rejects.toThrow('cloud_session_rejected')
    expect(fixture.getDatabase).not.toHaveBeenCalled()
  })

  it('keeps only a safe machine code and recognizes explicit token expiry', async () => {
    const sensitiveMessage = new Error('request contained a secret and private endpoint')
    Object.assign(sensitiveMessage, { code: 'TOKEN_EXPIRED', status: 401, requestId: 'private-request-id' })
    const fixture = fakeClient('fixture-user-a')
    fixture.setSession.mockRejectedValueOnce(sensitiveMessage)

    await expect(bindCloudbaseUserDatabase(fixture.client, {
      access_token: 'synthetic-access', refresh_token: 'synthetic-refresh'
    }, 'fixture-user-a')).rejects.toThrow('cloud_session_rejected:token_expired')
    expect(safeCloudbaseErrorCode(sensitiveMessage)).toBe('token_expired')
    expect(isExplicitAccessTokenExpiredError(new Error('cloud_session_rejected:token_expired'))).toBe(true)
    expect(isExplicitAccessTokenExpiredError(new Error('cloud_session_rejected:cloud_unknown_error'))).toBe(false)
    expect(isExplicitAccessTokenExpiredError({ error: 'token_expired' })).toBe(true)
    expect(isExplicitAccessTokenExpiredError({ error: 'invalid_credentials', status: 401 })).toBe(false)
    const conflictingExpiryCodes = { error_code: 'invalid_credentials', error: 'token_expired', status: 401 }
    expect(safeCloudbaseErrorCode(conflictingExpiryCodes)).toBe('cloud_unknown_error')
    expect(isExplicitAccessTokenExpiredError(conflictingExpiryCodes)).toBe(false)
    expect(safeCloudbaseErrorCode({ code: 'private-session-token-123' })).toBe('cloud_unknown_error')
    expect(safeCloudbaseErrorCode(new Error('cloud_session_rejected:syntheticsecret123'))).toBe('cloud_unknown_error')
    expect(safeCloudbaseErrorCode({ code: 'DATABASE_PERMISSION_DENIED' })).toBe('database_permission_denied')
    expect(safeCloudbaseErrorCode({ errCode: 'DATABASE_COLLECTION_NOT_EXIST' })).toBe('database_collection_not_exist')
    expect(safeCloudbaseErrorCode({ response: { data: { code: 'DATABASE_TIMEOUT' } } })).toBe('database_timeout')
    expect(safeCloudbaseErrorCode(Object.assign(new Error('private SDK message'), { code: 'INVALID_PARAM', requestId: 'private-request-id' }))).toBe('invalid_param')
    expect(safeCloudbaseErrorCode({ code: 'DATABASE_TRANSACTION_CONFLICT' })).toBe('database_transaction_conflict')
    expect(safeCloudbaseErrorCode(new Error('cloud_session_or_local_database_unavailable'))).toBe('cloud_session_or_local_database_unavailable')
    expect(safeCloudbaseErrorCode(new Error('cloud_investment_positions_payload_invalid'))).toBe('cloud_investment_positions_payload_invalid')
    expect(safeCloudbaseErrorCode(Object.assign(new Error('private detail'), { code: 'PRIVATE_SERVICE_CODE', errMsg: 'secret token' }))).toBe('cloud_unknown_error')
    expect(safeCloudbaseErrorCode({ code: 'DATABASE_PERMISSION_DENIED', error_code: 'TOKEN_EXPIRED' })).toBe('cloud_unknown_error')
    expect(fixture.getDatabase).not.toHaveBeenCalled()
  })

  it('refreshes exactly once after explicit expiry, then confirms the same UID', async () => {
    const fixture = fakeClient('fixture-user-a')
    const expired = Object.assign(new Error('private SDK detail'), { code: 'token_expired' })
    fixture.setSession.mockRejectedValueOnce(expired)
    fixture.setSession.mockResolvedValueOnce({ data: { user: { id: 'fixture-user-a' } }, error: null })
    const refreshTokens = vi.fn().mockResolvedValue({ access_token: 'refreshed-access', refresh_token: 'refreshed-refresh' })

    const result = await bindCloudbaseUserDatabaseWithRefresh(fixture.client, {
      access_token: 'synthetic-access', refresh_token: 'synthetic-refresh'
    }, 'fixture-user-a', refreshTokens)

    expect(result).toMatchObject({ userId: 'fixture-user-a', session: { access_token: 'refreshed-access', refresh_token: 'refreshed-refresh' } })
    expect(refreshTokens).toHaveBeenCalledOnce()
    expect(fixture.setSession).toHaveBeenCalledTimes(2)
    expect(fixture.setSession).toHaveBeenLastCalledWith({ access_token: 'refreshed-access', refresh_token: 'refreshed-refresh' })
  })

  it('does not refresh on transport failures and does not bind a UID mismatch after refresh', async () => {
    const transportFixture = fakeClient('fixture-user-a')
    transportFixture.setSession.mockRejectedValueOnce(new Error('temporary network failure'))
    const transportRefresh = vi.fn()
    await expect(bindCloudbaseUserDatabaseWithRefresh(transportFixture.client, {
      access_token: 'synthetic-access', refresh_token: 'synthetic-refresh'
    }, 'fixture-user-a', transportRefresh)).rejects.toThrow('cloud_session_rejected:cloud_unknown_error')
    expect(transportRefresh).not.toHaveBeenCalled()

    const mismatchFixture = fakeClient('fixture-user-b')
    mismatchFixture.setSession.mockRejectedValueOnce(Object.assign(new Error('expired'), { code: 'token_expired' }))
    const mismatchRefresh = vi.fn().mockResolvedValue({ access_token: 'new-access', refresh_token: 'new-refresh' })
    await expect(bindCloudbaseUserDatabaseWithRefresh(mismatchFixture.client, {
      access_token: 'synthetic-access', refresh_token: 'synthetic-refresh'
    }, 'fixture-user-a', mismatchRefresh)).rejects.toThrow('cloud_session_uid_mismatch')
    expect(mismatchRefresh).toHaveBeenCalledOnce()
    expect(mismatchFixture.getDatabase).not.toHaveBeenCalled()
  })

  it('rejects incomplete sessions before calling the SDK', async () => {
    const fixture = fakeClient('fixture-user-a')
    await expect(bindCloudbaseUserDatabase(fixture.client, {
      access_token: '', refresh_token: 'synthetic-refresh'
    }, 'fixture-user-a')).rejects.toThrow('cloud_session_incomplete')
    expect(fixture.setSession).not.toHaveBeenCalled()
  })
})
