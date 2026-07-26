import cloudbase from '@cloudbase/node-sdk'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { BillRow, CategoryRow } from './database'

// ─── Constants ────────────────────────────────────

const ENV_ID = 'shio-d0gsoo414401468d6'
const AUTH_BASE = `https://${ENV_ID}.api.tcloudbasegateway.com`
// API Key 用于 Node SDK 数据库操作（管理员权限）。
// 可通过 CloudBase 控制台 → 身份认证 → API Key 轮换。
// 注意：此 Key 会随 EXE 分发，仅用于个人应用场景。
const API_KEY = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjlkMWRjMzFlLWI0ZDAtNDQ4Yi1hNzZmLWIwY2M2M2Q4MTQ5OCJ9.eyJhdWQiOiJzaGlvLWQwZ3NvbzQxNDQwMTQ2OGQ2IiwiZXhwIjoyNTM0MDIzMDA3OTksImlhdCI6MTc4NTA3NjYyMCwiYXRfaGFzaCI6IjBLaU1tTFlqU1FHdHB5UlNJZmtYYkEiLCJwcm9qZWN0X2lkIjoic2hpby1kMGdzb280MTQwMDE0NjhkNiIsIm1ldGEiOnsicGxhdGZvcm0iOiJBcGlLZXkifSwiYWRtaW5pc3RyYXRvcl9pZCI6IjIwODEzNzc2MTgxNzI3NDc3NzgiLCJ1c2VyX3R5cGUiOiIiLCJjbGllbnRfdHlwZSI6ImNsaWVudF9zZXJ2ZXIiLCJpc19zeXN0ZW1fYWRtaW4iOnRydWV9.MQW6L0XICiX3ptPGR4qiBWZHmjD4cJ6j9BAhN1qC4JsaifLdsGfUyjucC_Xo3Ic6aJFcMJ_j5w_F0Shnw_HpxPCCPYZK8_6RM_Rto8o8ji2fKqpDoAm_JyrSQSfYbVSIpayBAWqnHMRoCqoKkEV1apx18nkuRwd7C_McNfCtzisnYPfb87Bqd_jRJA4Fjf5ZFvl8IRkj_2D0dVFbzXBUovmTDlBt6bH24HCF9gVv2lH_bCxOs_pZF-V6un8-13PJipkTtbLH84cWRHYBo0YzPZDGYxdvERTzhotve07ERUpoEbP60wZA_gjeXci1mZaIlFBtf1ZeSXDec8adQ28-Jw'

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
  try {
    db = cloudbase.init({ env: ENV_ID, accessKey: API_KEY }).database()
  } catch (e) {
    console.error('CloudBase SDK 初始化失败，云同步功能不可用:', e)
  }
  const saved = loadSession()
  if (saved) currentSession = saved
}

// ─── Remember Credentials ─────────────────────────

interface RememberedCredentials { email: string; password: string }

function rememberPath(): string { return path.join(app.getPath('userData'), 'remembered-auth.json') }

export function saveCredentials(email: string, password: string): void {
  try {
    if (email && password) {
      fs.writeFileSync(rememberPath(), JSON.stringify({ email, password } as RememberedCredentials), 'utf-8')
    } else {
      try { fs.unlinkSync(rememberPath()) } catch { /* */ }
    }
  } catch { /* ignore */ }
}

export function loadCredentials(): { email: string; password: string } {
  try {
    const raw = fs.readFileSync(rememberPath(), 'utf-8')
    const c: RememberedCredentials = JSON.parse(raw)
    return { email: c.email || '', password: c.password || '' }
  } catch { return { email: '', password: '' } }
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

/** 发送重认证验证码 */
export async function sendReauthCode(): Promise<void> {
  if (!currentSession) throw new Error('reauth_not_logged_in')
  const { ok, data } = await authFetch('/auth/v1/user/reauthenticate', {}, currentSession.accessToken)
  if (!ok) {
    const e = data as { error_description?: string; error?: string }
    throw new Error(e.error_description || e.error || 'reauth_failed')
  }
}

/** 修改密码 */
export async function changePassword(
  oldPassword: string, newPassword: string, verifyCode: string
): Promise<void> {
  if (!currentSession) throw new Error('reauth_not_logged_in')
  const { ok, data } = await authFetch('/auth/v1/user/password', {
    old_password: oldPassword, new_password: newPassword, verify_code: verifyCode
  }, currentSession.accessToken, 'PATCH')
  if (!ok) {
    const e = data as { error_description?: string; error?: string }
    throw new Error(e.error_description || e.error || 'password_change_failed')
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
  } catch (e) { console.error('同步账单失败:', e) }
}

export async function deleteRemoteBill(localId: number): Promise<void> {
  try {
    const { userId } = ensureDbAndUser()
    const existing = await db!.collection('bills').where({ localId, userId }).get()
    if (existing.data?.length) await db!.collection('bills').doc(existing.data[0]._id).remove()
  } catch (e) { console.error('删除云端账单失败:', e) }
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
  } catch (e) { console.error('同步分类失败:', e) }
}

export async function deleteRemoteCategory(localId: number): Promise<void> {
  try {
    const { userId } = ensureDbAndUser()
    const existing = await db!.collection('categories').where({ localId, userId }).get()
    if (existing.data?.length) await db!.collection('categories').doc(existing.data[0]._id).remove()
  } catch (e) { console.error('删除云端分类失败:', e) }
}
