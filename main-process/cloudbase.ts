import cloudbase from '@cloudbase/node-sdk'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { BillRow, CategoryRow } from './database'
import { clearAllData, getDbPath, getBills, getCategories, setBillCloudId, setCategoryCloudId } from './database'
import { saveCredentials as safeSave, loadCredentials as safeLoad, clearCredentials } from './credential-store'

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
 * 生产环境无 .env 文件时 API_KEY 为空字符串，云同步和云端账号功能不可用。
 * 通过动态属性名访问 process.env，避免 electron-vite 构建时静态替换。
 */
function getApiKey(): string {
  const env = process.env as Record<string, string | undefined>
  return (env['CLOUDBASE_API_KEY'] || env['CLOUDBASE_APIKEY'] || '').trim()
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

export function initCloudBase(): void {
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
    console.warn('⚠ CloudBase API Key not set. Cloud sync and cloud account features will be unavailable.')
  }
  try {
    // 空 accessKey 不能视为已初始化，否则 UI 会错误地显示“云端可用”。
    db = apiKey ? cloudbase.init({ env: ENV_ID, accessKey: apiKey }).database() : null
  } catch (e) {
    db = null
    console.error('CloudBase SDK 初始化失败，云同步功能不可用:', e)
  }
  const saved = loadSession()
  if (saved) currentSession = saved
}

// ─── Remember Credentials ─────────────────────────
// 委托给 credential-store（safeStorage 加密）

export async function saveCredentials(email: string, password: string): Promise<void> {
  try {
    await safeSave(email, password)
  } catch (e) {
    console.error('保存加密凭据失败：', e)
  }
}

export async function loadCredentials(): Promise<{ email: string; password: string }> {
  try {
    const cred = await safeLoad()
    return cred || { email: '', password: '' }
  } catch {
    return { email: '', password: '' }
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
  if (res.status === 401 && retryOn401 && token && currentSession?.refreshToken && endpoint !== '/auth/v1/token') {
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
        return authFetch(endpoint, body, currentSession.accessToken, method, false)
      }
    }
  }
  return { ok: res.ok && !businessError, data, status: res.status }
}

// ─── Auth Functions ───────────────────────────────

// ─── Account ID Standard ──────────────────────────

/** 30 字符可用字符集（排除 I/O/0/1 易混淆字符） */
const ACCOUNT_ID_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** admin 账号邮箱（识别为系统管理员） */
export const ADMIN_EMAIL = '15211073887@163.com'

/** admin 用户专属账号 ID */
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
 * 1. ADMIN_EMAIL → "TBAdmin"
 * 2. 邮箱本地部分含 6+ 位数字 → "TB" + 前 6 位数字（如 d850216088@163.com → "TBD85021"）
 * 3. 邮箱本地部分含 4-5 位数字 → "TB" + 数字部分
 * 4. 邮箱本地部分含 6+ 位字母 → "TB" + 前 6 位大写字母（如 alice@x.com → "TBAlice"）
 * 5. 邮箱本地部分含 3-5 位字母 → "TB" + 大写字母部分
 * 6. 兜底：随机 6 位字符
 *
 * 优点：可读、易记、有规律；缺点：可能重复，所以注册路径必须做唯一性检查。
 */
export function generateStandardAccountId(email: string): string {
  // 1. admin 特殊映射
  if (email === ADMIN_EMAIL) return ADMIN_ACCOUNT_ID

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
  if (email === ADMIN_EMAIL) return 'adminer'
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
  // CloudBase Auth 原生支持手机号登录；不应因本地 accounts 映射不可用而阻断。
  if (/^\d{11}$/.test(identifier)) return identifier
  // 邮箱格式 → 直接返回
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) return identifier

  // 尝试从 accounts 集合查找
  if (db) {
    try {
      const result = await db.collection('accounts').where({
        _or: [
          { accountId: identifier },
          { phone: identifier }
        ]
      }).limit(1).get()

      if (result.data?.length) {
        const account = result.data[0] as { email: string }
        return account.email
      }
    } catch (e) {
      console.error('解析登录标识符失败:', e)
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
  // 手机号格式
  if (/^\d{11}$/.test(identifier)) return { type: 'phone', target: identifier }
  // 邮箱格式
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) return { type: 'email', target: identifier }

  // 账号 ID：通过 accounts 集合查找，手机号优先
  if (db) {
    try {
      const result = await db.collection('accounts').where({ accountId: identifier }).limit(1).get()
      if (result.data?.length) {
        const account = result.data[0] as { phone: string; email: string }
        if (account.phone) return { type: 'phone', target: account.phone }
        if (account.email) return { type: 'email', target: account.email }
      }
    } catch (e) {
      console.error('解析验证码接收方失败:', e)
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
    console.error('创建账号记录失败:', e)
  }
}

export interface SendCodeResult {
  type: 'phone' | 'email'
  target: string
  verificationId: string
  isUser: boolean
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

  const { ok, data } = await authFetch('/auth/v1/verification', body)
  if (!ok) {
    const e = data as { error_description?: string; error?: string }
    throw new Error(e.error_description || e.error || 'verification_code_send_failed')
  }

  const d = authPayload(data) as { verification_id?: string; is_user?: boolean }
  return {
    type: resolvedType || 'email',
    target: resolvedTarget || target,
    verificationId: d.verification_id || '',
    isUser: !!d.is_user
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
    const e = data as { error?: string; error_description?: string }
    if (e.error === 'user_already_exists' || status === 409) throw new Error('user_already_exists')
    throw new Error(e.error_description || e.error || 'signup_failed')
  }
  const u = authPayload(data) as { uid: string; email_verified?: boolean; sub?: string }
  const uid = u.uid || u.sub || ''

  const accountId = generateStandardAccountId(email)
  const nickname = generateDefaultNickname(email)
  await createAccountRecord(email, uid, accountId, nickname)

  return {
    user: { uid, email, emailVerified: !!u.email_verified, accountId, nickname },
    accountId
  }
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
    return {
      user: { uid, email: internalEmail, emailVerified: false, accountId, nickname },
      accountId
    }
  }

  const e = data as { error?: string; error_description?: string }
  if (e.error === 'user_already_exists' || status === 409) throw new Error('user_already_exists')
  // 绝不能把手机号悄悄降级注册为伪邮箱：这会造成真实手机号未绑定，随后登录、改密和注销都无法工作。
  throw new Error(e.error_description || e.error || 'signup_failed')
}

/** 登录 */
export async function loginWithEmail(email: string, password: string): Promise<LoginResult> {
  const isPhone = /^\d{11}$/.test(email)
  const authIdentifier = isPhone ? '+86 ' + email : email
  const { ok, data } = await authFetch('/auth/v1/signin', { username: authIdentifier, password })
  if (!ok) {
    const e = data as { error?: string; error_description?: string }
    if (e.error === 'invalid_username_or_password') throw new Error('invalid_username_or_password')
    if (e.error === 'email_not_verified') throw new Error('email_not_verified')
    throw new Error(e.error_description || e.error || 'signin_failed')
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
    console.error('获取 accountId 失败（用规范化算法兜底）:', e)
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
  // 只返回用户信息，不暴露 token
  return { user: session.user, accountId }
}

/**
 * 验证邮箱/手机验证码（Step 2 of signin）
 * 把 verification_id + verification_code 换成真正的 verification_token
 */
/**
 * 检查云端服务是否可用
 * - 必须有 CloudBase API Key（db 已初始化）
 * - 必须有当前 session（用户已登录）
 * - session.accessToken 必须存在
 */
export function isCloudSyncEnabled(): boolean {
  return !!(cloudApiKey && db && currentSession?.accessToken)
}

export async function verifyCode(verificationId: string, code: string): Promise<string> {
  if (!verificationId) throw new Error('verification_id_required')

  // CloudBase REST API：/auth/v1/verification/verify
  // access_token 可选——已登录用户的绑定/解绑传 token，登录场景不传
  const accessToken = currentSession?.accessToken || ''
  const { ok, data, status } = await authFetch('/auth/v1/verification/verify', {
    verification_id: verificationId,
    verification_code: code
  }, accessToken)
  if (!ok) {
    const e = data as { error?: string; error_description?: string }
    const errorCode = e.error || `http_${status}` || 'verification_code_invalid'
    if (errorCode.includes('expired')) throw new Error('verification_code_expired')
    if (errorCode.includes('invalid') || errorCode.includes('incorrect')) throw new Error('verification_code_invalid')
    throw new Error(e.error_description || errorCode)
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
    const e = data as { error?: string; error_description?: string; error_reason?: string }
    const desc = e.error_description || ''
    const code = e.error || `http_${status}`
    throw new Error(desc ? `${code}|${desc}` : code)
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
    console.error('获取 accountId 失败（用规范化算法兜底）:', e)
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
  return { user: session.user, accountId }
}

export async function logout(): Promise<void> {
  currentSession = null
  clearSession()
}

export async function checkSession(): Promise<LoginResult | null> {
  if (!currentSession) return null
  if (currentSession.expiresAt > Date.now() + 60_000) {
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
        console.error('checkSession 获取 accountId 失败:', e)
        // 即便出错也兜底
        accountId = generateStandardAccountId(refEmail)
        currentSession.user.accountId = accountId
      }
    }
    return { user: currentSession.user, accountId }
  }
  if (!currentSession.refreshToken) return null
  try {
    const { ok, data } = await authFetch('/auth/v1/token', {
      grant_type: 'refresh_token', refresh_token: currentSession.refreshToken
    })
    if (!ok) { currentSession = null; clearSession(); return null }
    const t = authPayload(data) as { access_token: string; refresh_token: string; expires_in: number }
    currentSession.accessToken = t.access_token
    currentSession.refreshToken = t.refresh_token
    currentSession.expiresAt = Date.now() + (t.expires_in || 7200) * 1000
    saveSession(currentSession)
    return { user: currentSession.user, accountId: currentSession.user.accountId }
  } catch {
    currentSession = null; clearSession(); return null
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

function ensureDbAndUser(): { userId: string } {
  if (!db) throw new Error('CloudBase SDK 未初始化')
  const userId = getUserId()
  if (!userId) throw new Error('未登录')
  return { userId }
}

export async function upsertRemoteBill(bill: BillRow): Promise<void> {
  try {
    const { userId } = ensureDbAndUser()
    const remote = {
      localId: bill.id, userId,
      amount: bill.amount, category1: bill.category1, category2: bill.category2,
      date: bill.date, note: bill.note, type: bill.type,
      created_at: bill.created_at || new Date().toISOString(),
      updated_at: bill.updated_at || new Date().toISOString()
    }
    const existing = bill.cloud_id
      ? { data: [{ _id: bill.cloud_id }] }
      : await db!.collection('bills').where({ localId: bill.id, userId }).get()
    if (existing.data?.length) {
      await db!.collection('bills').doc(existing.data[0]._id).update(remote)
      setBillCloudId(bill.id, existing.data[0]._id)
    } else {
      const added = await db!.collection('bills').add(remote)
      const cloudId = (added as { id?: string }).id
      if (cloudId) setBillCloudId(bill.id, cloudId)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`同步账单失败 (localId=${bill.id}):`, msg)
    throw new Error(`cloud_sync_bill_failed: ${msg}`)
  }
}

export async function deleteRemoteBill(localId: number): Promise<void> {
  try {
    const { userId } = ensureDbAndUser()
    const local = getBills().find(bill => bill.id === localId)
    const existing = local?.cloud_id
      ? { data: [{ _id: local.cloud_id }] }
      : await db!.collection('bills').where({ localId, userId }).get()
    if (existing.data?.length) await db!.collection('bills').doc(existing.data[0]._id).remove()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`删除云端账单失败 (localId=${localId}):`, msg)
    throw new Error(`cloud_delete_bill_failed: ${msg}`)
  }
}

export async function upsertRemoteCategory(cat: CategoryRow): Promise<void> {
  try {
    const { userId } = ensureDbAndUser()
    const remote = {
      localId: cat.id, userId,
      name: cat.name, icon: cat.icon, children: cat.children,
      type: cat.type, is_preset: cat.is_preset, sort_order: cat.sort_order,
      created_at: cat.created_at,
      updated_at: cat.updated_at || new Date().toISOString()
    }
    const existing = cat.cloud_id
      ? { data: [{ _id: cat.cloud_id }] }
      : await db!.collection('categories').where({ localId: cat.id, userId }).get()
    if (existing.data?.length) {
      await db!.collection('categories').doc(existing.data[0]._id).update(remote)
      setCategoryCloudId(cat.id, existing.data[0]._id)
    } else {
      const added = await db!.collection('categories').add(remote)
      const cloudId = (added as { id?: string }).id
      if (cloudId) setCategoryCloudId(cat.id, cloudId)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`同步分类失败 (localId=${cat.id}):`, msg)
    throw new Error(`cloud_sync_category_failed: ${msg}`)
  }
}

export async function deleteRemoteCategory(localId: number): Promise<void> {
  try {
    const { userId } = ensureDbAndUser()
    const local = getCategories().find(category => category.id === localId)
    const existing = local?.cloud_id
      ? { data: [{ _id: local.cloud_id }] }
      : await db!.collection('categories').where({ localId, userId }).get()
    if (existing.data?.length) await db!.collection('categories').doc(existing.data[0]._id).remove()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`删除云端分类失败 (localId=${localId}):`, msg)
    throw new Error(`cloud_delete_category_failed: ${msg}`)
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

/**
 * 从云端拉取当前用户的账单数据。
 * 返回原始云端记录数组，由调用方决定如何写入本地数据库。
 * 注意：若无 CLOUDBASE_API_KEY，云查询可能失败（取决于集合权限）。
 */
export async function pullBillsFromCloud(): Promise<CloudBill[]> {
  if (!db) return []
  const userId = getUserId()
  if (!userId) return []

  try {
    const data: CloudBill[] = []
    const pageSize = 1000
    let offset = 0
    while (true) {
      const result = await db.collection('bills').where({ userId }).skip(offset).limit(pageSize).get()
      const page = (result.data || []) as CloudBill[]
      data.push(...page)
      if (page.length < pageSize) break
      offset += page.length
    }
    if (data.length === 0) {
      console.warn('[Sync] 云端无账单数据。请检查 .env 中 CLOUDBASE_API_KEY 是否已配置')
    }
    return data
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`从云端拉取账单失败 (可能原因: .env 缺少 CLOUDBASE_API_KEY):`, msg)
    return []
  }
}

/**
 * 从云端拉取当前用户的分类数据。
 */
export async function pullCategoriesFromCloud(): Promise<CloudCategory[]> {
  if (!db) return []
  const userId = getUserId()
  if (!userId) return []

  try {
    const data: CloudCategory[] = []
    const pageSize = 100
    let offset = 0
    while (true) {
      const result = await db.collection('categories').where({ userId }).skip(offset).limit(pageSize).get()
      const page = (result.data || []) as CloudCategory[]
      data.push(...page)
      if (page.length < pageSize) break
      offset += page.length
    }
    return data
  } catch (e) {
    console.error('从云端拉取分类失败:', e)
    return []
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
    console.warn('读取 CloudBase Auth 绑定信息失败，将使用本地映射:', e)
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
            console.warn('Auth 绑定状态已读取，但 accounts 映射回写失败:', e)
          }
        }
        return {
          ...resolved
        }
      }
    } catch (e) {
      console.error('获取账号绑定信息失败:', e)
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
export async function sendBindVerificationCode(target: string): Promise<{ verificationId: string; type: 'email' | 'phone' }> {
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

  // 云端服务未配置（缺 CLOUDBASE_API_KEY 或 .env 不存在）
  if (!currentSession?.accessToken) {
    throw new Error('reauth_not_logged_in')
  }

  // 需要 access_token 才能发送到当前登录用户的目标
  const accessToken = currentSession.accessToken
  const { ok, data } = await authFetch('/auth/v1/verification', body, accessToken)
  if (!ok) {
    const e = data as { error_description?: string; error?: string }
    throw new Error(e.error_description || e.error || 'verification_code_send_failed')
  }

  const d = authPayload(data) as { verification_id?: string }
  return { verificationId: d.verification_id || '', type: isPhone ? 'phone' : 'email' }
}

/**
 * 绑定邮箱（验证码确认）。
 * 发送验证码到新邮箱 → 用户输入验证码 → 调用此函数验证并绑定。
 */
export async function bindEmail(newEmail: string, code: string, verificationId: string): Promise<void> {
  const userId = getUserId()
  if (!userId) throw new Error('未登录')

  // 验证验证码
  const verificationToken = await verifyCode(verificationId, code)

  // Auth 是绑定的权威来源，不能因本地 accounts 映射不可用而跳过真实绑定。
  await updateAuthBasicInfo({ email: newEmail }, verificationToken)
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
    console.warn(`binding_mapping_pending: CloudBase Auth 已完成，但账号映射同步失败（${message}）。`, e)
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
 * 同步更新 CloudBase Auth 的真实身份绑定。
 * accounts 只是应用侧映射表，不能替代 Auth 的 email/phone 字段。
 */
async function updateAuthBasicInfo(binding: { email?: string; phone?: string }, verificationToken: string): Promise<void> {
  if (!currentSession?.accessToken) throw new Error('reauth_not_logged_in')
  // verificationToken 已由 verifyCode 校验；basic/edit 官方契约只接收
  // email/phone 等基础字段，不把 verification_token 当作编辑字段发送。
  void verificationToken
  const { ok, data, status } = await authFetch('/auth/v1/user/basic/edit', {
    ...binding
  }, currentSession.accessToken)
  if (!ok) {
    const e = data as { error_description?: string; error?: string }
    throw new Error(e.error_description || e.error || `auth_binding_update_failed_${status}`)
  }
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
  if (!res.ok || (data.code !== 0 && data.code !== 202)) {
    throw new Error(`auth_delete_failed: ${data.message || `HTTP ${res.status}`}`)
  }

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
  clearSession()

  if (localCleanupError) throw new Error(`local_cleanup_failed: ${localCleanupError}`)
  return { cleanupPending: data.cleanup_pending === true }
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
    console.error('获取用户统计失败:', e)
    return { billCount: 0, categoryCount: 0, totalExpense: 0, totalIncome: 0 }
  }
}
