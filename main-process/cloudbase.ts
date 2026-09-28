import cloudbase from '@cloudbase/node-sdk'
import userCloudbase from '@cloudbase/js-sdk'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { BillRow, CategoryRow, RecurringRow, InvestmentPositionRow, CloudInvestmentPosition, CloudInvestmentSnapshot } from './database'
import { clearAllData, getDbPath, getBills, getCategories, getRecurrings, getInvestmentPositions, getInvestmentSnapshotHistory, setBillCloudId, setCategoryCloudId, setRecurringCloudId } from './database'
import { validateInvestmentBatch } from '../src/utils/investmentHoldings'
import { investmentDocumentId, investmentSnapshotDocumentId } from './investment-cloud-key'
import { bindCloudbaseUserDatabaseWithRefresh, isExplicitAccessTokenExpiredError, safeCloudbaseErrorCode } from './cloudbase-session'
import { readOptionalCloudBaseCollectionPage } from './cloudbase-collection'
import {
  upsertInvestmentCloudCurrent,
  upsertInvestmentCloudSnapshot,
  type InvestmentCloudDatabase,
  type InvestmentCloudRecord,
  type InvestmentCloudSnapshotRecord
} from './investment-cloud-write'
import { saveCredentials as safeSave, loadCredentials as safeLoad, clearCredentials } from './credential-store'
import { resolveAccountDeletionResponse } from './account-deletion'

// ─── Load .env file (manual, no dependency) ─────
// 在主进程中手动解析 .env 文件，避免 build-time 注入。
// process.env 在 electron-vite 中通过 define 替换为静态值，
// 因此用动态属性名访问来绕过这个限制。
function loadEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) return
  try {
    const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      let val = trimmed.slice(eqIdx + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (!process.env[key]) process.env[key] = val
    }
  } catch (e) {
    console.error('Failed to load .env file:', e)
  }
}

// ─── Constants ────────────────────────────────────

const ENV_ID = 'shio-d0gsoo414401468d6'
const AUTH_BASE = `https://${ENV_ID}.api.tcloudbasegateway.com`
// CloudBase 网关实际登记的 delUser 路由（不是 service.tcloudbase.com 函数直连域名）。
const DELETE_ACCOUNT_URL = 'https://shio-d0gsoo414401468d6-1458734732.tcloudbaseapp.com/delUser'

/**
 * CloudBase API Key — 同时兼容项目自定义的 CLOUDBASE_API_KEY 和
 * CloudBase Node SDK 官方约定的 CLOUDBASE_APIKEY。
 * 在 initCloudBase() 中通过 loadEnvFile() 注入 process.env 后读取。
 * API key 仅供旧有 accounts 管理/账号查询路径使用；用户业务数据走当前认证会话。
 * 通过动态属性名访问 process.env，避免 electron-vite 构建时静态替换。
 */
function getApiKey(): string {
  const env = process.env as Record<string, string | undefined>
  return (env['CLOUDBASE_API_KEY'] || env['CLOUDBASE_APIKEY'] || '').trim()
}

function getConfiguredAdminEmail(): string {
  const env = process.env as Record<string, string | undefined>
  return (env['THUNDER_ADMIN_EMAIL'] || '').trim()
}

/** Optional local migration mapping. Keep account-specific email addresses out of the public source tree. */
export function shouldMigrateLegacyDatabase(email: string | undefined): boolean {
  if (!email) return false
  const env = process.env as Record<string, string | undefined>
  const migrationEmail = (env['THUNDER_LEGACY_MIGRATION_EMAIL'] || '').trim()
  return Boolean(migrationEmail && email === migrationEmail)
}

// ─── Types ────────────────────────────────────────

export interface CloudBaseUser {
  uid: string
  email: string
  phone?: string
  emailVerified: boolean
  accountId?: string
  nickname?: string
}

/** 精简版会话信息（不暴露 token 给前端） */
export interface LoginResult {
  user: CloudBaseUser
  accountId?: string
}

interface AuthSession {
  user: CloudBaseUser
  accessToken: string
  refreshToken: string
  expiresAt: number
}

interface SessionFile {
  refreshToken: string
  accessToken: string
  user: CloudBaseUser
  expiresAt: number
}

// ─── Internal State ───────────────────────────────

let db: ReturnType<ReturnType<typeof cloudbase.init>['database']> | null = null
type UserCloudDatabase = ReturnType<ReturnType<typeof userCloudbase.init>['database']>
let userCloudApp: ReturnType<typeof userCloudbase.init> | null = null
let userDb: UserCloudDatabase | null = null
let userDatabaseUid: string | null = null
let userDatabaseError: string | null = null
let userSessionGeneration = 0
let userSessionBinding: Promise<void> = Promise.resolve()
let cloudApiKey = ''
let currentSession: AuthSession | null = null

// ─── Session Persistence ──────────────────────────

function getSessionPath(): string {
  return path.join(app.getPath('userData'), 'cloudbase-auth.json')
}

function loadSession(): AuthSession | null {
  try {
    const raw = fs.readFileSync(getSessionPath(), 'utf-8')
    const data: SessionFile = JSON.parse(raw)
    return {
      user: data.user,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt
    }
  } catch { return null }
}

function saveSession(session: AuthSession): void {
  fs.writeFileSync(getSessionPath(), JSON.stringify(session, null, 2), 'utf-8')
}

function clearSession(): void {
  try { fs.unlinkSync(getSessionPath()) } catch { /* ignore */ }
}

// ─── Initialization ───────────────────────────────

export async function initCloudBase(): Promise<void> {
  // 加载 .env 文件（顶层相对路径，electron-vite 下指向项目根）
  // app.getAppPath() 在 whenReady 前不可用，用 __dirname 推导
  const envPath1 = path.join(__dirname, '..', '..', '.env')
  const envPath2 = path.join(process.resourcesPath || '', '.env')
  const envPath3 = path.join(app.getPath('userData'), '.env')
  loadEnvFile(envPath1)
  loadEnvFile(envPath2)
  loadEnvFile(envPath3)
  // 安装版允许把 .env 放在 exe 同级目录；不要要求用户修改 asar 或源码目录。
  loadEnvFile(path.join(path.dirname(process.execPath), '.env'))

  const apiKey = getApiKey()
  cloudApiKey = apiKey
  if (!apiKey) {
    console.warn('⚠ CloudBase API Key not set. Admin-managed account lookup features will be unavailable; user-session data sync can still work after login.')
  }
  try {
    // 空 accessKey 不能视为已初始化，否则 UI 会错误地显示“云端可用”。
    db = apiKey ? cloudbase.init({ env: ENV_ID, accessKey: apiKey }).database() : null
  } catch (e) {
    db = null
    console.error('CloudBase SDK 初始化失败，云同步功能不可用:', safeCloudbaseErrorCode(e))
  }
  try {
    // User business data is accessed with the authenticated user's session.
    // This client carries no server API Key and is checked against the UID.
    userCloudApp = userCloudbase.init({ env: ENV_ID, region: 'ap-shanghai' })
  } catch (e) {
    userCloudApp = null
    userDb = null
    userDatabaseUid = null
    userDatabaseError = 'cloud_sdk_init_failed'
    console.error('CloudBase 用户态 SDK 初始化失败:', safeCloudbaseErrorCode(e))
  }
  const saved = loadSession()
  if (saved) {
    currentSession = saved
    try {
      await bindCurrentUserDatabase(saved)
    } catch (error) {
      console.error('[CloudBase] 恢复用户态数据库会话失败:', safeCloudbaseErrorCode(error))
    }
  }
}

function bindCurrentUserDatabase(session: AuthSession): Promise<void> {
  const binding = userSessionBinding.catch(() => undefined).then(() => bindCurrentUserDatabaseSerial(session))
  userSessionBinding = binding
  return binding
}

async function bindCurrentUserDatabaseSerial(session: AuthSession): Promise<void> {
  if (currentSession?.user.uid !== session.user.uid) return
  const generation = ++userSessionGeneration
  if (userDatabaseUid !== session.user.uid) {
    userDb = null
    userDatabaseUid = null
  }
  userDatabaseError = null
  if (!userCloudApp) throw new Error('cloud_sdk_not_initialized')
  try {
    const bound = await bindCloudbaseUserDatabaseWithRefresh({
      auth: () => userCloudApp!.auth(),
      database: () => userCloudApp!.database()
    }, {
      access_token: session.accessToken,
      refresh_token: session.refreshToken
    }, session.user.uid, async () => {
      const activeSession = currentSession
      if (!activeSession || activeSession.user.uid !== session.user.uid || generation !== userSessionGeneration) {
        throw new Error('cloud_session_changed')
      }
      const refreshed = await authFetch('/auth/v1/token', {
        grant_type: 'refresh_token',
        refresh_token: activeSession.refreshToken
      }, undefined, 'POST', false)
      if (!refreshed.ok) {
        const payload = authPayload(refreshed.data)
        throw new Error(`cloud_session_refresh_failed:${safeCloudbaseErrorCode({ ...payload, status: refreshed.status }, `http_${refreshed.status}`)}`)
      }
      const tokens = authPayload(refreshed.data) as {
        access_token?: unknown
        refresh_token?: unknown
        expires_in?: unknown
      }
      if (typeof tokens.access_token !== 'string' || !tokens.access_token ||
        (tokens.refresh_token !== undefined && typeof tokens.refresh_token !== 'string')) {
        throw new Error('cloud_session_refresh_incomplete')
      }
      if (currentSession?.user.uid !== activeSession.user.uid || generation !== userSessionGeneration) {
        throw new Error('cloud_session_changed')
      }
      const updatedSession: AuthSession = {
        ...activeSession,
        accessToken: tokens.access_token,
        refreshToken: typeof tokens.refresh_token === 'string' && tokens.refresh_token ? tokens.refresh_token : activeSession.refreshToken,
        expiresAt: Date.now() + (typeof tokens.expires_in === 'number' && Number.isFinite(tokens.expires_in) ? tokens.expires_in : 7200) * 1000
      }
      currentSession = updatedSession
      saveSession(updatedSession)
      return { access_token: updatedSession.accessToken, refresh_token: updatedSession.refreshToken }
    })
    if (generation !== userSessionGeneration || currentSession?.user.uid !== bound.userId) return
    userDb = bound.database
    userDatabaseUid = bound.userId
    userDatabaseError = null
  } catch (error) {
    if (generation === userSessionGeneration) {
      userDb = null
      userDatabaseUid = null
      const code = safeCloudbaseErrorCode(error)
      userDatabaseError = error instanceof Error && /^cloud_session_[a-z0-9_-]+(?::[a-z0-9_.-]+)*$/i.test(error.message)
        ? error.message
        : `cloud_session_rejected:${code}`
    }
    throw error
  }
}

/** Retry the signed-in user's SDK database binding without reading or changing local ledger data. */
export async function retryCurrentUserDatabaseBinding(expectedUserId = getUserId()): Promise<void> {
  const session = currentSession
  if (!session) throw new Error('cloud_session_unavailable')
  if (!expectedUserId || session.user.uid !== expectedUserId) throw new Error('cloud_session_uid_mismatch')
  await bindCurrentUserDatabase(session)
  if (!userDb || userDatabaseUid !== expectedUserId) {
    throw new Error(userDatabaseError || 'cloud_session_binding_unavailable')
  }
}

function clearUserDatabaseSession(): void {
  userSessionGeneration++
  userDb = null
  userDatabaseUid = null
  userDatabaseError = null
}

// ─── Remember Credentials ─────────────────────────
// 委托给 credential-store（safeStorage 加密）

export async function saveCredentials(identifier: string, rememberAccount: boolean, autoLogin: boolean): Promise<void> {
  try {
    await safeSave(identifier, rememberAccount, autoLogin)
  } catch (e) {
    console.error('保存加密凭据失败：', safeCloudbaseErrorCode(e))
  }
}

export async function loadCredentials(): Promise<{ identifier: string; rememberAccount: boolean; autoLogin: boolean }> {
  try {
    const cred = await safeLoad()
    return cred
  } catch {
    return { identifier: '', rememberAccount: false, autoLogin: false }
  }
}

// ─── HTTP helpers ─────────────────────────────────

async function authFetch(
  endpoint: string,
  body: Record<string, unknown> = {},
  token?: string,
  method: string = 'POST',
  retryOn401 = true
): Promise<{ ok: boolean; data: Record<string, unknown>; status: number }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const request: RequestInit = { method, headers }
  if (method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
    request.body = JSON.stringify(body)
  }
  const res = await fetch(`${AUTH_BASE}${endpoint}`, request)
  let data: Record<string, unknown>
  try { data = await res.json() as Record<string, unknown> } catch { data = { error: `HTTP ${res.status}` } }
  const payload = data.data && typeof data.data === 'object' && !Array.isArray(data.data)
    ? data.data as Record<string, unknown>
    : data
  const businessError = payload.error || payload.error_description || payload.error_code
  if (res.status === 401 && isExplicitAccessTokenExpiredError(payload) && retryOn401 && token && currentSession?.refreshToken && endpoint !== '/auth/v1/token') {
    const refreshed = await authFetch('/auth/v1/token', {
      grant_type: 'refresh_token',
      refresh_token: currentSession.refreshToken
    }, undefined, 'POST', false)
    if (refreshed.ok) {
      const refreshedData = authPayload(refreshed.data) as {
        access_token?: string
        refresh_token?: string
        expires_in?: number
      }
      if (refreshedData.access_token) {
        currentSession.accessToken = refreshedData.access_token
        currentSession.refreshToken = refreshedData.refresh_token || currentSession.refreshToken
        currentSession.expiresAt = Date.now() + (refreshedData.expires_in || 7200) * 1000
        saveSession(currentSession)
        void bindCurrentUserDatabase(currentSession).catch((error) => {
          console.error('[CloudBase] 刷新用户态数据库会话失败:', safeCloudbaseErrorCode(error))
        })
        return authFetch(endpoint, body, currentSession.accessToken, method, false)
      }
    }
  }
  return { ok: res.ok && !businessError, data, status: res.status }
}

/** 将 CloudBase 顶层/嵌套错误统一为稳定的机器可读 key，避免真实原因退化成模糊兜底。 */
function authError(data: Record<string, unknown>, status: number, fallback: string): string {
  const payload = authPayload(data)
  const code = String(payload.error || payload.error_code || payload.code || `http_${status}`).trim()
  const description = String(payload.error_description || payload.message || payload.error_message || '').trim()
  return description && description !== code ? `${code}|${description}` : (code || fallback)
}

// ─── Auth Functions ───────────────────────────────

// ─── Account ID Standard ──────────────────────────

/** 30 字符可用字符集（排除 I/O/0/1 易混淆字符） */
const ACCOUNT_ID_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Optional local administrator alias; when configured, it maps to this generic account ID. */
export const ADMIN_ACCOUNT_ID = 'TBAdmin'

/**
 * 生成唯一账号 ID：TB + 6 位随机字母数字（使用 crypto 安全随机数）。
 * 这是兜底函数，主流程应使用 generateStandardAccountId(email)。
 */
export function generateAccountId(): string {
  let id = 'TB'
  const bytes = require('crypto').randomBytes(6)
  for (let i = 0; i < 6; i++) {
    id += ACCOUNT_ID_CHARSET[bytes[i] % ACCOUNT_ID_CHARSET.length]
  }
  return id
}

/**
 * 按邮箱规范化生成账号 ID（核心规范）。
 *
 * 规则（按顺序匹配）：
 * 1. Locally configured THUNDER_ADMIN_EMAIL → "TBAdmin"
 * 2. 邮箱本地部分含 6+ 位数字 → "TB" + 前 6 位数字（如 alex123456@example.com → "TB123456"）
 * 3. 邮箱本地部分含 4-5 位数字 → "TB" + 数字部分
 * 4. 邮箱本地部分含 6+ 位字母 → "TB" + 前 6 位大写字母（如 alice@x.com → "TBAlice"）
 * 5. 邮箱本地部分含 3-5 位字母 → "TB" + 大写字母部分
 * 6. 兜底：随机 6 位字符
 *
 * 优点：可读、易记、有规律；缺点：可能重复，所以注册路径必须做唯一性检查。
 */
export function generateStandardAccountId(email: string): string {
  // 1. admin 特殊映射
  const adminEmail = getConfiguredAdminEmail()
  if (adminEmail && email === adminEmail) return ADMIN_ACCOUNT_ID

  // 2-5. 邮箱规范化
  const local = (email || '').split('@')[0]

  // 优先数字
  const digits = local.match(/\d+/g)?.join('') || ''
  if (digits.length >= 6) return 'TB' + digits.slice(0, 6)
  if (digits.length >= 4) return 'TB' + digits

  // 其次字母
  const letters = (local.match(/[a-zA-Z]+/g)?.join('') || '').toUpperCase()
  if (letters.length >= 6) return 'TB' + letters.slice(0, 6)
  if (letters.length >= 3) return 'TB' + letters

  // 6. 兜底
  return generateAccountId()
}

/**
 * 检查账号 ID 格式是否符合规范（TB-XXXXXX 形式）。
 * 注意：admin 的 TBAdmin 不符合此规则，所以 admin 不通过此校验。
 */
export function isValidAccountId(id: string): boolean {
  if (id === ADMIN_ACCOUNT_ID) return true
  return /^TB[A-Z0-9]{4,8}$/.test(id)
}

/**
 * 默认昵称生成（用于新用户注册或老用户兜底）。
 * 从 email 本地部分提取，截断到 20 字符。
 */
export function generateDefaultNickname(email: string): string {
  const adminEmail = getConfiguredAdminEmail()
  if (adminEmail && email === adminEmail) return 'adminer'
  if (!email) return '新用户'
  const local = email.split('@')[0]
  if (!local) return '新用户'
  if (local.length > 20) return local.slice(0, 20)
  return local
}

/**
 * 根据输入标识符解析出用于 CloudBase 登录的邮箱。
 * 支持：账号 ID → 查 accounts 集合；邮箱 → 直接返回；手机号 → 查 accounts 集合。
 */
export async function resolveLoginIdentifier(identifier: string): Promise<string> {
  const isAdminAlias = identifier.trim().toLowerCase() === 'admin' || identifier.trim().toLowerCase() === ADMIN_ACCOUNT_ID.toLowerCase()
  const adminEmail = getConfiguredAdminEmail()
  if (isAdminAlias && adminEmail) return adminEmail
  // CloudBase Auth 原生支持手机号登录；不应因本地 accounts 映射不可用而阻断。
  if (/^\d{11}$/.test(identifier)) return identifier
  // 邮箱格式 → 直接返回
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) return identifier

  // 尝试从 accounts 集合查找
  if (db) {
    try {
      const accountIdentifier = isAdminAlias ? ADMIN_ACCOUNT_ID : identifier
      const result = await db.collection('accounts').where({
        _or: [
          { accountId: accountIdentifier },
          { phone: identifier }
        ]
      }).limit(1).get()

      if (result.data?.length) {
        const account = result.data[0] as { email: string }
        return account.email
      }
    } catch (e) {
      console.error('解析登录标识符失败:', safeCloudbaseErrorCode(e))
    }
  }

  throw new Error('account_not_found')
}

/**
 * 解析验证码接收方。优先级：手机号 > 邮箱。
 * 用于 sendVerificationCode 和 loginWithVerificationCode。
 * 返回 null 表示账号未找到。
 */
export async function resolveVerificationTarget(identifier: string): Promise<{ type: 'phone' | 'email'; target: string } | null> {
  const isAdminAlias = identifier.trim().toLowerCase() === 'admin' || identifier.trim().toLowerCase() === ADMIN_ACCOUNT_ID.toLowerCase()
  const adminEmail = getConfiguredAdminEmail()
  if (isAdminAlias && adminEmail) return { type: 'email', target: adminEmail }
  // 手机号格式
  if (/^\d{11}$/.test(identifier)) return { type: 'phone', target: identifier }
  // 邮箱格式
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) return { type: 'email', target: identifier }

  // 账号 ID：通过 accounts 集合查找，手机号优先
  if (db) {
    try {
      const accountIdentifier = isAdminAlias ? ADMIN_ACCOUNT_ID : identifier
      const result = await db.collection('accounts').where({ accountId: accountIdentifier }).limit(1).get()
      if (result.data?.length) {
        const account = result.data[0] as { phone: string; email: string }
        if (account.phone) return { type: 'phone', target: account.phone }
        if (account.email) return { type: 'email', target: account.email }
      }
    } catch (e) {
      console.error('解析验证码接收方失败:', safeCloudbaseErrorCode(e))
    }
  }

  return null
}

/**
 * 注册后创建账号绑定记录。
 */
async function createAccountRecord(email: string, uid: string, accountId: string, nickname?: string): Promise<void> {
  if (!db) return
  try {
    await db.collection('accounts').add({
      accountId,
      uid,
      email,
      phone: '',
      nickname: nickname || generateDefaultNickname(email),
      createdAt: new Date().toISOString()
    })
  } catch (e) {
    console.error('创建账号记录失败:', safeCloudbaseErrorCode(e))
  }
}

export interface SendCodeResult {
  type: 'phone' | 'email'
  target: string
  verificationId: string
  isUser: boolean
  expiresIn: number
}

/** 发送验证码到邮箱或手机号。返回实际接收方信息和 verification_id */
export async function sendVerificationCode(target: string, registeredUserOnly = false): Promise<SendCodeResult> {
  const isPhone = /^\d{11}$/.test(target)
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)
  const body: Record<string, string> = {}
  let resolvedType: 'phone' | 'email' | null = null
  let resolvedTarget: string | null = null

  if (isPhone) {
    body.phone_number = '+86 ' + target
    body.target = registeredUserOnly ? 'USER' : 'ANY'
    resolvedType = 'phone'
    resolvedTarget = target
  } else if (isEmail) {
    body.email = target
    body.target = registeredUserOnly ? 'USER' : 'ANY'
    resolvedType = 'email'
    resolvedTarget = target
  } else {
    // 账号 ID：通过 accounts 集合查找实际接收方（手机号优先）
    const resolved = await resolveVerificationTarget(target)
    if (resolved) {
      if (resolved.type === 'phone') {
        body.phone_number = '+86 ' + resolved.target
      } else {
        body.email = resolved.target
      }
      body.target = registeredUserOnly ? 'USER' : 'ANY'
      resolvedType = resolved.type
      resolvedTarget = resolved.target
    } else {
      throw new Error('account_not_found')
    }
  }

  const { ok, data, status } = await authFetch('/auth/v1/verification', body)
  if (!ok) {
    throw new Error(authError(data, status, 'verification_code_send_failed'))
  }

  const d = authPayload(data) as { verification_id?: string; is_user?: boolean; expires_in?: number }
  if (registeredUserOnly && d.is_user === false) throw new Error('account_not_found')
  if (!d.verification_id) throw new Error('verification_code_missing_id')
  return {
    type: resolvedType || 'email',
    target: resolvedTarget || target,
    verificationId: d.verification_id || '',
    isUser: !!d.is_user,
    expiresIn: Number(d.expires_in) > 0 ? Number(d.expires_in) : 300
  }
}

/** 注册（邮箱 + 验证码）—— CloudBase 三步流程 */
export async function registerWithEmail(email: string, password: string, code: string, verificationId: string): Promise<LoginResult> {
  // Step 2: 验证 code 换 verification_token
  const verificationToken = await verifyCode(verificationId, code)

  // Step 3: signup
  const body: Record<string, string> = {
    email,
    password,
    verification_token: verificationToken
  }
  const { ok, data, status } = await authFetch('/auth/v1/signup', body)
  if (!ok) {
    const error = authError(data, status, 'signup_failed')
    if (/user_already_exists/i.test(error) || status === 409) throw new Error('user_already_exists')
    throw new Error(error)
  }
  const u = authPayload(data) as { uid: string; email_verified?: boolean; sub?: string }
  const uid = u.uid || u.sub || ''

  const accountId = generateStandardAccountId(email)
  const nickname = generateDefaultNickname(email)
  await createAccountRecord(email, uid, accountId, nickname)
  // signup 响应不是可用会话；原生 signin 后才会写入 refresh token，确保注册后
  // 资料页可读取真实 Auth 绑定信息并支持自动登录。
  return loginWithEmail(email, password)
}

/** 注册（手机号 + 验证码） */
export async function registerWithPhone(phone: string, password: string, code: string, verificationId: string): Promise<LoginResult> {
  // Step 2: 验证 code
  const verificationToken = await verifyCode(verificationId, code)

  // Step 3: signup 用 phone_number
  const body: Record<string, string> = {
    phone_number: '+86 ' + phone,
    password,
    verification_token: verificationToken
  }
  const { ok, data, status } = await authFetch('/auth/v1/signup', body)
  if (ok) {
    const u = authPayload(data) as { uid: string; email_verified?: boolean; sub?: string }
    const uid = u.uid || u.sub || ''
    const internalEmail = `${phone}@phone.tb`
    const accountId = generateStandardAccountId(internalEmail)
    const nickname = generateDefaultNickname(phone)
    await createAccountRecord(internalEmail, uid, accountId, nickname)
    try {
      await db?.collection('accounts').where({ uid }).update({ phone })
    } catch { /* ignore */ }
    // 同上：手机号必须通过原生手机号 signin 建立会话，不能只返回 signup 的 uid。
    return loginWithEmail(phone, password)
  }

  const error = authError(data, status, 'signup_failed')
  if (/user_already_exists/i.test(error) || status === 409) throw new Error('user_already_exists')
  // 绝不能把手机号悄悄降级注册为伪邮箱：这会造成真实手机号未绑定，随后登录、改密和注销都无法工作。
  throw new Error(error)
}

/** 登录 */
export async function loginWithEmail(email: string, password: string): Promise<LoginResult> {
  const isPhone = /^\d{11}$/.test(email)
  const authIdentifier = isPhone ? '+86 ' + email : email
  const { ok, data, status } = await authFetch('/auth/v1/signin', { username: authIdentifier, password })
  if (!ok) {
    const error = authError(data, status, 'signin_failed')
    if (/invalid_username_or_password/i.test(error)) throw new Error('invalid_username_or_password')
    if (/email_not_verified/i.test(error)) throw new Error('email_not_verified')
    throw new Error(error)
  }
  const result = authPayload(data) as { sub?: string; access_token?: string; refresh_token?: string; expires_in?: number; email_verified?: boolean }
  const uid = result.sub || ''
  const sessionEmail = isPhone ? `${email}@phone.tb` : email

  // 从 accounts 集合获取 accountId
  let accountId: string | undefined
  try {
    if (db) {
      const accResult = await db.collection('accounts').where({ uid }).limit(1).get()
      if (accResult.data?.length) {
        const acc = accResult.data[0] as { accountId?: string; email?: string; nickname?: string }
        accountId = acc.accountId
        if (!accountId) {
          const refEmail = acc.email || sessionEmail
          accountId = generateStandardAccountId(refEmail)
          await db.collection('accounts').doc((accResult.data[0] as { _id: string })._id).update({ accountId })
        }
      } else {
        accountId = generateStandardAccountId(sessionEmail)
      }
    } else {
      accountId = generateStandardAccountId(sessionEmail)
    }
  } catch (e) {
    console.error('获取 accountId 失败（用规范化算法兜底）:', safeCloudbaseErrorCode(e))
    accountId = generateStandardAccountId(sessionEmail)
  }

  // 尝试获取 nickname（accounts 集合优先，否则从 email 推断）
  let nickname: string | undefined
  try {
    if (db) {
      const accResult2 = await db.collection('accounts').where({ uid }).limit(1).get()
      if (accResult2.data?.length) {
        const acc = accResult2.data[0] as { nickname?: string }
        nickname = acc.nickname
      }
    }
  } catch { /* ignore */ }
  if (!nickname) nickname = generateDefaultNickname(sessionEmail)

  const session: AuthSession = {
    user: {
      uid,
      email: sessionEmail,
      phone: isPhone ? email : undefined,
      emailVerified: !!result.email_verified,
      accountId,
      nickname
    },
    accessToken: result.access_token || '',
    refreshToken: result.refresh_token || '',
    expiresAt: Date.now() + (result.expires_in || 7200) * 1000
  }
  currentSession = session
  saveSession(session)
  try { await bindCurrentUserDatabase(session) }
  catch (error) { console.error('[CloudBase] 登录成功，但用户态数据库会话绑定失败:', safeCloudbaseErrorCode(error)) }
  // 只返回用户信息，不暴露 token
  return { user: session.user, accountId }
}

/**
 * 验证邮箱/手机验证码（Step 2 of signin）
 * 把 verification_id + verification_code 换成真正的 verification_token
 */
/** True only when the current authenticated UID has a bound user-session database. */
export function isCloudSyncEnabled(): boolean {
  return !!(isLoggedIn() && currentSession?.accessToken && userDb && userDatabaseUid === currentSession.user.uid)
}

export async function verifyCode(verificationId: string, code: string, useCurrentSession = false): Promise<string> {
  if (!verificationId) throw new Error('verification_id_required')

  // CloudBase REST API：/auth/v1/verification/verify
  // 登录、注册、找回密码不携带旧会话 token；仅已登录用户的绑定/解绑流程传 token。
  const accessToken = useCurrentSession ? (currentSession?.accessToken || '') : ''
  const { ok, data, status } = await authFetch('/auth/v1/verification/verify', {
    verification_id: verificationId,
    verification_code: code
  }, accessToken)
  if (!ok) {
    const errorCode = authError(data, status, 'verification_code_invalid')
    if (errorCode.includes('expired')) throw new Error('verification_code_expired')
    if (errorCode.includes('invalid') || errorCode.includes('incorrect')) throw new Error('verification_code_invalid')
    throw new Error(errorCode)
  }
  const result = authPayload(data) as { verification_token?: string; ticket?: string }
  const token = result.verification_token || result.ticket
  if (!token) throw new Error('no_verification_token_in_response')
  return token
}

/** 验证码登录（三步流程：发送 → 验证 → 登录），手机号优先 */
export async function loginWithVerificationCode(identifier: string, code: string, verificationId?: string): Promise<LoginResult> {
  // 解析接收方
  const target = await resolveVerificationTarget(identifier)
  if (!target) throw new Error('account_not_found')
  if (!verificationId) throw new Error('verification_id_required')

  // Step 2: 验证 code，换 verification_token
  const verificationToken = await verifyCode(verificationId, code)

  // Step 3: signin (username + verification_token)
  // username 字段对邮箱/手机号都适用；中国手机号需要 "+86 " 前缀
  const signinUsername = target.type === 'phone'
    ? '+86 ' + target.target
    : target.target
  const body: Record<string, string> = { username: signinUsername, verification_token: verificationToken }

  const { ok, data, status } = await authFetch('/auth/v1/signin', body)
  if (!ok) {
    throw new Error(authError(data, status, 'verification_signin_failed'))
  }
  const result = authPayload(data) as { sub?: string; access_token?: string; refresh_token?: string; expires_in?: number; email_verified?: boolean }
  const uid = result.sub || ''

  // 从 accounts 集合获取 accountId
  let accountId: string | undefined
  let nickname: string | undefined
  try {
    if (db) {
      const accResult = await db.collection('accounts').where({ uid }).limit(1).get()
      if (accResult.data?.length) {
        const acc = accResult.data[0] as { accountId?: string; email?: string; nickname?: string }
        accountId = acc.accountId
        nickname = acc.nickname
        if (!accountId) {
          const refEmail = acc.email || target.target
          accountId = generateStandardAccountId(refEmail)
          await db.collection('accounts').doc((accResult.data[0] as { _id: string })._id).update({ accountId })
        }
      } else {
        accountId = generateStandardAccountId(target.target)
      }
    } else {
      accountId = generateStandardAccountId(target.target)
    }
  } catch (e) {
    console.error('获取 accountId 失败（用规范化算法兜底）:', safeCloudbaseErrorCode(e))
    accountId = generateStandardAccountId(target.target)
  }
  if (!nickname) nickname = generateDefaultNickname(target.target)

  const session: AuthSession = {
    user: {
      uid,
      email: target.type === 'phone' ? `${target.target}@phone.tb` : target.target,
      phone: target.type === 'phone' ? target.target : undefined,
      emailVerified: !!result.email_verified,
      accountId,
      nickname
    },
    accessToken: result.access_token || '',
    refreshToken: result.refresh_token || '',
    expiresAt: Date.now() + (result.expires_in || 7200) * 1000
  }
  currentSession = session
  saveSession(session)
  try { await bindCurrentUserDatabase(session) }
  catch (error) { console.error('[CloudBase] 验证码登录成功，但用户态数据库会话绑定失败:', safeCloudbaseErrorCode(error)) }
  return { user: session.user, accountId }
}

export async function logout(): Promise<void> {
  clearUserDatabaseSession()
  currentSession = null
  clearSession()
}

export async function checkSession(): Promise<LoginResult | null> {
  if (!currentSession) return null
  if (currentSession.expiresAt > Date.now() + 60_000) {
    if (!userDb || userDatabaseUid !== currentSession.user.uid) {
      try { await bindCurrentUserDatabase(currentSession) }
      catch (error) { console.error('[CloudBase] 当前登录仍可本机使用，用户态数据库尚不可用:', safeCloudbaseErrorCode(error)) }
    }
    // session 有效，但确保 accountId 存在
    let accountId = currentSession.user.accountId
    if (!accountId) {
      const uid = currentSession.user.uid
      const refEmail = currentSession.user.email
      try {
        if (db) {
          const accResult = await db.collection('accounts').where({ uid }).limit(1).get()
          if (accResult.data?.length) {
            const acc = accResult.data[0] as { accountId?: string; email?: string }
            accountId = acc.accountId
            if (!accountId) {
              accountId = generateStandardAccountId(acc.email || refEmail)
              await db.collection('accounts').doc((accResult.data[0] as { _id: string })._id).update({ accountId })
            }
            currentSession.user.accountId = accountId
            saveSession(currentSession)
          } else {
            // accounts 集合无记录 — 兜底
            accountId = generateStandardAccountId(refEmail)
            currentSession.user.accountId = accountId
            saveSession(currentSession)
          }
        } else {
          // db 不可用 — 兜底
          accountId = generateStandardAccountId(refEmail)
          currentSession.user.accountId = accountId
          saveSession(currentSession)
        }
      } catch (e) {
        console.error('checkSession 获取 accountId 失败:', safeCloudbaseErrorCode(e))
        // 即便出错也兜底
        accountId = generateStandardAccountId(refEmail)
        currentSession.user.accountId = accountId
      }
    }
    return { user: currentSession.user, accountId }
  }
  if (!currentSession.refreshToken) {
    return { user: currentSession.user, accountId: currentSession.user.accountId }
  }
  try {
    const { ok, data } = await authFetch('/auth/v1/token', {
      grant_type: 'refresh_token', refresh_token: currentSession.refreshToken
    })
    if (!ok) return { user: currentSession.user, accountId: currentSession.user.accountId }
    const t = authPayload(data) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown }
    if (typeof t.access_token !== 'string' || !t.access_token) {
      return { user: currentSession.user, accountId: currentSession.user.accountId }
    }
    currentSession.accessToken = t.access_token
    if (typeof t.refresh_token === 'string' && t.refresh_token) currentSession.refreshToken = t.refresh_token
    currentSession.expiresAt = Date.now() + (typeof t.expires_in === 'number' && Number.isFinite(t.expires_in) ? t.expires_in : 7200) * 1000
    saveSession(currentSession)
    try { await bindCurrentUserDatabase(currentSession) }
    catch (error) { console.error('[CloudBase] 会话刷新成功，但用户态数据库绑定失败:', safeCloudbaseErrorCode(error)) }
    return { user: currentSession.user, accountId: currentSession.user.accountId }
  } catch (error) {
    console.error('[CloudBase] 会话刷新暂不可用；保留本机会话:', safeCloudbaseErrorCode(error))
    return currentSession ? { user: currentSession.user, accountId: currentSession.user.accountId } : null
  }
}

export function getUserId(): string | null {
  return currentSession?.user?.uid || null
}

export function isLoggedIn(): boolean {
  return currentSession !== null && currentSession.expiresAt > Date.now()
}

/** 发送重认证验证码。CloudBase 由 verify_opt 决定发往已绑定的手机或邮箱。 */
export async function sendReauthCode(verifyOpt?: 'phone_code' | 'email_code'): Promise<void> {
  if (!currentSession) throw new Error('reauth_not_logged_in')
  const binding = await readAuthBindings()
  const hasAuthoritativePhone = !!binding?.phone && !isPlaceholderPhone(binding.phone)
  const selectedOpt = verifyOpt || (hasAuthoritativePhone ? 'phone_code' : 'email_code')
  if (selectedOpt === 'phone_code' && !hasAuthoritativePhone) throw new Error('phone_not_bound')
  if (selectedOpt === 'email_code' && !binding?.email) throw new Error('email_not_bound')
  const { ok, data } = await authFetch('/auth/v1/user/reauthenticate', {
    verify_opt: selectedOpt
  }, currentSession.accessToken)
  if (!ok) {
    const e = data as { error_description?: string; error?: string }
    throw new Error(e.error_description || e.error || 'reauth_failed')
  }
}

/** 修改密码（已登录用户，使用当前会话和 reauthenticate 验证码）。 */
export async function changePassword(
  newPassword: string,
  verificationCode: string,
  oldPassword?: string
): Promise<void> {
  if (!currentSession) throw new Error('reauth_not_logged_in')
  if (!verificationCode) throw new Error('verification_required')
  const body: Record<string, string> = {
    new_password: newPassword,
    confirm_password: newPassword,
    verify_code: verificationCode
  }
  if (oldPassword) body.old_password = oldPassword
  const { ok, data, status } = await authFetch('/auth/v1/user/password', {
    ...body
  }, currentSession.accessToken, 'PATCH')
  if (!ok) {
    const error = data as { error?: string; error_description?: string }
    throw new Error(error.error_description || error.error || `password_change_failed: HTTP ${status}`)
  }
}

/**
 * 重置密码：验证码必须由 target=USER 申请。验证后以 verification_token 登录目标账号，
 * 再用该短时认证会话调用原生改密接口；不经过管理员云函数或 accounts 映射。
 */
export async function resetPassword(identifier: string, newPassword: string, verificationCode: string, verificationId: string): Promise<void> {
  if (!identifier || !newPassword || !verificationCode || !verificationId) throw new Error('verification_required')
  const verificationToken = await verifyCode(verificationId, verificationCode)
  const { ok: signInOk, data: signInData, status: signInStatus } = await authFetch('/auth/v1/signin', {
    username: /^\d{11}$/.test(identifier) ? '+86 ' + identifier : identifier,
    verification_token: verificationToken
  })
  if (!signInOk) {
    const error = signInData as { error?: string; error_description?: string }
    throw new Error(error.error_description || error.error || `verification_signin_failed: HTTP ${signInStatus}`)
  }
  const signedIn = authPayload(signInData) as { access_token?: string }
  if (!signedIn.access_token) throw new Error('verification_signin_failed')
  const { ok, data, status } = await authFetch('/auth/v1/user/password', {
    new_password: newPassword,
    confirm_password: newPassword,
    verify_code: verificationCode
  }, signedIn.access_token, 'PATCH')
  if (!ok) {
    const error = data as { error?: string; error_description?: string }
    throw new Error(error.error_description || error.error || `password_change_failed: HTTP ${status}`)
  }
}

// ─── Database Operations ──────────────────────────

function ensureDbAndUser(): { userId: string; database: UserCloudDatabase } {
  const userId = getUserId()
  if (!userId || !isLoggedIn()) throw new Error('reauth_required')
  if (!userDb || userDatabaseUid !== userId) {
    throw new Error(userDatabaseError ? `cloud_user_database_unavailable:${userDatabaseError}` : 'cloud_user_database_unavailable')
  }
  return { userId, database: userDb }
}

export async function upsertRemoteBill(bill: BillRow): Promise<void> {
  try {
    const { userId, database } = ensureDbAndUser()
    const remote = {
      localId: bill.id, userId,
      amount: bill.amount, category1: bill.category1, category2: bill.category2,
      date: bill.date, note: bill.note, type: bill.type,
      created_at: bill.created_at || new Date().toISOString(),
      updated_at: bill.updated_at || new Date().toISOString()
    }
    const existing = bill.cloud_id
      ? { data: [{ _id: bill.cloud_id }] }
      : await database.collection('bills').where({ localId: bill.id, userId }).get()
    if (existing.data?.length) {
      await database.collection('bills').doc(existing.data[0]._id).update(remote)
      setBillCloudId(bill.id, existing.data[0]._id)
    } else {
      const added = await database.collection('bills').add(remote)
      const cloudId = (added as { id?: string }).id
      if (cloudId) setBillCloudId(bill.id, cloudId)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`同步账单失败 (localId=${bill.id}):`, safeCloudbaseErrorCode(msg))
    throw new Error(`cloud_sync_bill_failed: ${msg}`)
  }
}

export async function deleteRemoteBill(localId: number): Promise<void> {
  try {
    const { userId, database } = ensureDbAndUser()
    const local = getBills().find(bill => bill.id === localId)
    const existing = local?.cloud_id
      ? { data: [{ _id: local.cloud_id }] }
      : await database.collection('bills').where({ localId, userId }).get()
    if (existing.data?.length) await database.collection('bills').doc(existing.data[0]._id).remove()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`删除云端账单失败 (localId=${localId}):`, safeCloudbaseErrorCode(msg))
    throw new Error(`cloud_delete_bill_failed: ${msg}`)
  }
}

export async function upsertRemoteCategory(cat: CategoryRow): Promise<void> {
  try {
    const { userId, database } = ensureDbAndUser()
    const remote = {
      localId: cat.id, userId,
      name: cat.name, icon: cat.icon, children: cat.children,
      type: cat.type, is_preset: cat.is_preset, sort_order: cat.sort_order,
      created_at: cat.created_at,
      updated_at: cat.updated_at || new Date().toISOString()
    }
    const existing = cat.cloud_id
      ? { data: [{ _id: cat.cloud_id }] }
      : await database.collection('categories').where({ localId: cat.id, userId }).get()
    if (existing.data?.length) {
      await database.collection('categories').doc(existing.data[0]._id).update(remote)
      setCategoryCloudId(cat.id, existing.data[0]._id)
    } else {
      const added = await database.collection('categories').add(remote)
      const cloudId = (added as { id?: string }).id
      if (cloudId) setCategoryCloudId(cat.id, cloudId)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`同步分类失败 (localId=${cat.id}):`, safeCloudbaseErrorCode(msg))
    throw new Error(`cloud_sync_category_failed: ${msg}`)
  }
}

export async function deleteRemoteCategory(localId: number): Promise<void> {
  try {
    const { userId, database } = ensureDbAndUser()
    const local = getCategories().find(category => category.id === localId)
    const existing = local?.cloud_id
      ? { data: [{ _id: local.cloud_id }] }
      : await database.collection('categories').where({ localId, userId }).get()
    if (existing.data?.length) await database.collection('categories').doc(existing.data[0]._id).remove()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`删除云端分类失败 (localId=${localId}):`, safeCloudbaseErrorCode(msg))
    throw new Error(`cloud_delete_category_failed: ${msg}`)
  }
}

// ─── Recurring（周期支出规则）云同步，v2.0。结构对齐 bills/categories 的 upsert 模式 ──

export async function upsertRemoteRecurring(rec: RecurringRow): Promise<void> {
  try {
    const { userId, database } = ensureDbAndUser()
    const remote = {
      localId: rec.id, userId,
      name: rec.name, amount: rec.amount, type: rec.type,
      cycle_unit: rec.cycle_unit, cycle_interval: rec.cycle_interval,
      next_date: rec.next_date, category1: rec.category1,
      category2: rec.category2, payment_platform: rec.payment_platform,
      fund_account: rec.fund_account, note: rec.note, paused: rec.paused,
      trade_day_only: rec.trade_day_only,
      symbol: rec.symbol ?? null,
      auto_post: rec.auto_post ?? 0,
      created_at: rec.created_at || new Date().toISOString(),
      updated_at: rec.updated_at || new Date().toISOString()
    }
    const existing = rec.cloud_id
      ? { data: [{ _id: rec.cloud_id }] }
      : await database.collection('recurrings').where({ localId: rec.id, userId }).get()
    if (existing.data?.length) {
      await database.collection('recurrings').doc(existing.data[0]._id).update(remote)
      setRecurringCloudId(rec.id, existing.data[0]._id)
    } else {
      const added = await database.collection('recurrings').add(remote)
      const cloudId = (added as { id?: string }).id
      if (cloudId) setRecurringCloudId(rec.id, cloudId)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`同步周期支出规则失败 (localId=${rec.id}):`, safeCloudbaseErrorCode(msg))
    throw new Error(`cloud_sync_recurring_failed: ${msg}`)
  }
}

export async function deleteRemoteRecurring(localId: number): Promise<void> {
  try {
    const { userId, database } = ensureDbAndUser()
    const local = getRecurrings().find(rec => rec.id === localId)
    const existing = local?.cloud_id
      ? { data: [{ _id: local.cloud_id }] }
      : await database.collection('recurrings').where({ localId, userId }).get()
    if (existing.data?.length) await database.collection('recurrings').doc(existing.data[0]._id).remove()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`删除云端周期支出规则失败 (localId=${localId}):`, safeCloudbaseErrorCode(msg))
    throw new Error(`cloud_delete_recurring_failed: ${msg}`)
  }
}

// ─── Investment snapshots cloud sync (stable user + asset key) ─────

/** Stable CloudBase document ID prevents device-local SQLite ids from colliding. */
export async function upsertRemoteInvestmentPosition(position: InvestmentPositionRow): Promise<string> {
  try {
    const { userId, database } = ensureDbAndUser()
    const documentId = investmentDocumentId(userId, position.asset_key)
    const remote = {
      userId,
      asset_key: position.asset_key,
      name: position.name,
      asset_type: position.asset_type,
      quantity: position.quantity,
      cost_basis: position.cost_basis,
      market_value: position.market_value,
      currency: position.currency,
      as_of: position.as_of,
      quantity_kind: position.quantity_kind,
      cost_basis_kind: position.cost_basis_kind,
      cash_flows: position.cash_flows,
      cash_flows_complete: position.cash_flows_complete,
      source_note: position.source_note,
      created_at: position.created_at,
      updated_at: position.updated_at
    }
    let currentWriteError: unknown = null
    try {
      await upsertInvestmentCloudCurrent(database as unknown as InvestmentCloudDatabase, documentId, remote as InvestmentCloudRecord)
    } catch (error) {
      currentWriteError = error
    }
    const snapshots = getInvestmentSnapshotHistory(position.asset_key)
    for (const snapshot of snapshots) {
      const snapshotId = investmentSnapshotDocumentId(userId, snapshot.asset_key, snapshot.as_of)
      await upsertInvestmentCloudSnapshot(database as unknown as InvestmentCloudDatabase, snapshotId, {
        userId,
        asset_key: snapshot.asset_key,
        name: snapshot.name,
        asset_type: snapshot.asset_type,
        quantity: snapshot.quantity,
        quantity_kind: snapshot.quantity_kind,
        cost_basis: snapshot.cost_basis,
        cost_basis_kind: snapshot.cost_basis_kind,
        market_value: snapshot.market_value,
        currency: snapshot.currency,
        as_of: snapshot.as_of,
        source_note: snapshot.source_note,
        cash_flows: snapshot.cash_flows,
        cash_flows_complete: snapshot.cash_flows_complete,
        operation_id: snapshot.operation_id,
        recorded_at: snapshot.recorded_at
      } as InvestmentCloudSnapshotRecord)
    }
    if (currentWriteError) throw currentWriteError
    return documentId
  } catch (error) {
    const errorCode = safeCloudbaseErrorCode(error)
    console.error('同步投资持仓失败:', errorCode)
    throw new Error(`cloud_sync_investment_failed:${errorCode}`)
  }
}

export async function deleteRemoteInvestmentPosition(assetKey: string): Promise<void> {
  try {
    const { userId, database } = ensureDbAndUser()
    await database.collection('investment_positions').where({
      _id: investmentDocumentId(userId, assetKey),
      userId,
      asset_key: assetKey
    }).remove()
    const history = await database.collection('investment_snapshots').where({ userId, asset_key: assetKey }).get()
    for (const row of (history.data || []) as Array<{ _id: string }>) {
      await database.collection('investment_snapshots').where({
        _id: row._id,
        userId,
        asset_key: assetKey
      }).remove()
    }
  } catch (error) {
    throw new Error(`cloud_delete_investment_failed:${safeCloudbaseErrorCode(error)}`)
  }
}

// ─── Cloud → Local Sync (Login) ─────────────────

interface CloudBill {
  amount: number
  category1: string
  category2: string
  date: string
  note: string
  type: string
  created_at: string
  updated_at: string
  userId: string
  localId: number
}

interface CloudCategory {
  name: string
  icon: string
  children: string
  type: string
  is_preset: number
  sort_order: number
  created_at: string
  updated_at: string
  userId: string
  localId: number
}

/** 云端周期支出规则的原始记录形态（v2.0），由 insertCloudRecurrings 消费 */
interface CloudRecurring {
  name: string
  amount: number
  type: string
  cycle_unit: string
  cycle_interval: number
  next_date: string
  category1: string
  category2?: string | null
  payment_platform?: string | null
  fund_account?: string | null
  note?: string | null
  paused?: number
  trade_day_only?: number
  symbol?: string | null
  auto_post?: number
  created_at: string
  updated_at: string
  userId: string
  localId: number
  _id?: string
}

/**
 * 从云端拉取当前用户的账单数据。
 * 返回原始云端记录数组，由调用方决定如何写入本地数据库。
 * The authenticated user's JS SDK database session is used; authorization rules still apply.
 */
export async function pullBillsFromCloud(): Promise<CloudBill[]> {
  const { userId, database } = ensureDbAndUser()

  try {
    const data: CloudBill[] = []
    const pageSize = 1000
    let offset = 0
    while (true) {
      const result = await database.collection('bills').where({ userId }).skip(offset).limit(pageSize).get()
      const page = (result.data || []) as CloudBill[]
      data.push(...page)
      if (page.length < pageSize) break
      offset += page.length
    }
    return data
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('从云端拉取账单失败:', safeCloudbaseErrorCode(msg))
    throw new Error(`cloud_pull_bills_failed: ${msg}`)
  }
}

/**
 * 从云端拉取当前用户的分类数据。
 */
export async function pullCategoriesFromCloud(): Promise<CloudCategory[]> {
  const { userId, database } = ensureDbAndUser()

  try {
    const data: CloudCategory[] = []
    const pageSize = 100
    let offset = 0
    while (true) {
      const result = await database.collection('categories').where({ userId }).skip(offset).limit(pageSize).get()
      const page = (result.data || []) as CloudCategory[]
      data.push(...page)
      if (page.length < pageSize) break
      offset += page.length
    }
    return data
  } catch (e) {
    console.error('从云端拉取分类失败:', safeCloudbaseErrorCode(e))
    throw new Error(`cloud_pull_categories_failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * 从云端拉取当前用户的周期支出规则（v2.0）。
 */
export async function pullRecurringsFromCloud(): Promise<CloudRecurring[]> {
  const { userId, database } = ensureDbAndUser()

  try {
    const data: CloudRecurring[] = []
    const pageSize = 100
    let offset = 0
    while (true) {
      const result = await database.collection('recurrings').where({ userId }).skip(offset).limit(pageSize).get()
      const page = (result.data || []) as CloudRecurring[]
      data.push(...page)
      if (page.length < pageSize) break
      offset += page.length
    }
    return data
  } catch (e) {
    console.error('从云端拉取周期支出规则失败:', safeCloudbaseErrorCode(e))
    throw new Error(`cloud_pull_recurrings_failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Pull current-account investment rows. Errors are propagated so callers can
 * distinguish a missing/unavailable collection from a genuinely empty result.
 */
export async function pullInvestmentPositionsFromCloud(): Promise<CloudInvestmentPosition[]> {
  const { userId, database } = ensureDbAndUser()
  const rows: CloudInvestmentPosition[] = []
  const pageSize = 100
  let offset = 0
  try {
    while (true) {
      const result = await database.collection('investment_positions').where({ userId }).skip(offset).limit(pageSize).get()
      const page = (result.data || []) as Array<Record<string, unknown>>
      const normalized = page.map((record) => ({
        asset_key: record.asset_key,
        name: record.name,
        asset_type: record.asset_type,
        quantity: record.quantity,
        cost_basis: record.cost_basis,
        market_value: record.market_value,
        currency: record.currency,
        as_of: record.as_of,
        source_note: record.source_note,
        ...(Object.prototype.hasOwnProperty.call(record, 'quantity_kind') ? { quantity_kind: record.quantity_kind } : {}),
        ...(Object.prototype.hasOwnProperty.call(record, 'cost_basis_kind') ? { cost_basis_kind: record.cost_basis_kind } : {}),
        ...(Object.prototype.hasOwnProperty.call(record, 'cash_flows') ? { cash_flows: record.cash_flows } : {}),
        ...(Object.prototype.hasOwnProperty.call(record, 'cash_flows_complete') ? { cash_flows_complete: record.cash_flows_complete } : {})
      }))
      const validation = validateInvestmentBatch(normalized)
      if (!validation.valid) throw new Error(`云端持仓格式无效：${validation.errors[0]?.message || 'unknown'}`)
      for (let index = 0; index < page.length; index++) {
        const record = page[index]
        rows.push({
          ...validation.holdings[index],
          userId,
          created_at: typeof record.created_at === 'string' ? record.created_at : new Date(0).toISOString(),
          updated_at: typeof record.updated_at === 'string' ? record.updated_at : new Date(0).toISOString(),
          ...(typeof record._id === 'string' ? { _id: record._id } : {})
        })
      }
      if (page.length < pageSize) break
      offset += page.length
    }
    return rows
  } catch (error) {
    const errorCode = safeCloudbaseErrorCode(error)
    console.error('从 CloudBase 拉取投资持仓失败:', errorCode)
    throw new Error(`cloud_pull_investments_failed:${errorCode}`)
  }
}

/** Pull immutable-per-date confirmed snapshots. Older installations may not have this collection yet. */
export async function pullInvestmentSnapshotsFromCloud(): Promise<{
  rows: CloudInvestmentSnapshot[]
  collectionAvailable: boolean
}> {
  const { userId, database } = ensureDbAndUser()
  const rows: CloudInvestmentSnapshot[] = []
  const pageSize = 100
  let offset = 0
  try {
    while (true) {
      const query = database.collection('investment_snapshots').where({ userId }).skip(offset).limit(pageSize)
      let page: Array<Record<string, unknown>>
      if (offset === 0) {
        const firstPage = await readOptionalCloudBaseCollectionPage(() => query.get())
        if (!firstPage.collectionAvailable) return { rows: [], collectionAvailable: false }
        page = firstPage.data as Array<Record<string, unknown>>
      } else {
        const result = await query.get()
        page = (result.data || []) as Array<Record<string, unknown>>
      }
      const normalized = page.map((record) => ({
        asset_key: record.asset_key,
        name: record.name,
        asset_type: record.asset_type,
        quantity: record.quantity,
        cost_basis: record.cost_basis,
        market_value: record.market_value,
        currency: record.currency,
        as_of: record.as_of,
        source_note: record.source_note,
        ...(Object.prototype.hasOwnProperty.call(record, 'quantity_kind') ? { quantity_kind: record.quantity_kind } : {}),
        ...(Object.prototype.hasOwnProperty.call(record, 'cost_basis_kind') ? { cost_basis_kind: record.cost_basis_kind } : {}),
        ...(Object.prototype.hasOwnProperty.call(record, 'cash_flows') ? { cash_flows: record.cash_flows } : {}),
        ...(Object.prototype.hasOwnProperty.call(record, 'cash_flows_complete') ? { cash_flows_complete: record.cash_flows_complete } : {})
      }))
      const validation = validateInvestmentBatch(normalized)
      if (!validation.valid) throw new Error(`云端快照格式无效：${validation.errors[0]?.message || 'unknown'}`)
      for (let index = 0; index < page.length; index++) {
        const record = page[index]
        const operationId = typeof record.operation_id === 'string' ? record.operation_id : ''
        const recordedAt = typeof record.recorded_at === 'string' ? record.recorded_at : new Date(0).toISOString()
        rows.push({
          ...validation.holdings[index], operation_id: operationId, recorded_at: recordedAt,
          userId,
          ...(typeof record._id === 'string' ? { _id: record._id } : {})
        })
      }
      if (page.length < pageSize) break
      offset += page.length
    }
    return { rows, collectionAvailable: true }
  } catch (error) {
    const errorCode = safeCloudbaseErrorCode(error)
    console.error('从 CloudBase 拉取投资快照失败:', errorCode)
    throw new Error(`cloud_pull_investment_snapshots_failed:${errorCode}`)
  }
}

// ─── Account Binding ──────────────────────────────

export interface AccountInfo {
  accountId: string
  email: string
  phone: string
  nickname?: string
}

function normalizeAuthPhone(value: unknown): string {
  const raw = String(value || '').trim()
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 13 && digits.startsWith('86')) return digits.slice(2)
  return digits.length === 11 ? digits : raw
}

function isPlaceholderEmail(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return !normalized || normalized.endsWith('@phone.tb') || normalized.endsWith('@thunder.invalid') || normalized.endsWith('@lgs.invalid')
}

function isPlaceholderPhone(value: string): boolean {
  const normalized = value.replace(/\s/g, '')
  return !normalized || normalized.startsWith('+86140') || normalized.startsWith('86140') || normalized.startsWith('140')
}

function authPayload(data: Record<string, unknown>): Record<string, unknown> {
  return data.data && typeof data.data === 'object' && !Array.isArray(data.data)
    ? data.data as Record<string, unknown>
    : data
}

/** 从 CloudBase Auth 读取真实绑定状态；accounts 不可用时仍可工作。 */
async function readAuthBindings(): Promise<Pick<AccountInfo, 'email' | 'phone'> | null> {
  if (!currentSession?.accessToken) return null
  try {
    const { ok, data } = await authFetch('/auth/v1/user/me', {}, currentSession.accessToken, 'GET')
    if (!ok) return null
    const profile = authPayload(data)
    const email = String(profile.email || '')
    const phone = normalizeAuthPhone(profile.phone_number || profile.phone)
    if (email || phone) {
      currentSession.user = {
        ...currentSession.user,
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {})
      }
      saveSession(currentSession)
    }
    return { email, phone }
  } catch (e) {
    console.warn('读取 CloudBase Auth 绑定信息失败，将使用本地映射:', safeCloudbaseErrorCode(e))
    return null
  }
}

/**
 * 获取当前用户的账号绑定信息。
 * 多层 fallback：accounts 集合 → 当前 session → null。
 */
export async function getAccountBindings(): Promise<AccountInfo | null> {
  const userId = getUserId()
  if (!userId) return null

  // Auth 是手机号/邮箱的权威来源；先读它，避免无 API Key 或映射延迟时显示旧状态。
  const authBinding = await readAuthBindings()

  // 1. 从 accounts 集合查（最权威）
  if (db) {
    try {
      const result = await db.collection('accounts').where({ uid: userId }).limit(1).get()
      if (result.data?.length) {
        const a = result.data[0] as AccountInfo & { uid: string; createdAt?: string }
        const resolved = {
          accountId: a.accountId || '',
          email: authBinding?.email || a.email || '',
          phone: authBinding?.phone || a.phone || '',
          nickname: (a as { nickname?: string }).nickname
        }
        if (authBinding && (resolved.email !== a.email || resolved.phone !== a.phone)) {
          try {
            await db.collection('accounts').doc(result.data[0]._id).update({
              email: resolved.email,
              phone: resolved.phone
            })
          } catch (e) {
            console.warn('Auth 绑定状态已读取，但 accounts 映射回写失败:', safeCloudbaseErrorCode(e))
          }
        }
        return {
          ...resolved
        }
      }
    } catch (e) {
      console.error('获取账号绑定信息失败:', safeCloudbaseErrorCode(e))
      // 继续 fallback
    }
  }

  // 2. Fallback：从 Auth/当前 session 构造（db 不可用时）
  if (currentSession) {
    return {
      accountId: currentSession.user.accountId || '',
      email: authBinding?.email || currentSession.user.email,
      phone: authBinding?.phone || currentSession.user.phone || '',
      nickname: currentSession.user.nickname
    }
  }

  return null
}

// ─── Binding with Verification ─────────────────────

/**
 * 发送绑定用验证码。对指定邮箱/手机号发送验证码，返回 verificationId。
 * 与 sendVerificationCode 的区别：此函数不检查 isUser 状态，始终发送。
 */
export async function sendBindVerificationCode(target: string): Promise<{ verificationId: string; type: 'email' | 'phone'; expiresIn: number }> {
  const isPhone = /^\d{11}$/.test(target)
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)
  if (!isPhone && !isEmail) throw new Error('invalid_target')

  const body: Record<string, string> = { target: 'ANY' }
  if (isPhone) {
    body.phone_number = '+86 ' + target
  } else {
    body.email = target
  }
  body.target = 'ANY'

  if (!currentSession?.accessToken) {
    throw new Error('reauth_not_logged_in')
  }

  // 验证码发送接口本身按 CloudBase Auth 契约不需要携带旧会话；
  // 当前会话只用于确认这是已登录用户的绑定操作。
  const { ok, data, status } = await authFetch('/auth/v1/verification', body)
  if (!ok) {
    throw new Error(authError(data, status, 'verification_code_send_failed'))
  }

  const d = authPayload(data) as { verification_id?: string; expires_in?: number }
  if (!d.verification_id) throw new Error('verification_code_missing_id')
  return { verificationId: d.verification_id, type: isPhone ? 'phone' : 'email', expiresIn: Number(d.expires_in) || 600 }
}

/** 获取已有绑定渠道的验证码，用于账户关联前换取 sudo_token。 */
export async function sendBindingReauthCode(): Promise<{ verificationId: string; type: 'email' | 'phone'; expiresIn: number }> {
  if (!currentSession?.accessToken) throw new Error('reauth_not_logged_in')
  const binding = await readAuthBindings()
  const phone = binding?.phone && !isPlaceholderPhone(binding.phone) ? binding.phone.replace(/\s/g, '').replace(/^\+86/, '') : ''
  const email = binding?.email && !isPlaceholderEmail(binding.email) ? binding.email : ''
  const isPhone = !!phone
  if (!isPhone && !email) throw new Error('binding_reauth_target_missing')
  const body: Record<string, string> = { target: 'USER' }
  if (isPhone) body.phone_number = '+86 ' + phone
  else body.email = email
  const { ok, data, status } = await authFetch('/auth/v1/verification', body)
  if (!ok) throw new Error(authError(data, status, 'binding_reauth_code_send_failed'))
  const d = authPayload(data) as { verification_id?: string; expires_in?: number }
  if (!d.verification_id) throw new Error('verification_code_missing_id')
  return { verificationId: d.verification_id, type: isPhone ? 'phone' : 'email', expiresIn: Number(d.expires_in) || 600 }
}

/**
 * 绑定邮箱（验证码确认）。
 * 发送验证码到新邮箱 → 用户输入验证码 → 调用此函数验证并绑定。
 */
export async function bindEmail(newEmail: string, code: string, verificationId: string, reauthCode: string, reauthVerificationId: string): Promise<void> {
  const userId = getUserId()
  if (!userId) throw new Error('未登录')

  if (!reauthCode || !reauthVerificationId) throw new Error('binding_reauth_required')
  // 必须先用已有绑定渠道的验证码换取 sudo_token，再验证新邮箱验证码。
  const existingToken = await verifyCode(reauthVerificationId, reauthCode)
  const sudo = await authFetch('/auth/v1/user/sudo', { verification_token: existingToken }, currentSession!.accessToken)
  if (!sudo.ok) throw new Error(authError(sudo.data, sudo.status, 'auth_binding_sudo_failed'))
  const sudoToken = (authPayload(sudo.data) as { sudo_token?: string }).sudo_token
  if (!sudoToken) throw new Error('auth_binding_sudo_missing')
  const verificationToken = await verifyCode(verificationId, code)

  // Auth 是绑定的权威来源，不能因本地 accounts 映射不可用而跳过真实绑定。
  await updateAuthContact({ email: newEmail }, verificationToken, sudoToken)
  cacheAuthBinding({ email: newEmail })
  await persistAccountBinding(userId, { email: newEmail })
}

/**
 * 解绑邮箱（验证码确认）。
 * 发送验证码到当前邮箱 → 用户输入验证码 → 调用此函数验证并解绑。
 * 至少保留手机号绑定，否则拒绝解绑。
 */
export async function unbindEmail(code: string, verificationId: string): Promise<void> {
  const userId = getUserId()
  if (!userId) throw new Error('未登录')

  // Auth 是权威来源；没有 API Key 时也能读取当前绑定并完成换绑。
  const account = await getAccountBindings()
  if (!account) throw new Error('account_not_found')

  // 验证验证码（发送到当前邮箱）
  const verificationToken = await verifyCode(verificationId, code)

  // 至少保留手机号绑定
  if (isPlaceholderPhone(account.phone)) throw new Error('cannot_remove_last_binding')

  // CloudBase basic/edit 不接受空邮箱；用合法且唯一的占位值释放旧邮箱。
  const unboundEmail = makeUnboundEmail(userId)
  await updateAuthBasicInfo({ email: unboundEmail }, verificationToken)
  cacheAuthBinding({ email: unboundEmail })
  await persistAccountBinding(userId, { email: '' })
}

/**
 * 绑定手机号到当前用户账号（验证码确认）。
 */
export async function bindPhone(phone: string, code: string, verificationId: string): Promise<void> {
  const userId = getUserId()
  if (!userId) throw new Error('未登录')

  // 验证验证码
  const verificationToken = await verifyCode(verificationId, code)

  // Auth 会校验手机号唯一性；本地 accounts 只是可选的应用侧映射。
  await updateAuthBasicInfo({ phone: '+86 ' + phone }, verificationToken)
  cacheAuthBinding({ phone })
  await persistAccountBinding(userId, { phone })
}

/**
 * Auth 绑定成功后再写应用映射。
 * 映射失败必须显式报告，避免 UI 声称“绑定成功”但 accounts 仍未持久化。
 */
async function persistAccountBinding(userId: string, binding: { email?: string; phone?: string }): Promise<void> {
  if (!db) {
    console.warn('binding_mapping_pending: CloudBase Auth 已完成，等待 accounts 映射恢复同步。')
    return
  }
  try {
    const result = await db.collection('accounts').where({ uid: userId }).limit(1).get()
    if (!result.data?.length) {
      console.warn('binding_mapping_pending: CloudBase Auth 已完成，但 accounts 记录不存在。')
      return
    }
    await db.collection('accounts').doc(result.data[0]._id).update(binding)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.warn(`binding_mapping_pending: CloudBase Auth 已完成，但账号映射同步失败（${safeCloudbaseErrorCode(message)}）。`, safeCloudbaseErrorCode(e))
  }
}

function cacheAuthBinding(binding: { email?: string; phone?: string }): void {
  if (!currentSession) return
  currentSession.user = { ...currentSession.user, ...binding }
  saveSession(currentSession)
}

/**
 * 解绑当前用户的手机号（验证码确认）。
 * 至少保留邮箱绑定，否则拒绝解绑。
 */
export async function unbindPhone(code: string, verificationId: string): Promise<void> {
  const userId = getUserId()
  if (!userId) throw new Error('未登录')

  const account = await getAccountBindings()
  if (!account) throw new Error('account_not_found')

  // 验证验证码（发送到当前手机号）
  const verificationToken = await verifyCode(verificationId, code)

  // 至少保留邮箱绑定
  if (isPlaceholderEmail(account.email)) throw new Error('cannot_remove_last_binding')

  // CloudBase basic/edit 不接受空手机号；用合法且唯一的占位值释放旧手机号。
  const unboundPhone = makeUnboundPhone(userId)
  await updateAuthBasicInfo({ phone: unboundPhone }, verificationToken)
  cacheAuthBinding({ phone: unboundPhone })
  await persistAccountBinding(userId, { phone: '' })
}

function stableBindingHash(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function makeUnboundEmail(userId: string): string {
  return `unbound-${stableBindingHash(`${userId}:email`).toString(36)}@thunder.invalid`
}

function makeUnboundPhone(userId: string): string {
  // 140 为参考项目采用的保留号段，避免解绑占位值误占用真实号码。
  const suffix = String(stableBindingHash(`${userId}:phone`) % 100_000_000).padStart(8, '0')
  return `+86 140${suffix}`
}

/**
 * 按 CloudBase Auth 账户关联契约更新真实身份绑定。
 * 账户关联不是普通 basic/edit：需要 verification_token 换取 sudo_token，
 * 再调用 /user/contact 携带两个 token；accounts 只是应用侧映射表。
 */
async function updateAuthBasicInfo(binding: { email?: string; phone?: string }, verificationToken: string): Promise<void> {
  if (!currentSession?.accessToken) throw new Error('reauth_not_logged_in')
  const sudo = await authFetch('/auth/v1/user/sudo', { verification_token: verificationToken }, currentSession.accessToken)
  if (!sudo.ok) throw new Error(authError(sudo.data, sudo.status, 'auth_binding_sudo_failed'))
  const sudoPayload = authPayload(sudo.data) as { sudo_token?: string }
  if (!sudoPayload.sudo_token) throw new Error('auth_binding_sudo_missing')

  const result = await authFetch('/auth/v1/user/contact', {
    ...binding,
    verification_token: verificationToken,
    sudo_token: sudoPayload.sudo_token
  }, currentSession.accessToken, 'PATCH')
  if (!result.ok) throw new Error(authError(result.data, result.status, 'auth_binding_update_failed'))
}

async function updateAuthContact(binding: { email?: string; phone?: string }, verificationToken: string, sudoToken: string): Promise<void> {
  if (!currentSession?.accessToken) throw new Error('reauth_not_logged_in')
  const result = await authFetch('/auth/v1/user/contact', {
    ...binding,
    verification_token: verificationToken,
    sudo_token: sudoToken
  }, currentSession.accessToken, 'PATCH')
  if (!result.ok) throw new Error(authError(result.data, result.status, 'auth_binding_update_failed'))
}

// ─── Account Deletion ──────────────────────────────

/**
 * 注销账号：仅删除当前认证用户。远端业务数据必须由具备最小权限的、可重试的
 * 服务端清理任务处理；绝不能在 Auth 删除前由客户端或公开函数先删数据。
 */
export async function deleteAccount(code: string): Promise<{ cleanupPending: boolean }> {
  if (!currentSession?.accessToken) throw new Error('reauth_not_logged_in')
  if (!code) throw new Error('verification_required')
  const res = await fetch(DELETE_ACCOUNT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: currentSession.accessToken, verify_code: code })
  })
  const raw = await res.json().catch(() => ({})) as Record<string, unknown>
  const data = (raw.data && typeof raw.data === 'object' ? raw.data : raw) as { code?: number; message?: string; cleanup_pending?: boolean }
  const result = resolveAccountDeletionResponse(res.status, data)

  // Auth 删除成功后才清理本地状态。cleanup_pending 表示远端清理由 saga 重试，不是假报已清理。
  let localCleanupError: string | null = null
  try {
    clearAllData()
    const dbPath = getDbPath()
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath)
    }
  } catch (e) {
    localCleanupError = (e as Error).message
  }

  // 无论本地清理是否成功，Auth 已删除后都必须清除本机会话，避免继续使用失效 token。
  currentSession = null
  clearUserDatabaseSession()
  clearSession()

  if (localCleanupError) throw new Error(`local_cleanup_failed: ${localCleanupError}`)
  return result
}

// ─── User Stats ────────────────────────────────────

export interface UserStats {
  billCount: number
  categoryCount: number
  totalExpense: number
  totalIncome: number
}

/**
 * 获取当前用户的统计数据（从本地数据库）。
 */
export async function getUserStats(): Promise<UserStats> {
  try {
    const bills = getBills()
    const cats = getCategories()
    const totalExpense = bills
      .filter(b => b.type === 'expense')
      .reduce((sum, b) => sum + b.amount, 0)
    const totalIncome = bills
      .filter(b => b.type === 'income')
      .reduce((sum, b) => sum + b.amount, 0)
    return {
      billCount: bills.length,
      categoryCount: cats.length,
      totalExpense: Math.round(totalExpense * 100) / 100,
      totalIncome: Math.round(totalIncome * 100) / 100
    }
  } catch (e) {
    console.error('获取用户统计失败:', safeCloudbaseErrorCode(e))
    return { billCount: 0, categoryCount: 0, totalExpense: 0, totalIncome: 0 }
  }
}
