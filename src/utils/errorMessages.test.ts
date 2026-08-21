import { describe, expect, it } from 'vitest'
import { friendlyError } from './errorMessages'

describe('friendlyError', () => {
  it('translates CloudBase validation-code mismatch errors from IPC wrappers into Chinese', () => {
    expect(friendlyError(new Error("Error invoking remote method 'auth:register': Error: phone or email does not match validation code"), 'zh'))
      .toBe('验证码错误或已过期，请重新获取')
  })

  it('does not expose an unknown English backend error to Chinese users', () => {
    expect(friendlyError(new Error('unrecognized cloud backend failure'), 'zh')).toContain('云端服务暂时不可用')
  })

  it('explains unregistered verification-code targets and missing CloudBase IDs', () => {
    expect(friendlyError(new Error('account_not_found'), 'zh')).toBe('账号尚未注册')
    expect(friendlyError(new Error('verification_code_missing_id'), 'zh')).toContain('验证码编号')
  })

  it('explains the deletion-job deployment failure instead of claiming cleanup is pending', () => {
    expect(friendlyError(new Error('account_delete_job_unavailable'), 'zh'))
      .toContain('account_deletion_jobs')
  })

  it('distinguishes expired sessions from an invalid deletion verification code', () => {
    expect(friendlyError(new Error('account_delete_session_expired'), 'zh')).toContain('重新登录')
    expect(friendlyError(new Error('account_delete_verification_failed'), 'zh')).toContain('验证码错误或已过期')
  })
})
