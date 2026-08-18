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

export interface LoginPreferences {
  identifier: string
  rememberAccount: boolean
  autoLogin: boolean
}

const EMPTY_PREFERENCES: LoginPreferences = { identifier: '', rememberAccount: false, autoLogin: false }

/** 保存登录偏好；密码与访问令牌都不写入此文件。 */
export async function saveCredentials(identifier: string, rememberAccount: boolean, autoLogin: boolean): Promise<void> {
  // 登录密码绝不落盘；自动登录依赖 CloudBase 刷新令牌，而非重复保存密码。
  const data: LoginPreferences = {
    identifier: rememberAccount ? identifier : '',
    rememberAccount,
    autoLogin: rememberAccount && autoLogin
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
 * 兼容读取历史格式时只保留账号标识，不恢复或迁移密码。
 */
export async function loadCredentials(): Promise<LoginPreferences> {
  // 优先读加密文件
  if (fs.existsSync(CREDENTIALS_PATH)) {
    try {
      const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf-8')
      const data = JSON.parse(raw) as Partial<LoginPreferences> & { encryptedPassword?: string }
      // 旧格式含密码密文：不再读取密码，立即迁移为仅含偏好的安全格式。
      if (data.encryptedPassword) {
        const migrated = { ...EMPTY_PREFERENCES, identifier: data.identifier || (data as { email?: string }).email || '', rememberAccount: !!((data as { email?: string }).email), autoLogin: false }
        await saveCredentials(migrated.identifier, migrated.rememberAccount, false)
        return migrated
      }
      return {
        identifier: data.rememberAccount ? (data.identifier || '') : '',
        rememberAccount: !!data.rememberAccount,
        autoLogin: !!data.rememberAccount && !!data.autoLogin
      }
    } catch (e) {
      console.error('读取加密凭据失败：', e)
      // 降级尝试读旧明文
      return EMPTY_PREFERENCES
    }
  }

  // 兼容旧明文文件：读取后立即加密迁移
  // 旧明文凭据一律删除，不能迁移密码。
  try { if (fs.existsSync(OLD_PLAINTEXT_PATH)) fs.unlinkSync(OLD_PLAINTEXT_PATH) } catch { /* ignore */ }
  return EMPTY_PREFERENCES
}

/**
 * 从旧明文文件读取凭据并自动迁移到加密存储。
 * 迁移成功后删除旧明文文件。
 */

/** 删除所有保存的凭据（加密文件 + 残存的旧明文） */
export function clearCredentials(): void {
  try { if (fs.existsSync(CREDENTIALS_PATH)) fs.unlinkSync(CREDENTIALS_PATH) } catch { /* ignore */ }
  try { if (fs.existsSync(OLD_PLAINTEXT_PATH)) fs.unlinkSync(OLD_PLAINTEXT_PATH) } catch { /* ignore */ }
}
