import { describe, expect, it, vi } from 'vitest'
import { bindCloudbaseUserDatabase } from './cloudbase-session'

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

  it('rejects incomplete sessions before calling the SDK', async () => {
    const fixture = fakeClient('fixture-user-a')
    await expect(bindCloudbaseUserDatabase(fixture.client, {
      access_token: '', refresh_token: 'synthetic-refresh'
    }, 'fixture-user-a')).rejects.toThrow('cloud_session_incomplete')
    expect(fixture.setSession).not.toHaveBeenCalled()
  })
})
