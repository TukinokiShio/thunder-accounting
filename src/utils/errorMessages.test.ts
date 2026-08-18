import { describe, expect, it } from 'vitest'
import { friendlyError } from './errorMessages'

describe('friendlyError', () => {
  it('translates CloudBase validation-code mismatch errors from IPC wrappers into Chinese', () => {
    expect(friendlyError(new Error("Error invoking remote method 'auth:register': Error: phone or email does not match validation code"), 'zh'))
      .toBe('验证码错误或已过期，请重新获取')
  })

  it('does not expose an unknown English backend error to Chinese users', () => {
    expect(friendlyError(new Error('unrecognized cloud backend failure'), 'zh')).toBe('操作失败，请重试')
  })
})
