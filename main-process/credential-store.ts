/**
 * 凭据安全存储模块（credential-store.ts）。
 * 使用 Electron safeStorage API 加密存储用户邮箱和密码，
 * 替代旧的明文 JSON 文件（remembered-auth.json）。
 *
 * 约束：
 * - 必须在 app.whenReady() 之后调用（safeStorage.isEncryptionAvailable() 才返回 true）
 * - 仅主进程可用（渲染进程无法直接调用 safeStorage）
 * - 跨机器不可移植（加密数据与当前机器/用户绑定）
 * - Linux 环境可能回退到 basic_text（不加密），需警告
 */

import { app, safeStorage } from 'electron'
import fs from 'fs'
import path from 'path'

const CREDENTIALS_PATH = path.join(app.getPath('userData'), 'remembered-auth.enc')
const OLD_PLAINTEXT_PATH = path.join(app.getPath('userData'), 'remembered-auth.json')

interface EncryptedPayload {
  email: string
  encryptedPassword: string // base64 编码的加密 Buffer
}

/**
 * 安全保存凭据。密码通过 safeStorage 加密���写入磁盘。
 * 如果 safeStorage 不可用（Linux basic_text 后端等），直接拒绝写入并警告用户。
 */
export async function saveCredentials(email: string, password: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('⚠ safeStorage 不可用，凭据不会被保存到磁盘。')
    return
  }

  const encrypted = await safeStorage.encryptStringAsync(password)

  const data: EncryptedPayload = {
    email,
    encryptedPassword: encrypted.toString('base64')
  }

  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(data), 'utf-8')

  // 清理旧的明文文件
  try {
    if (fs.existsSync(OLD_PLAINTEXT_PATH)) {
      fs.unlinkSync(OLD_PLAINTEXT_PATH)
    }
  } catch { /* ignore */ }
}

/**
 * 安全加载凭据。解密密码并返回邮箱+密码。
 * 如果密钥已轮换（shouldReEncrypt），自动用新密钥重新加密保存。
 * 找不到加密文件时尝试兼容读取旧明文文件，读取后自动迁移并删除旧文件。
 */
export async function loadCredentials(): Promise<{ email: string; password: string } | null> {
  // 优先读加密文件
  if (fs.existsSync(CREDENTIALS_PATH)) {
    try {
      const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf-8')
      const data: EncryptedPayload = JSON.parse(raw)
      const encrypted = Buffer.from(data.encryptedPassword, 'base64')

      if (!safeStorage.isEncryptionAvailable()) {
        return null
      }

      const { result: password, shouldReEncrypt } = await safeStorage.decryptStringAsync(encrypted)

      // 密钥轮换：用新密钥重新加密保存
      if (shouldReEncrypt) {
        const reEncrypted = await safeStorage.encryptStringAsync(password)
        const updated: EncryptedPayload = {
          email: data.email,
          encryptedPassword: reEncrypted.toString('base64')
        }
        fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(updated), 'utf-8')
      }

      return { email: data.email, password }
    } catch (e) {
      console.error('读取加密凭据失败：', e)
      // 降级尝试读旧明文
      return migrateFromPlaintext()
    }
  }

  // 兼容旧明文文件：读取后立即加密迁移
  return migrateFromPlaintext()
}

/**
 * 从旧明文文件读取凭据并自动迁移到加密存储。
 * 迁移成功后删除旧明文文件。
 */
async function migrateFromPlaintext(): Promise<{ email: string; password: string } | null> {
  try {
    if (!fs.existsSync(OLD_PLAINTEXT_PATH)) return null

    const raw = fs.readFileSync(OLD_PLAINTEXT_PATH, 'utf-8')
    const data = JSON.parse(raw) as { email?: string; password?: string }
    const email = data.email || ''
    const password = data.password || ''

    if (!email || !password) {
      fs.unlinkSync(OLD_PLAINTEXT_PATH)
      return null
    }

    // 自动迁移到加密存储
    if (safeStorage.isEncryptionAvailable()) {
      await saveCredentials(email, password)
    }

    // 删除旧明文文件（安全考虑）
    try { fs.unlinkSync(OLD_PLAINTEXT_PATH) } catch { /* ignore */ }

    return { email, password }
  } catch {
    return null
  }
}

/** 删除所有保存的凭据（加密文件 + 残存的旧明文） */
export function clearCredentials(): void {
  try { if (fs.existsSync(CREDENTIALS_PATH)) fs.unlinkSync(CREDENTIALS_PATH) } catch { /* ignore */ }
  try { if (fs.existsSync(OLD_PLAINTEXT_PATH)) fs.unlinkSync(OLD_PLAINTEXT_PATH) } catch { /* ignore */ }
}
