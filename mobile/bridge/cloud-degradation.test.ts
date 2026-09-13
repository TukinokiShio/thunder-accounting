/**
 * C2 门禁：云 / 账号 / 文件对话框类方法的降级语义。
 *
 * 判据（task_plan「云同步预留位」C2 + RL-A8）：
 * 每个方法调用后必须落到「**文档化降级值**」或「**CloudUnavailableError**」二者之一；
 * **任何「假成功」判失败**（不伪造登录态、不谎报已同步、不谎报写入成功）。
 */
import { describe, expect, it } from 'vitest'
import { androidAdapter, CloudUnavailableError, DEGRADED_CREDENTIALS } from './android-adapter'

/** 读方法：必须返回文档化降级值（可安全 await，不得抛错） */
const DEGRADED_READERS: Array<{ method: string; call: () => Promise<unknown>; expected: unknown }> = [
  { method: 'isCloudSyncEnabled', call: () => androidAdapter.isCloudSyncEnabled(), expected: false },
  { method: 'getSyncStatus', call: () => androidAdapter.getSyncStatus(), expected: { isLoggedIn: false } },
  { method: 'loadCredentials', call: () => androidAdapter.loadCredentials(), expected: DEGRADED_CREDENTIALS },
  { method: 'checkSession', call: () => androidAdapter.checkSession(true), expected: null },
  { method: 'getAccountBindings', call: () => androidAdapter.getAccountBindings(), expected: null },
  { method: 'showSaveDialog', call: () => androidAdapter.showSaveDialog('backup.json'), expected: null },
  { method: 'showOpenDialog', call: () => androidAdapter.showOpenDialog(), expected: null },
  { method: 'writeFile', call: () => androidAdapter.writeFile('/tmp/a.json', '{}'), expected: false }
]

/** 写方法：必须抛 CloudUnavailableError，绝不允许 resolve */
const UNAVAILABLE_WRITERS: Array<{ method: string; call: () => Promise<unknown> }> = [
  { method: 'sendCode', call: () => androidAdapter.sendCode('13800138000', false) },
  { method: 'register', call: () => androidAdapter.register('a@b.com', 'pw', '1234', 'vid') },
  { method: 'login', call: () => androidAdapter.login('a@b.com', 'pw') },
  { method: 'loginWithCode', call: () => androidAdapter.loginWithCode('a@b.com', '1234', 'vid') },
  { method: 'logout', call: () => androidAdapter.logout() },
  { method: 'saveCredentials', call: () => androidAdapter.saveCredentials('a@b.com', true, true) },
  { method: 'sendReauthCode', call: () => androidAdapter.sendReauthCode() },
  { method: 'changePassword', call: () => androidAdapter.changePassword('new', '1234') },
  { method: 'resetPassword', call: () => androidAdapter.resetPassword('a@b.com', 'new', '1234', 'vid') },
  { method: 'sendBindCode', call: () => androidAdapter.sendBindCode('13800138000') },
  { method: 'sendBindingReauthCode', call: () => androidAdapter.sendBindingReauthCode() },
  { method: 'bindPhone', call: () => androidAdapter.bindPhone('13800138000', '1234', 'vid') },
  { method: 'unbindPhone', call: () => androidAdapter.unbindPhone('1234', 'vid') },
  { method: 'bindEmail', call: () => androidAdapter.bindEmail('a@b.com', '1234', 'vid', '5678', 'rvid') },
  { method: 'unbindEmail', call: () => androidAdapter.unbindEmail('1234', 'vid') },
  { method: 'deleteAccount', call: () => androidAdapter.deleteAccount('1234') }
]

describe('C2 降级语义：读方法返回文档化降级值', () => {
  for (const { method, call, expected } of DEGRADED_READERS) {
    it(`${method} → 文档化降级值`, async () => {
      await expect(call()).resolves.toEqual(expected)
    })
  }

  it('loadCredentials 返回值必须是对象（src/App.tsx:33 直接读 .autoLogin）', async () => {
    const preferences = await androidAdapter.loadCredentials()
    expect(typeof preferences).toBe('object')
    expect(preferences).not.toBeNull()
    expect(preferences.autoLogin).toBe(false)
    expect(preferences.rememberAccount).toBe(false)
    expect(preferences.identifier).toBe('')
  })

  it('loadCredentials 的降级值不可被运行时篡改（冻结常量，防止漂移）', () => {
    expect(Object.isFrozen(DEGRADED_CREDENTIALS)).toBe(true)
  })
})

describe('C2 降级语义：写方法抛 CloudUnavailableError（绝不假成功）', () => {
  for (const { method, call } of UNAVAILABLE_WRITERS) {
    it(`${method} → 明确不可用`, async () => {
      await expect(call()).rejects.toBeInstanceOf(CloudUnavailableError)
    })
  }

  it('CloudUnavailableError 携带可定位的方法名与稳定 code', async () => {
    await expect(androidAdapter.login('a@b.com', 'pw')).rejects.toMatchObject({
      name: 'CloudUnavailableError',
      code: 'cloud_unavailable'
    })
  })
})

describe('C2 降级语义：无「假成功」', () => {
  it('任何云/账号方法都不得 resolve 出 user / accessToken / 已登录态', async () => {
    for (const { method, call } of UNAVAILABLE_WRITERS) {
      const outcome = await call().then(
        (value) => ({ settled: 'resolved' as const, value }),
        () => ({ settled: 'rejected' as const, value: undefined })
      )
      expect(outcome.settled, `${method} 必须 reject，绝不允许 resolve`).toBe('rejected')
    }
  })

  it('顶栏同步态恒为未登录（RL-A8：不得谎报「已同步」）', async () => {
    const status = await androidAdapter.getSyncStatus()
    expect(status.isLoggedIn).toBe(false)
    // store/index.ts:166 只有 user 非空才会把 syncStatus 抬成 idle；此处断言无 user 可注入
    const session = await androidAdapter.checkSession(true)
    expect(session).toBeNull()
  })

  it('文件导出链路不会谎报成功（showSaveDialog 为 null ⇒ 调用方走「已取消」分支）', async () => {
    const filePath = await androidAdapter.showSaveDialog('ThunderBooks_Backup.json')
    expect(filePath).toBeNull()
    // writeFile 若被误调用也不得返回 true
    await expect(androidAdapter.writeFile('/anywhere.json', '{}')).resolves.toBe(false)
  })

  it('createShortcut 明确失败而非假装成功', async () => {
    const result = await androidAdapter.createShortcut()
    expect(result.success).toBe(false)
    expect(typeof result.message).toBe('string')
    expect(result.message.length).toBeGreaterThan(0)
  })

  it('onShortcut 返回可调用的取消订阅函数（src/App.tsx:58-63 卸载时会调用）', () => {
    const unsubscribe = androidAdapter.onShortcut(() => undefined)
    expect(typeof unsubscribe).toBe('function')
    expect(() => unsubscribe()).not.toThrow()
  })
})

describe('C2 会话恢复路径：降级值下不得抛错（src/App.tsx:27-46 等价复刻）', () => {
  it('loadCredentials().autoLogin → checkSession 全程不抛错且 user 保持 null', async () => {
    let user: unknown = 'sentinel'
    await expect(
      (async () => {
        const preferences = await androidAdapter.loadCredentials()
        const session = await androidAdapter.checkSession(preferences.autoLogin)
        user = session?.user ?? null
      })()
    ).resolves.toBeUndefined()
    expect(user).toBeNull()
  })
})
