import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')

describe('Tencent Cloud contracts', () => {
  it('keeps the official and legacy CloudBase API key names compatible', () => {
    const source = read('main-process/cloudbase.ts')
    expect(source).toContain("env['CLOUDBASE_API_KEY'] || env['CLOUDBASE_APIKEY']")
    expect(source).toContain('cloudbase.init({ env: ENV_ID, accessKey: apiKey })')
    expect(source).toContain("path.join(path.dirname(process.execPath), '.env')")
  })

  it('does not expose a false cloud-enabled state without an API key', () => {
    const source = read('main-process/cloudbase.ts')
    expect(source).toContain('db = apiKey ? cloudbase.init')
    expect(source).toContain('return !!(cloudApiKey && db && currentSession?.accessToken)')
  })

  it('uses CloudBase reauthentication codes for password changes instead of generic verification ids', () => {
    const profile = read('src/pages/Profile.tsx')
    const settings = read('src/components/SettingsDialog/SyncStatus.tsx')
    const preload = read('main-process/preload.ts')
    expect(profile).toContain("sendReauthCode(target === 'phone' ? 'phone_code' : 'email_code')")
    expect(profile).toContain('changePassword(newPwd, code)')
    expect(settings).toContain('sendReauthCode(verifyOpt)')
    expect(settings).toContain('changePassword(newPassword, verifyCode, oldPassword || undefined)')
    expect(preload).toContain("auth:changePassword', newPassword, verificationCode, oldPassword")
  })

  it('resets passwords through the native verification-token session, not an admin cloud function', () => {
    const source = read('main-process/cloudbase.ts')
    expect(source).toContain("registeredUserOnly ? 'USER' : 'ANY'")
    expect(source).toContain("authFetch('/auth/v1/signin', {")
    expect(source).toContain('verification_token: verificationToken')
    expect(source).toContain("authFetch('/auth/v1/user/password', {")
    expect(source).not.toContain('service.tcloudbase.com/resetUserPassword')
  })


  it('updates CloudBase Auth before the optional accounts mapping', () => {
    const source = read('main-process/cloudbase.ts')
    const authUpdate = source.indexOf("await updateAuthBasicInfo({ phone: '+86 ' + phone }, verificationToken)")
    const mappingUpdate = source.indexOf('await persistAccountBinding(userId, { phone })')
    expect(authUpdate).toBeGreaterThan(-1)
    expect(mappingUpdate).toBeGreaterThan(authUpdate)
    expect(source).toContain('binding_mapping_pending')
    expect(source).not.toContain("export async function bindPhone(phone: string, code: string, verificationId: string): Promise<void> {\n  if (!db)")
  })

  it('reads binding state from Auth and keeps Auth binding usable without the database key', () => {
    const source = read('main-process/cloudbase.ts')
    expect(source).toContain("authFetch('/auth/v1/user/me', {}, currentSession.accessToken, 'GET')")
    expect(source).toContain("method.toUpperCase() !== 'GET'")
    expect(source).toContain('binding_mapping_pending: CloudBase Auth 已完成')
    expect(source).toContain('cacheAuthBinding({ phone })')
    expect(source).not.toContain("export async function unbindPhone(code: string, verificationId: string): Promise<void> {\n  if (!db)")
    expect(source).toContain("return authFetch(endpoint, body, currentSession.accessToken, method, false)")
  })

  it('uses valid basic/edit values for unbinding instead of empty fields', () => {
    const source = read('main-process/cloudbase.ts')
    expect(source).toContain('makeUnboundEmail(userId)')
    expect(source).toContain('makeUnboundPhone(userId)')
    expect(source).toContain('basic/edit 官方契约只接收')
    expect(source).not.toContain("verification_token: verificationToken\n  }, currentSession.accessToken)")
  })

  it('hides historical fake-unbind email domains from the user', () => {
    const profile = read('src/pages/Profile.tsx')
    const cloudbase = read('main-process/cloudbase.ts')
    expect(profile).toContain("normalized.endsWith('@lgs.invalid')")
    expect(cloudbase).toContain("normalized.endsWith('@lgs.invalid')")
  })

  it('guards the last remaining binding in both UI and translated backend errors', () => {
    const profile = read('src/pages/Profile.tsx')
    const errors = read('src/utils/errorMessages.ts')
    expect(profile).toContain('当前只绑定一个平台，不能进行解绑操作')
    expect(errors).toContain('/cannot_remove_last_binding/i')
  })

  it('keeps normal and dangerous profile input focus lights on separate Aurora tokens', () => {
    const profile = read('src/pages/Profile.tsx')
    const styles = read('src/index.css')
    expect(profile).toContain('profile-input-danger')
    expect(styles).toContain('border-color: var(--accent)')
    expect(styles).toContain('.profile-input-danger:focus')
    expect(styles).toContain('box-shadow: 0 0 0 2px var(--danger-dim)')
  })

  it('sends only current-session proof to the durable deletion saga', () => {
    const client = read('main-process/cloudbase.ts')
    const saga = read('cloudfunctions/delUser/index.js')
    expect(client).toContain('body: JSON.stringify({ access_token: currentSession.accessToken, verify_code: code })')
    expect(saga).toContain("authRequest('/auth/v1/user/me', 'GET', accessToken)")
    expect(saga).toContain("state: 'auth_pending'")
    expect(saga).toContain("state: 'cleanup_pending'")
    expect(saga).not.toContain('event && event.uid')
    expect(client).toContain('reauth_not_logged_in')
    expect(client).toContain('auth_delete_failed')
    expect(client).toContain('shio-d0gsoo414401468d6-1458734732.tcloudbaseapp.com/delUser')
  })

  it('does not preserve the old cloud-data-before-Auth-delete sequence', () => {
    const client = read('main-process/cloudbase.ts')
    const errors = read('src/utils/errorMessages.ts')
    expect(client).toContain('远端业务数据必须由具备最小权限的、可重试的')
    expect(client).not.toContain('data_deleted !== true')
    expect(client).not.toContain('await deleteUserData(app.database(), uid)')
    expect(errors).toContain('/auth_delete_failed/i')
  })

  it('keeps Auth response envelopes and password UI independent from database availability', () => {
    const client = read('main-process/cloudbase.ts')
    const profile = read('src/pages/Profile.tsx')
    expect(client).toContain('const d = authPayload(data) as { verification_id?: string }')
    expect(client).toContain("throw new Error('reauth_not_logged_in')")
    expect(profile).toContain('onClick={() => setExpanded(!expanded)}')
    expect(profile).not.toContain('disabled={!cloudAvailable}')
    expect(client).toContain("authFetch('/auth/v1/user/password', {")
    expect(client).toContain("const selectedOpt = verifyOpt || (hasAuthoritativePhone ? 'phone_code' : 'email_code')")
    expect(client).not.toContain('password: currentPassword')
  })

  it('allows password login with a phone number without an accounts database mapping', () => {
    const client = read('main-process/cloudbase.ts')
    expect(client).toContain("if (/^\\d{11}$/.test(identifier)) return identifier")
    expect(client).toContain("const authIdentifier = isPhone ? '+86 ' + email : email")
    expect(client).toContain("email: target.type === 'phone' ? `${target.target}@phone.tb` : target.target")
  })

  it('uses CloudBase document ids instead of local auto-increment ids for sync merges', () => {
    const database = read('main-process/database/index.ts')
    const cloudbase = read('main-process/cloudbase.ts')
    expect(database).toContain('cloud_id TEXT')
    expect(database).toContain('ALTER TABLE bills ADD COLUMN cloud_id TEXT')
    expect(database).toContain('ALTER TABLE categories ADD COLUMN cloud_id TEXT')
    expect(database).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_cloud_id')
    expect(database).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_cloud_id')
    expect(database).toContain('WHERE cloud_id = ?')
    expect(cloudbase).toContain('setBillCloudId')
    expect(cloudbase).toContain('bill.cloud_id')
  })

  it('submits signup with verification_token only and never converts a failed phone signup to a pseudo-email', () => {
    const client = read('main-process/cloudbase.ts')
    const phoneSignup = client.slice(client.indexOf('export async function registerWithPhone'), client.indexOf('/** 登录 */'))
    expect(phoneSignup).toContain('verification_token: verificationToken')
    expect(phoneSignup).not.toContain('verification_code: code')
    expect((phoneSignup.match(/authFetch\('\/auth\/v1\/signup'/g) || [])).toHaveLength(1)
  })

  it('establishes a real phone session after signup so the profile can read the Auth phone binding', () => {
    const client = read('main-process/cloudbase.ts')
    const phoneSignup = client.slice(client.indexOf('export async function registerWithPhone'), client.indexOf('/** 登录 */'))
    expect(phoneSignup).toContain('phone_number: \'+86 \' + phone')
    expect(phoneSignup).toContain('return loginWithEmail(phone, password)')
  })
})
