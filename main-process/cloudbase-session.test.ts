import { describe, expect, it, vi } from 'vitest'
import { bindCloudbaseUserDatabase, bindCloudbaseUserDatabaseWithRefresh, isAlreadyBoundSdkCredentialPair, isCurrentSdkTokenRefresh, isSdkTokenRefreshForBoundLineage, isExplicitAccessTokenExpiredError, safeCloudbaseErrorCode, serializeCloudDatabase, SerialQueue, SingleFlight } from './cloudbase-session'

function fakeClient(userId: unknown, error: unknown = null) {
  const database = { identity: 'session-database' }
  type FakeSdkSession = { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; expires_at?: unknown } | null
  const sdkSession = {
    access_token: 'sdk-rotated-access',
    refresh_token: 'sdk-rotated-refresh',
    expires_in: 1800,
    expires_at: new Date('2026-09-29T12:30:00.000Z')
  }
  const setSession = vi.fn(async (): Promise<{ data: { user: { id: unknown }; session: FakeSdkSession }; error: unknown }> => ({
    data: { user: { id: userId }, session: sdkSession }, error
  }))
  const getAuth = vi.fn(() => ({ setSession }))
  const getDatabase = vi.fn(() => database)
  return { client: { auth: getAuth, database: getDatabase }, database, setSession, getAuth, getDatabase }
}

describe('CloudBase user-session database binding', () => {
  it('ignores delayed refresh notifications when the SDK credential store is already bound', () => {
    const alreadyBound = { access_token: 'active-access', refresh_token: 'active-refresh', user: null }
    expect(isAlreadyBoundSdkCredentialPair('active-access', 'active-refresh',
      'active-access', 'active-refresh', alreadyBound)).toBe(true)
    expect(isAlreadyBoundSdkCredentialPair('active-access', 'active-refresh',
      'active-access', 'active-refresh', { ...alreadyBound, access_token: 'rotated-access' })).toBe(false)
    expect(isAlreadyBoundSdkCredentialPair('active-access', 'active-refresh',
      'other-access', 'other-refresh', alreadyBound)).toBe(false)
  })

  it('accepts background token rotations only for the currently bound token lineage and UID', () => {
    const rotated = {
      access_token: 'sdk-new-access',
      refresh_token: 'sdk-new-refresh',
      user: { id: 'fixture-user-a' }
    }

    expect(isCurrentSdkTokenRefresh('fixture-user-a', 'sdk-old-access', 'sdk-old-refresh', 'sdk-old-access', 'sdk-old-refresh', rotated)).toBe(true)
    expect(isCurrentSdkTokenRefresh('fixture-user-b', 'sdk-old-access', 'sdk-old-refresh', 'sdk-old-access', 'sdk-old-refresh', rotated)).toBe(false)
    expect(isCurrentSdkTokenRefresh('fixture-user-a', 'new-login-access', 'new-login-refresh', 'sdk-old-access', 'sdk-old-refresh', rotated)).toBe(false)
    expect(isCurrentSdkTokenRefresh('fixture-user-a', 'sdk-old-access', 'sdk-old-refresh', 'sdk-old-access', 'sdk-old-refresh', {
      ...rotated, refresh_token: ''
    })).toBe(false)
  })

  it('recognizes a rotated credential lineage with missing identity so callers can fail closed', () => {
    const rotatedWithoutIdentity = {
      access_token: 'sdk-new-access',
      refresh_token: 'sdk-new-refresh',
      user: null
    }
    expect(isSdkTokenRefreshForBoundLineage('fixture-user-a', 'sdk-old-access', 'sdk-old-refresh',
      'sdk-old-access', 'sdk-old-refresh', rotatedWithoutIdentity)).toBe(true)
    expect(isCurrentSdkTokenRefresh('fixture-user-a', 'sdk-old-access', 'sdk-old-refresh',
      'sdk-old-access', 'sdk-old-refresh', rotatedWithoutIdentity)).toBe(false)
    expect(isSdkTokenRefreshForBoundLineage('fixture-user-a', 'sdk-old-access', 'sdk-old-refresh',
      'sdk-old-access', 'sdk-old-refresh', { ...rotatedWithoutIdentity, refresh_token: '' })).toBe(false)
    expect(isSdkTokenRefreshForBoundLineage('fixture-user-a', 'sdk-old-access', 'sdk-old-refresh',
      'sdk-old-access', 'sdk-old-refresh', { access_token: 'sdk-old-access', refresh_token: 'sdk-old-refresh' })).toBe(false)
  })

  it('coalesces concurrent refresh attempts for a rotating refresh token', async () => {
    const singleFlight = new SingleFlight<string, string>()
    const redeemRefreshToken = vi.fn().mockResolvedValue('rotated-session')

    const first = singleFlight.run('fixture-user-a', redeemRefreshToken)
    const second = singleFlight.run('fixture-user-a', redeemRefreshToken)

    await expect(Promise.all([first, second])).resolves.toEqual(['rotated-session', 'rotated-session'])
    expect(redeemRefreshToken).toHaveBeenCalledOnce()
    expect(singleFlight.getPending('fixture-user-a')).toBeNull()

    await singleFlight.run('fixture-user-a', redeemRefreshToken)
    expect(redeemRefreshToken).toHaveBeenCalledTimes(2)
  })

  it('serializes credential operations across different signed-in accounts', async () => {
    const queue = new SerialQueue()
    const events: string[] = []
    let releaseRefresh!: () => void
    const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve })
    const accountARefresh = queue.run(async () => {
      events.push('account-a-refresh-start')
      await refreshGate
      events.push('account-a-refresh-finish')
    })
    const accountBBind = queue.run(() => { events.push('account-b-bind') })

    await Promise.resolve()
    expect(events).toEqual(['account-a-refresh-start'])
    releaseRefresh()
    await Promise.all([accountARefresh, accountBBind])
    expect(events).toEqual(['account-a-refresh-start', 'account-a-refresh-finish', 'account-b-bind'])
  })

  it('serializes terminal cloud database calls with auth refreshes and preserves SDK method receivers', async () => {
    const queue = new SerialQueue()
    const events: string[] = []
    let releaseRequest!: () => void
    const requestGate = new Promise<void>((resolve) => { releaseRequest = resolve })
    const query = {
      where() { return this },
      get() {
        expect(this).toBe(query)
        events.push('database-request-start')
        return requestGate.then(() => { events.push('database-request-finish') })
      }
    }
    const database = { collection() { return query } }
    const serialized = serializeCloudDatabase(database, queue)
    const request = serialized.collection().where().get()
    const refresh = queue.run(() => { events.push('auth-refresh') })

    await Promise.resolve()
    expect(events).toEqual(['database-request-start'])
    releaseRequest()
    await Promise.all([request, refresh])
    expect(events).toEqual(['database-request-start', 'database-request-finish', 'auth-refresh'])
  })

  it('accepts only the UID confirmed by JS SDK for the externally authenticated session', async () => {
    const fixture = fakeClient('fixture-user-a')
    const bound = await bindCloudbaseUserDatabase(fixture.client, {
      access_token: 'synthetic-access', refresh_token: 'synthetic-refresh'
    }, 'fixture-user-a')

    expect(bound).toEqual({
      userId: 'fixture-user-a',
      database: fixture.database,
      session: {
        access_token: 'sdk-rotated-access',
        refresh_token: 'sdk-rotated-refresh',
        expires_in: 1800,
        expires_at: new Date('2026-09-29T12:30:00.000Z')
      }
    })
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

  it('requires and returns the rotated credential pair from the SDK session', async () => {
    const fixture = fakeClient('fixture-user-a')
    const supplied = { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' }
    const result = await bindCloudbaseUserDatabase(fixture.client, supplied, 'fixture-user-a')

    expect(result.session).toEqual({
      access_token: 'sdk-rotated-access',
      refresh_token: 'sdk-rotated-refresh',
      expires_in: 1800,
      expires_at: new Date('2026-09-29T12:30:00.000Z')
    })
    expect(result.session.refresh_token).not.toBe(supplied.refresh_token)

    fixture.setSession.mockResolvedValueOnce({ data: { user: { id: 'fixture-user-a' }, session: null }, error: null })
    await expect(bindCloudbaseUserDatabase(fixture.client, supplied, 'fixture-user-a'))
      .rejects.toThrow('cloud_session_rotation_incomplete')
    expect(fixture.getDatabase).toHaveBeenCalledOnce()
  })

  it('converts SDK transport failures into a generic session error without exposing details', async () => {
    const fixture = fakeClient('fixture-user-a')
    fixture.setSession.mockRejectedValueOnce(new Error('synthetic transport detail'))
    await expect(bindCloudbaseUserDatabase(fixture.client, {
      access_token: 'synthetic-access', refresh_token: 'synthetic-refresh'
    }, 'fixture-user-a')).rejects.toThrow('cloud_session_rejected')
    expect(fixture.getDatabase).not.toHaveBeenCalled()
  })

  it('preserves safe AuthError status and numeric codes through the binding wrapper', async () => {
    const authError = Object.assign(new Error('private token detail'), {
      name: 'AuthError', code: 'unknown', status: 'unauthenticated', errorCode: 16,
      category: 'INVALID_CREDENTIALS', requestId: 'private-request-id'
    })
    const fixture = fakeClient('fixture-user-a', authError)

    await expect(bindCloudbaseUserDatabase(fixture.client, {
      access_token: 'synthetic-access', refresh_token: 'synthetic-refresh'
    }, 'fixture-user-a')).rejects.toThrow('cloud_session_rejected:unauthenticated')
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
    expect(safeCloudbaseErrorCode({
      name: 'AuthError', code: 'unknown', status: 'unauthenticated', errorCode: 16,
      category: 'INVALID_CREDENTIALS', requestId: 'private-request-id', message: 'private token detail'
    })).toBe('unauthenticated')
    expect(safeCloudbaseErrorCode({
      name: 'AuthError', code: '16', errorCode: 16, category: 'INVALID_CREDENTIALS',
      requestId: 'private-request-id', message: 'private token detail'
    })).toBe('unauthenticated')
    expect(safeCloudbaseErrorCode({
      name: 'AuthError', code: 'unknown', errorCode: 14, category: 'SERVICE_ERROR',
      requestId: 'private-request-id', message: 'private token detail'
    })).toBe('unavailable')
    expect(safeCloudbaseErrorCode({
      name: 'AuthError', code: 'unknown', category: 'SERVICE_ERROR',
      requestId: 'private-request-id', message: 'private token detail'
    })).toBe('cloud_auth_service_error')
    expect(safeCloudbaseErrorCode({
      name: 'AuthError', code: 'invalid_credentials', status: 'unauthenticated', errorCode: 13,
      category: 'UNKNOWN', requestId: 'private-request-id', message: 'private token detail'
    })).toBe('cloud_auth_metadata_conflict')
    expect(safeCloudbaseErrorCode({
      name: 'AuthError', code: 'unknown', category: 'UNKNOWN',
      requestId: 'private-request-id', message: 'private token detail'
    })).toBe('cloud_auth_unknown_error')
    expect(safeCloudbaseErrorCode(new Error('cloud_session_or_local_database_unavailable'))).toBe('cloud_session_or_local_database_unavailable')
    expect(safeCloudbaseErrorCode(new Error('cloud_session_identity_unconfirmed'))).toBe('cloud_session_identity_unconfirmed')
    expect(safeCloudbaseErrorCode(new Error('cloud_session_rotation_unverified'))).toBe('cloud_session_rotation_unverified')
    expect(safeCloudbaseErrorCode(new Error('cloud_investment_positions_payload_invalid'))).toBe('cloud_investment_positions_payload_invalid')
    expect(safeCloudbaseErrorCode(Object.assign(new Error('private detail'), { code: 'PRIVATE_SERVICE_CODE', errMsg: 'secret token' }))).toBe('cloud_unknown_error')
    expect(safeCloudbaseErrorCode({ code: 'DATABASE_PERMISSION_DENIED', error_code: 'TOKEN_EXPIRED' })).toBe('cloud_unknown_error')
    expect(fixture.getDatabase).not.toHaveBeenCalled()
  })

  it('refreshes exactly once after explicit expiry, then confirms the same UID', async () => {
    const fixture = fakeClient('fixture-user-a')
    const expired = Object.assign(new Error('private SDK detail'), { code: 'token_expired' })
    fixture.setSession.mockRejectedValueOnce(expired)
    fixture.setSession.mockResolvedValueOnce({
      data: {
        user: { id: 'fixture-user-a' },
        session: { access_token: 'final-sdk-access', refresh_token: 'final-sdk-refresh', expires_in: 3600 }
      },
      error: null
    })
    const refreshTokens = vi.fn().mockResolvedValue({ access_token: 'refreshed-access', refresh_token: 'refreshed-refresh' })

    const result = await bindCloudbaseUserDatabaseWithRefresh(fixture.client, {
      access_token: 'synthetic-access', refresh_token: 'synthetic-refresh'
    }, 'fixture-user-a', refreshTokens)

    expect(result).toMatchObject({ userId: 'fixture-user-a', session: { access_token: 'final-sdk-access', refresh_token: 'final-sdk-refresh', expires_in: 3600 } })
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
