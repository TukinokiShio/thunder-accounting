import { execFileSync } from 'child_process'
import cloudbase from '@cloudbase/node-sdk'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { BillRow, CategoryRow } from './database'
import { clearAllData, getDbPath, getBills, getCategories } from './database'
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
      const val = trimmed.slice(eqIdx + 1).trim()
      if (!process.env[key]) process.env[key] = val
    }
  } catch (e) {
    console.error('Failed to load .env file:', e)
  }
}

// ─── Constants ────────────────────────────────────

const ENV_ID = 'shio-d0gsoo414401468d6'
const AUTH_BASE = `https://${ENV_ID}.api.tcloudbasegateway.com`

/**
 * Admin API Key — 从环境变量 CLOUDBASE_API_KEY 加载。
 * 在 initCloudBase() 中通过 loadEnvFile() 注入 process.env 后读取。
 * 生产环境无 .env 文件时 API_KEY 为空字符串，Admin 功能（密码重置等）将不可用。
 * 通过动态属性名访问 process.env，避免 electron-vite 构建时静态替换。
 */
function getApiKey(): string {
  return (process.env as Record<string, string>)['CLOUDBASE_API_KEY'] || ''
}

// ─── Types ────────────────────────────────────────

export interface CloudBaseUser {
  uid: string
  email: string
  emailVerified: boolean
  accountId?: string
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

let db: ReturnType<typeof cloudbase.init>['database'] | null = null
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
  loadEnvFile(envPath1)
  loadEnvFile(envPath2)

  const apiKey = getApiKey()
  if (!apiKey) {
    console.warn('⚠ CLOUDBASE_API_KEY not set. Admin features (password reset, etc.) will be unavailable.')
  }
  try {
    db = cloudbase.init({ env: ENV_ID, accessKey: apiKey }).database()
  } catch (e) {
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
  method: string = 'POST'
): Promise<{ ok: boolean; data: Record<string, unknown>; status: number }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${AUTH_BASE}${endpoint}`, { method, headers, body: JSON.stringify(body) })
  let data: Record<string, unknown>
  try { data = await res.json() as Record<string, unknown> } catch { data = { error: `HTTP ${res.status}` } }
  return { ok: res.ok, data, status: res.status }
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
 * 根据输入标识符解析出用于 CloudBase 登录的邮箱。
 * 支持：账号 ID → 查 accounts 集合；邮箱 → 直接返回；手机号 → 查 accounts 集合。
 */
export async function resolveLoginIdentifier(identifier: string): Promise<string> {
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
async function createAccountRecord(email: string, uid: string, accountId: string): Promise<void> {
  if (!db) return
  try {
    await db.collection('accounts').add({
      accountId,
      uid,
      email,
      phone: '',
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
export async function sendVerificationCode(target: string): Promise<SendCodeResult> {
  const isPhone = /^\d{11}$/.test(target)
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)
  const body: Record<string, string> = {}
  let resolvedType: 'phone' | 'email' | null = null
  let resolvedTarget: string | null = null

  if (isPhone) {
    body.phone_number = '+86 ' + target
    body.target = 'ANY'
    resolvedType = 'phone'
    resolvedTarget = target
  } else if (isEmail) {
    body.email = target
    body.target = 'ANY'
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
      body.target = 'ANY'
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

  const d = data as { verification_id?: string; is_user?: boolean }
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
    verification_token: verificationToken,
    verification_code: code
  }
  const { ok, data, status } = await authFetch('/auth/v1/signup', body)
  if (!ok) {
    const e = data as { error?: string; error_description?: string }
    if (e.error === 'user_already_exists' || status === 409) throw new Error('user_already_exists')
    throw new Error(e.error_description || e.error || 'signup_failed')
  }
  const u = data as { uid: string; email_verified?: boolean; sub?: string }
  const uid = u.uid || u.sub || ''

  const accountId = generateStandardAccountId(email)
  await createAccountRecord(email, uid, accountId)

  return {
    user: { uid, email, emailVerified: !!u.email_verified, accountId },
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
    verification_token: verificationToken,
    verification_code: code
  }
  const { ok, data, status } = await authFetch('/auth/v1/signup', body)
  if (ok) {
    const u = data as { uid: string; email_verified?: boolean; sub?: string }
    const uid = u.uid || u.sub || ''
    const internalEmail = `${phone}@phone.tb`
    const accountId = generateStandardAccountId(internalEmail)
    await createAccountRecord(internalEmail, uid, accountId)
    try {
      await db?.collection('accounts').where({ uid }).update({ phone })
    } catch { /* ignore */ }
    return {
      user: { uid, email: internalEmail, emailVerified: false, accountId },
      accountId
    }
  }

  // 兜底：内部邮箱注册
  const internalEmail = `${phone}@phone.tb`
  const { ok: ok2, data: data2, status: status2 } = await authFetch('/auth/v1/signup', {
    email: internalEmail, password,
    verification_token: verificationToken,
    verification_code: code
  })
  if (!ok2) {
    const e = data2 as { error?: string; error_description?: string }
    if (e.error === 'user_already_exists' || status2 === 409) throw new Error('user_already_exists')
    throw new Error(e.error_description || e.error || 'signup_failed')
  }
  const u = data2 as { uid: string; email_verified?: boolean; sub?: string }
  const uid = u.uid || u.sub || ''
  const accountId = generateStandardAccountId(internalEmail)
  await createAccountRecord(internalEmail, uid, accountId)
  try { await db?.collection('accounts').where({ uid }).update({ phone }) } catch { /* ignore */ }
  return {
    user: { uid, email: internalEmail, emailVerified: false, accountId },
    accountId
  }
}

/** 登录 */
export async function loginWithEmail(email: string, password: string): Promise<LoginResult> {
  const { ok, data } = await authFetch('/auth/v1/signin', { username: email, password })
  if (!ok) {
    const e = data as { error?: string; error_description?: string }
    if (e.error === 'invalid_username_or_password') throw new Error('invalid_username_or_password')
    if (e.error === 'email_not_verified') throw new Error('email_not_verified')
    throw new Error(e.error_description || e.error || 'signin_failed')
  }
  const result = data as { sub?: string; access_token?: string; refresh_token?: string; expires_in?: number; email_verified?: boolean }
  const uid = result.sub || ''

  // 从 accounts 集合获取 accountId
  let accountId: string | undefined
  try {
    if (db) {
      const accResult = await db.collection('accounts').where({ uid }).limit(1).get()
      if (accResult.data?.length) {
        const acc = accResult.data[0] as { accountId?: string; email?: string }
        accountId = acc.accountId
        // 如果旧用户没有 accountId，按规范化算法补全并持久化
        if (!accountId) {
          const refEmail = acc.email || email
          accountId = generateStandardAccountId(refEmail)
          await db.collection('accounts').doc((accResult.data[0] as { _id: string })._id).update({ accountId })
        }
      } else {
        // accounts 集合无记录（极端情况）— 用规范化算法给 session 用
        accountId = generateStandardAccountId(email)
      }
    } else {
      // db 不可用（无 CLOUDBASE_API_KEY）— 用规范化算法生成 session-only ID
      accountId = generateStandardAccountId(email)
    }
  } catch (e) {
    console.error('获取 accountId 失败（用规范化算法兜底）:', e)
    accountId = generateStandardAccountId(email)
  }

  const session: AuthSession = {
    user: { uid, email, emailVerified: !!result.email_verified, accountId },
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
export async function verifyCode(verificationId: string, code: string): Promise<string> {
  if (!verificationId) throw new Error('verification_id_required')

  // CloudBase REST API：/auth/v1/verification/verify（带 verification/ 前缀）
  const { ok, data, status } = await authFetch('/auth/v1/verification/verify', {
    verification_id: verificationId,
    verification_code: code
  })
  if (!ok) {
    const e = data as { error?: string; error_description?: string }
    const errorCode = e.error || `http_${status}` || 'verification_code_invalid'
    if (errorCode.includes('expired')) throw new Error('verification_code_expired')
    if (errorCode.includes('invalid') || errorCode.includes('incorrect')) throw new Error('verification_code_invalid')
    throw new Error(e.error_description || errorCode)
  }
  const result = data as { verification_token?: string; ticket?: string }
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
  const result = data as { sub?: string; access_token?: string; refresh_token?: string; expires_in?: number; email_verified?: boolean }
  const uid = result.sub || ''

  // 从 accounts 集合获取 accountId
  let accountId: string | undefined
  try {
    if (db) {
      const accResult = await db.collection('accounts').where({ uid }).limit(1).get()
      if (accResult.data?.length) {
        const acc = accResult.data[0] as { accountId?: string; email?: string }
        accountId = acc.accountId
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

  const session: AuthSession = {
    user: { uid, email: target.target, emailVerified: !!result.email_verified, accountId },
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
    const t = data as { access_token: string; refresh_token: string; expires_in: number }
    currentSession.accessToken = t.access_token
    currentSession.refreshToken = t.refresh_token
    currentSession.expiresAt = Date.now() + (t.expires_in || 7200) * 1000
    saveSession(currentSession)
    return { user: currentSession.user }
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

/** 发送重认证验证码（需提供当前密码） */
export async function sendReauthCode(currentPassword: string): Promise<void> {
  if (!currentSession) throw new Error('reauth_not_logged_in')
  const { ok, data } = await authFetch('/auth/v1/user/reauthenticate', {
    password: currentPassword,
    verify_opt: 'email_code'
  }, currentSession.accessToken)
  if (!ok) {
    const e = data as { error_description?: string; error?: string }
    throw new Error(e.error_description || e.error || 'reauth_failed')
  }
}

/** 修改密码（已登录用户，通过 Admin API） */
export async function changePassword(newPassword: string): Promise<void> {
  if (!currentSession) throw new Error('reauth_not_logged_in')
  try {
    const uid = currentSession.user.uid
    execFileSync(process.execPath, [
      path.join(__dirname, '..', 'scripts', 'admin-api.cjs'),
      uid, newPassword
    ], { encoding: 'utf-8', timeout: 30000 })
  } catch (e: any) {
    const msg = e.stderr || e.message || ''
    throw new Error(msg.trim() || 'password_change_failed')
  }
}

/** 重置密码（未登录用户，通过加固后的云函数完成邮箱/手机→UID 查找与密码修改） */
export async function resetPassword(identifier: string, newPassword: string, verificationCode: string, verificationId: string): Promise<void> {
  const cfUrl = `https://${ENV_ID}.service.tcloudbase.com/resetUserPassword`

  // Step 1: 解析手机号/邮箱
  const isPhone = /^\d{11}$/.test(identifier)
  const lookupId = isPhone ? identifier : identifier

  // Step 2: 验证 code 换 verification_token（本地做，更快）
  let verificationToken: string
  if (verificationId) {
    verificationToken = await verifyCode(verificationId, verificationCode)
  } else {
    // 兼容旧调用：直接用 code 当作 token（降级路径，可能失败）
    verificationToken = verificationCode
  }

  // Step 3: 调用云函数，传 verification_token（云函数 v3 已支持 phone）
  const body: Record<string, string> = isPhone
    ? { phone: lookupId, newPassword, verification_token: verificationToken }
    : { email: lookupId, newPassword, verification_token: verificationToken }

  const res = await fetch(cfUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  const data = await res.json() as { code?: number; message?: string }
  if (data.code !== 0) {
    throw new Error(data.message || 'password_change_failed')
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
    const existing = await db!.collection('bills').where({ localId: bill.id, userId }).get()
    if (existing.data?.length) {
      await db!.collection('bills').doc(existing.data[0]._id).update(remote)
    } else {
      await db!.collection('bills').add(remote)
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
    const existing = await db!.collection('bills').where({ localId, userId }).get()
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
    const existing = await db!.collection('categories').where({ localId: cat.id, userId }).get()
    if (existing.data?.length) {
      await db!.collection('categories').doc(existing.data[0]._id).update(remote)
    } else {
      await db!.collection('categories').add(remote)
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
    const existing = await db!.collection('categories').where({ localId, userId }).get()
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
    const result = await db.collection('bills').where({ userId }).limit(1000).get()
    const data = (result.data || []) as CloudBill[]
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
    const result = await db.collection('categories').where({ userId }).limit(100).get()
    return (result.data || []) as CloudCategory[]
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

/**
 * 获取当前用户的账号绑定信息。
 * 多层 fallback：accounts 集合 → 当前 session → null。
 */
export async function getAccountBindings(): Promise<AccountInfo | null> {
  const userId = getUserId()
  if (!userId) return null

  // 1. 从 accounts 集合查（最权威）
  if (db) {
    try {
      const result = await db.collection('accounts').where({ uid: userId }).limit(1).get()
      if (result.data?.length) {
        const a = result.data[0] as AccountInfo & { uid: string; createdAt?: string }
        return {
          accountId: a.accountId,
          email: a.email,
          phone: a.phone,
          nickname: (a as { nickname?: string }).nickname
        }
      }
    } catch (e) {
      console.error('获取账号绑定信息失败:', e)
      // 继续 fallback
    }
  }

  // 2. Fallback：从当前 session 构造（db 不可用时）
  if (currentSession) {
    return {
      accountId: currentSession.user.accountId,
      email: currentSession.user.email,
      phone: ''  // session 中没有 phone 字段
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

  const { ok, data } = await authFetch('/auth/v1/verification', body)
  if (!ok) {
    const e = data as { error_description?: string; error?: string }
    throw new Error(e.error_description || e.error || 'verification_code_send_failed')
  }

  const d = data as { verification_id?: string }
  return { verificationId: d.verification_id || '', type: isPhone ? 'phone' : 'email' }
}

/**
 * 绑定邮箱（验证码确认）。
 * 发送验证码到新邮箱 → 用户输入验证码 → 调用此函数验证并绑定。
 */
export async function bindEmail(newEmail: string, code: string, verificationId: string): Promise<void> {
  if (!db) throw new Error('未连接数据库')
  const userId = getUserId()
  if (!userId) throw new Error('未登录')

  // 验证验证码
  await verifyCode(verificationId, code)

  // 检查邮箱是否已被其他账号绑定
  const existing = await db.collection('accounts').where({ email: newEmail }).get()
  if (existing.data?.length) {
    const acc = existing.data[0] as { uid: string }
    if (acc.uid !== userId) throw new Error('email_already_bound')
  }

  // 更新当前用户的邮箱
  const result = await db.collection('accounts').where({ uid: userId }).get()
  if (!result.data?.length) throw new Error('account_not_found')

  await db.collection('accounts').doc(result.data[0]._id).update({ email: newEmail })
}

/**
 * 解绑邮箱（验证码确认）。
 * 发送验证码到当前邮箱 → 用户输入验证码 → 调用此函数验证并解绑。
 * 至少保留手机号绑定，否则拒绝解绑。
 */
export async function unbindEmail(code: string, verificationId: string): Promise<void> {
  if (!db) throw new Error('未连接数据库')
  const userId = getUserId()
  if (!userId) throw new Error('未登录')

  // 获取当前账号信息
  const result = await db.collection('accounts').where({ uid: userId }).get()
  if (!result.data?.length) throw new Error('account_not_found')

  const account = result.data[0] as AccountInfo

  // 验证验证码（发送到当前邮箱）
  await verifyCode(verificationId, code)

  // 至少保留手机号绑定
  if (!account.phone) throw new Error('cannot_remove_last_binding')

  await db.collection('accounts').doc(result.data[0]._id).update({ email: '' })
}

/**
 * 绑定手机号到当前用户账号（验证码确认）。
 */
export async function bindPhone(phone: string, code: string, verificationId: string): Promise<void> {
  if (!db) throw new Error('未连接数据库')
  const userId = getUserId()
  if (!userId) throw new Error('未登录')

  // 验证验证码
  await verifyCode(verificationId, code)

  // 检查手机号是否已被其他账号绑定
  const existing = await db.collection('accounts').where({ phone }).get()
  if (existing.data?.length) {
    const acc = existing.data[0] as { uid: string }
    if (acc.uid !== userId) throw new Error('phone_already_bound')
  }

  // 更新当前用户的手机号
  const result = await db.collection('accounts').where({ uid: userId }).get()
  if (!result.data?.length) throw new Error('account_not_found')

  await db.collection('accounts').doc(result.data[0]._id).update({ phone })
}

/**
 * 解绑当前用户的手机号（验证码确认）。
 * 至少保留邮箱绑定，否则拒绝解绑。
 */
export async function unbindPhone(code: string, verificationId: string): Promise<void> {
  if (!db) throw new Error('未连接数据库')
  const userId = getUserId()
  if (!userId) throw new Error('未登录')

  const result = await db.collection('accounts').where({ uid: userId }).get()
  if (!result.data?.length) throw new Error('account_not_found')

  const account = result.data[0] as AccountInfo

  // 验证验证码（发送到当前手机号）
  await verifyCode(verificationId, code)

  // 至少保留邮箱绑定
  if (!account.email) throw new Error('cannot_remove_last_binding')

  await db.collection('accounts').doc(result.data[0]._id).update({ phone: '' })
}

// ─── Account Deletion ──────────────────────────────

/**
 * 注销账号（验证码确认后删除所有数据）。
 * 流程：
 * 1. 验证验证码
 * 2. 删除 CloudBase 集合中的用户数据（accounts, bills, categories）
 * 3. 清理本地数据库文件
 * 4. 尝试删除 CloudBase Auth 用户（通过云函数或直接 API）
 */
export async function deleteAccount(code: string, verificationId: string): Promise<void> {
  if (!db) throw new Error('未连接数据库')
  const userId = getUserId()
  if (!userId) throw new Error('未登录')

  // Step 1: 验证验证码
  await verifyCode(verificationId, code)

  // Step 2: 删除云端数据
  const collections = ['bills', 'categories', 'accounts']
  const errors: string[] = []
  for (const col of collections) {
    try {
      const { data: items } = await db!.collection(col).where({ userId }).get()
      if (items?.length) {
        for (const item of items as Array<{ _id: string }>) {
          await db!.collection(col).doc(item._id).remove()
        }
      }
      // accounts 集合用 uid 查询
      if (col === 'accounts') {
        const { data: accItems } = await db!.collection(col).where({ uid: userId }).get()
        if (accItems?.length) {
          for (const item of accItems as Array<{ _id: string }>) {
            await db!.collection(col).doc(item._id).remove()
          }
        }
      }
    } catch (e) {
      errors.push(`${col}: ${(e as Error).message}`)
    }
  }

  // Step 3: 清理本地数据库
  try {
    clearAllData()
    const dbPath = getDbPath()
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath)
    }
  } catch (e) {
    errors.push(`local_db: ${(e as Error).message}`)
  }

  // Step 4: 尝试删除 CloudBase Auth 用户（best-effort）
  try {
    // 通过云函数删除用户（需要部署 delUser 云函数）
    const cfUrl = `https://${ENV_ID}.service.tcloudbase.com/delUser`
    const res = await fetch(cfUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: userId })
    })
    const resData = await res.json() as { code?: number }
    if (resData.code !== 0) {
      console.warn('云函数删除用户返回非零码:', resData)
    }
  } catch (e) {
    // 云函数可能不存在，静默处理
    console.warn('删除 Auth 用户失败（云函数可能未部署）:', (e as Error).message)
  }

  // 清除 session
  currentSession = null
  clearSession()

  if (errors.length > 0) {
    throw new Error(`部分数据清理失败: ${errors.join('; ')}`)
  }
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
