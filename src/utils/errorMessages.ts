/**
 * CloudBase / IPC 错误信息中英映射
 * 用于把后端抛出的英文错误翻译成对应语言
 */

export type Lang = 'zh' | 'en'

/** 关键字 → 中英翻译（按关键字匹配，错误信息含此关键字即翻译） */
const KEYWORD_MAP: Array<{ patterns: RegExp[]; zh: string; en: string }> = [
  {
    patterns: [/verification[_ ]token or verification[_ ]code required/i],
    zh: '需要先验证邮箱。请先在登录页点击"发送验证码"获取验证码后再注册。',
    en: 'Email verification required. Please send a verification code first, then enter it during registration.'
  },
  {
    patterns: [/you can not signup just by username and password/i, /不允许仅用用户名密码注册/],
    zh: '不允许仅用用户名密码注册，用户身份需经过验证。请使用邮箱注册并完成验证。',
    en: 'Cannot sign up with just username and password. Email verification required.'
  },
  {
    patterns: [/user_already_exists/i, /email already/i, /already registered/i],
    zh: '该邮箱已被注册',
    en: 'Email already registered'
  },
  {
    patterns: [/invalid_username_or_password/i, /email or password/i, /username or password incorrect/i],
    zh: '邮箱或密码错误',
    en: 'Invalid email or password'
  },
  {
    patterns: [/email_not_verified/i, /email has not been verified/i],
    zh: '邮箱尚未验证，请先查收验证邮件',
    en: 'Email not verified. Please check your inbox.'
  },
  {
    patterns: [/password_not_set/i, /用户密码未设置/],
    zh: '账户未设置密码，请先完成密码设置',
    en: 'Password not set. Please set up your password first.'
  },
  {
    patterns: [/invalid email/i, /invalid_argument/i, /missing secretId/i, /missing secretKey/i],
    zh: '参数错误',
    en: 'Invalid argument'
  },
  {
    patterns: [/verification[_ ]code (?:is )?invalid/i, /验证码错误/i, /验证码过期/],
    zh: '验证码错误或已过期，请重新获取',
    en: 'Verification code invalid or expired'
  },
  {
    patterns: [/Network (?:Error|request failed)/i, /fetch failed/i, /Failed to fetch/i, /ENOTFOUND|ETIMEDOUT|ECONNR/i],
    zh: '网络异常，请检查网络连接',
    en: 'Network error. Please check your connection.'
  },
  {
    patterns: [/401|invalid[_ ]token|expired[_ ]token|token has expired|Unauthorized/i],
    zh: '登录已过期，请重新登录',
    en: 'Session expired. Please login again.'
  },
  {
    patterns: [/403|forbidden/i, /权限不足/],
    zh: '权限不足',
    en: 'Forbidden'
  },
  {
    patterns: [/404|not found/i, /Method Not Allowed/i],
    zh: '功能暂不可用，请稍后重试',
    en: 'Feature not available. Try again later.'
  },
  {
    patterns: [/500|internal (?:server )?error|Server Error/i, /服务器错误/],
    zh: '服务器异常，请稍后重试',
    en: 'Server error. Please try again later.'
  },
  {
    patterns: [/rate[_ ]?limit/i, /too many requests/i, /请求过于频繁/],
    zh: '请求过于频繁，请稍后再试',
    en: 'Too many requests. Please slow down.'
  },
  {
    patterns: [/验证码/],
    zh: '验证码错误或已过期',
    en: 'Verification code error'
  },
  {
    patterns: [/old password/i, /旧密码/],
    zh: '旧密码错误',
    en: 'Old password incorrect'
  },
  {
    patterns: [/password (?:too )?weak|invalid[_ ]password/i, /密码不符合/],
    zh: '密码不符合复杂度要求',
    en: 'Password does not meet complexity requirements'
  },
  {
    patterns: [/操作失败/, /修改失败/],
    zh: '操作失败',
    en: 'Operation failed'
  },
  // ─── cloudbase.ts 内部错误 key ───
  {
    patterns: [/verification_code_send_failed/i],
    zh: '验证码发送失败，请稍后再试',
    en: 'Failed to send verification code'
  },
  {
    patterns: [/signup_failed/i],
    zh: '注册失败，请重试',
    en: 'Registration failed, try again'
  },
  {
    patterns: [/signin_failed/i],
    zh: '登录失败，请重试',
    en: 'Login failed, try again'
  },
  {
    patterns: [/reauth_failed/i],
    zh: '验证码发送失败',
    en: 'Failed to send verification code'
  },
  {
    patterns: [/reauth_not_logged_in/i],
    zh: '请先登录',
    en: 'Please login first'
  },
  {
    patterns: [/password_change_failed/i],
    zh: '密码修改失败，请检查验证码是否正确',
    en: 'Password change failed. Check your verification code.'
  },
  {
    patterns: [/CloudBase SDK 未初始化/i],
    zh: '云同步服务暂不可用',
    en: 'Cloud sync unavailable'
  },
  {
    patterns: [/CloudBase 管理员 API 暂未集成/, /请联系 WorkBuddy AI 助手/, /password_reset_requires_admin/],
    zh: '密码重置需要管理员协助，请通过 WorkBuddy AI 助手（我）修改',
    en: 'Password reset requires admin. Please ask the WorkBuddy AI assistant to reset it via MCP.'
  }
]

/** 通用兜底 */
const FALLBACK_ZH = '操作失败，请重试'
const FALLBACK_EN = 'Operation failed, please try again'

/**
 * 把 IPC / CloudBase 错误信息翻译成目标语言。
 * 如果不匹配任何已知模式，则原样返回原文。
 */
export function translateError(rawError: string, lang: Lang): string {
  if (!rawError) return lang === 'zh' ? '未知错误' : 'Unknown error'

  for (const entry of KEYWORD_MAP) {
    for (const pattern of entry.patterns) {
      if (pattern.test(rawError)) {
        return lang === 'zh' ? entry.zh : entry.en
      }
    }
  }

  return lang === 'zh' ? FALLBACK_ZH : FALLBACK_EN
}

/** 把 Error 对象转成友好提示 */
export function friendlyError(e: unknown, lang: Lang, fallback?: string): string {
  const raw = e instanceof Error ? e.message : String(e)
  const translated = translateError(raw, lang)
  if (translated !== (lang === 'zh' ? FALLBACK_ZH : FALLBACK_EN)) return translated
  // 没匹配上但有兜底文案
  if (fallback) return fallback
  // 显示原文（一般是英文），但格式友好
  return raw
}