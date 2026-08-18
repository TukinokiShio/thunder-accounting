/**
 * 登录偏好中的自动登录仅授权恢复当前 CloudBase 会话。
 * 主动退出必须撤销该授权，但不能丢失用户选择的“记住账号”标识符。
 */
export interface StoredLoginPreferences {
  identifier: string
  rememberAccount: boolean
  autoLogin: boolean
}

export async function disableAutoLoginAfterLogout(
  load: () => Promise<StoredLoginPreferences>,
  save: (identifier: string, rememberAccount: boolean, autoLogin: boolean) => Promise<void>
): Promise<void> {
  const preferences = await load()
  await save(
    preferences.rememberAccount ? preferences.identifier : '',
    preferences.rememberAccount,
    false
  )
}

/** Keep logout sequencing testable: clear the CloudBase session before revoking auto-login. */
export async function logoutAndDisableAutoLogin(
  performLogout: () => Promise<void>,
  load: () => Promise<StoredLoginPreferences>,
  save: (identifier: string, rememberAccount: boolean, autoLogin: boolean) => Promise<void>
): Promise<void> {
  await performLogout()
  await disableAutoLoginAfterLogout(load, save)
}
