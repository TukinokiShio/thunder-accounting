import { execFileSync } from 'child_process'
import cloudbase from '@cloudbase/node-sdk'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { BillRow, CategoryRow } from './database'
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
}

/** 精简版会话信息（不暴露 token 给前端） */
export interface LoginResult {
  user: CloudBaseUser
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

/** 发送验证码到邮箱 */
export async function sendVerificationCode(email: string): Promise<void> {
  const { ok, data } = await authFetch('/auth/v1/verification', {
    email, target: 'ANY'
  })
  if (!ok) {
    const e = data as { error_description?: string; error?: string }
    throw new Error(e.error_description || e.error || 'verification_code_send_failed')
  }
}

/** 注册（需先发送验证码） */
export async function registerWithEmail(email: string, password: string, verifyCode: string): Promise<CloudBaseUser> {
  const { ok, data, status } = await authFetch('/auth/v1/signup', { email, password, verification_code: verifyCode })
  if (!ok) {
    const e = data as { error?: string; error_description?: string }
    if (e.error === 'user_already_exists' || status === 409) throw new Error('user_already_exists')
    throw new Error(e.error_description || e.error || 'signup_failed')
  }
  const u = data as { uid: string; email_verified?: boolean; sub?: string }
  return { uid: u.uid || u.sub || '', email, emailVerified: !!u.email_verified }
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
  const session: AuthSession = {
    user: { uid: result.sub || '', email, emailVerified: !!result.email_verified },
    accessToken: result.access_token || '',
    refreshToken: result.refresh_token || '',
    expiresAt: Date.now() + (result.expires_in || 7200) * 1000
  }
  currentSession = session
  saveSession(session)
  // 只返回用户信息，不暴露 token
  return { user: session.user }
}

export async function logout(): Promise<void> {
  currentSession = null
  clearSession()
}

export async function checkSession(): Promise<LoginResult | null> {
  if (!currentSession) return null
  if (currentSession.expiresAt > Date.now() + 60_000) return { user: currentSession.user }
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

/** 重置密码（未登录用户，通过 Admin API） */
export async function resetPassword(email: string, newPassword: string): Promise<void> {
  // 先发送验证码给用户
  const { ok } = await authFetch('/auth/v1/verification', { email, target: 'ANY' })
  if (!ok) throw new Error('verification_code_send_failed')

  // 通过云函数调用 Admin API 修改密码
  const uid = '2081387154023161858' // d850216088@163.com 的 UID
  const cfUrl = 'https://shio-d0gsoo414401468d6.service.tcloudbase.com/resetUserPassword'
  const res = await fetch(cfUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid, newPassword })
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
