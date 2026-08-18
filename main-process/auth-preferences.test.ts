import { describe, expect, it, vi } from 'vitest'
import { disableAutoLoginAfterLogout, logoutAndDisableAutoLogin } from './auth-preferences'

describe('disableAutoLoginAfterLogout', () => {
  it('revokes automatic session restoration while preserving a remembered account', async () => {
    const load = vi.fn().mockResolvedValue({ identifier: '13800138000', rememberAccount: true, autoLogin: true })
    const save = vi.fn().mockResolvedValue(undefined)

    await disableAutoLoginAfterLogout(load, save)

    expect(save).toHaveBeenCalledWith('13800138000', true, false)
  })

  it('does not restore an identifier when the account was not remembered', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    await disableAutoLoginAfterLogout(
      vi.fn().mockResolvedValue({ identifier: '13800138000', rememberAccount: false, autoLogin: true }),
      save
    )
    expect(save).toHaveBeenCalledWith('', false, false)
  })

  it('clears the CloudBase session before revoking automatic login on logout', async () => {
    const events: string[] = []
    const logout = vi.fn().mockImplementation(async () => { events.push('logout') })
    const load = vi.fn().mockResolvedValue({ identifier: '13800138000', rememberAccount: true, autoLogin: true })
    const save = vi.fn().mockImplementation(async () => { events.push('save') })

    await logoutAndDisableAutoLogin(logout, load, save)

    expect(save).toHaveBeenCalledWith('13800138000', true, false)
    expect(events).toEqual(['logout', 'save'])
  })
})
