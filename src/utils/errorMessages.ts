/**
 * CloudBase / IPC 错误信息中英映射
 * 用于把后端抛出的英文错误翻译成对应语言
 */

export type Lang = 'zh' | 'en'

/** 关键字 → 中英翻译（按关键字匹配，错误信息含此关键字即翻译） */
const KEYWORD_MAP: Array<{ patterns: RegExp[]; zh: string; en: string }> = [
  {
    patterns: [/verification_code_missing_id/i, /missing verification[_ ]id/i],
    zh: '云端验证码服务未返回验证码编号，验证码尚未发送成功；请稍后重试，若持续出现请检查 CloudBase 短信/邮件配置。',
    en: 'CloudBase did not return a verification ID, so the code was not sent. Check the CloudBase SMS/email configuration.'
  },
  {
    patterns: [/phone_not_bound/i, /phone[_ ]not[_ ]configured/i, /sms.*not.*configured/i, /短信.*未开启/i],
    zh: 'CloudBase 短信登录未启用或当前账号未绑定手机号，请在 CloudBase 控制台开启短信登录并确认手机号绑定。',
    en: 'CloudBase SMS login is disabled or this account has no bound phone. Check the Auth configuration and binding.'
  },
  {
    patterns: [/account_not_found/i, /user_not_found/i, /phone.*not.*found/i, /email.*not.*found/i, /user.*does not exist/i],
    zh: '账号尚未注册',
    en: 'This account is not registered'
  },
  {
    patterns: [/verification_code_send_failed/i, /send.*verification.*failed/i, /sms.*send.*failed/i, /email.*send.*failed/i],
    zh: 'CloudBase 验证码发送失败：请检查短信/邮件服务是否启用、模板是否审核、配额和网络；验证码未发送成功。',
    en: 'CloudBase failed to send the code. Check the SMS/email provider, template approval, quota, and network.'
  },
  {
    patterns: [/invalid_phone_number/i, /phone.*format/i, /手机号格式/],
    zh: '手机号格式无效，请输入11位大陆手机号数字。',
    en: 'Invalid mainland China phone number. Enter 11 digits.'
  },
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
    patterns: [/invalid email/i, /invalid argument/i, /invalid[_ ]argument/i, /missing secretId/i, /missing secretKey/i, /invalid_argument/],
    zh: '参数错误',
    en: 'Invalid argument'
  },
  {
    patterns: [/SIGN_PARAM_INVALID/i, /secret id error/i, /signature.*invalid/i, /InvalidAccessKeyId/i],
    zh: 'CloudBase 配置异常（签名参数无效）。请检查应用 .env 中 CLOUDBASE_API_KEY 是否正确',
    en: 'CloudBase config error (signature invalid). Check CLOUDBASE_API_KEY in .env'
  },
  {
    patterns: [/verification[_ ]code (?:is )?invalid/i, /verification[_ ]token invalid/i, /invalid verification token/i, /phone or email does not match validation code/i, /验证码错误/i, /验证码过期/],
    zh: '验证码错误或已过期，请重新获取',
    en: 'Verification code invalid or expired'
  },
  {
    patterns: [/verification[_ ]code[_ ]?expired/i, /verification[_ ]token[_ ]?expired/i],
    zh: '验证码已过期，请重新获取',
    en: 'Verification code expired'
  },
  {
    patterns: [/username or verification[_ ]token can not both be empty/i, /username.*verification.*empty/i],
    zh: '账号或验证码不能为空',
    en: 'Username or verification code cannot be empty'
  },
  {
    patterns: [/cannot find user/i, /user not found/i, /account_not_found/i, /user.*does not exist/i],
    zh: '账号不存在，请检查输入或先注册',
    en: 'Account not found. Please check your input or register first.'
  },
  {
    patterns: [/Network (?:Error|request failed)/i, /fetch failed/i, /Failed to fetch/i, /ENOTFOUND|ETIMEDOUT|ECONNR/i],
    zh: '网络异常，请检查网络连接',
    en: 'Network error. Please check your connection.'
  },
  {
    patterns: [/expired[_ ]token|token has expired|token expiry/i],
    zh: '登录状态已过期，请重新登录',
    en: 'Your sign-in session has expired. Please sign in again.'
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
    patterns: [/phone[_ ]?number invalid/i, /invalid[_ ]phone/i, /invalid phone number/i, /phone.*format/i, /无效手机号/, /手机号格式/],
    zh: '手机号格式无效，请输入11位数字',
    en: 'Invalid phone number format'
  },
  {
    patterns: [/sms[_ ]?rate[_ ]?limit/i, /短信.*频率/, /短信.*超额/, /短信限流/, /quota.*exceeded/i],
    zh: '短信发送过于频繁，请稍后再试',
    en: 'SMS rate limit exceeded'
  },
  {
    patterns: [/email[_ ]?rate[_ ]?limit/i, /邮件.*频率/, /邮件.*超额/, /邮件限流/],
    zh: '邮件发送过于频繁，请稍后再试',
    en: 'Email rate limit exceeded'
  },
  {
    patterns: [/SMS.*not.*configured/i, /短信服务.*未配置/, /短信功能.*未开启/, /短信登录.*未启用/],
    zh: '短信登录功能未开启，请联系管理员',
    en: 'SMS login not configured'
  },
  {
    patterns: [/Email.*not.*configured/i, /邮件服务.*未配置/, /邮件登录.*未启用/],
    zh: '邮件登录功能未开启，请联系管理员',
    en: 'Email login not configured'
  },
  {
    patterns: [/verification_code_send_failed/i, /发送验证码.*失败/i, /发送验证码错误/],
    zh: '验证码发送失败，请检查网络或换邮箱/手机号重试',
    en: 'Failed to send verification code. Check network or try a different email/phone.'
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
    patterns: [/verification_signin_failed/i],
    zh: '验证码登录失败，请检查验证码或账号是否正确',
    en: 'Verification sign-in failed. Check your code and account.'
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
    patterns: [/binding_reauth_target_missing/i],
    zh: '当前账号没有可用的已绑定手机号或邮箱，无法完成身份验证',
    en: 'No bound phone or email is available for verification.'
  },
  {
    patterns: [/binding_reauth_required/i],
    zh: '请先验证当前绑定渠道，再绑定新邮箱',
    en: 'Verify the existing bound contact before binding a new email.'
  },
  {
    patterns: [/auth_binding_sudo_failed/i, /auth_binding_sudo_missing/i],
    zh: '当前绑定渠道验证未通过，无法授权绑定新邮箱',
    en: 'The existing contact could not authorize this binding.'
  },
  {
    patterns: [/auth_binding_update_failed/i, /invalid_argument/i, /参数错误/i],
    zh: '邮箱绑定失败，请检查验证码是否对应新邮箱',
    en: 'Email binding failed. Check that the code belongs to the new email.'
  },
  {
    patterns: [/cannot_remove_last_binding/i, /只绑定一个平台/, /至少保留.*绑定/],
    zh: '当前只绑定一个平台，不能进行解绑操作，请先绑定另一个平台',
    en: 'You cannot unbind the only remaining platform. Bind another platform first.'
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
    patterns: [/account_delete_job_unavailable/i, /deletion_job_unavailable/i],
    zh: '注销服务尚未就绪：云端缺少注销清理任务。请管理员部署 delUser、cleanupDeletedUsers，并创建 account_deletion_jobs 集合后重试。',
    en: 'Account deletion is not ready: the cloud cleanup job is unavailable. Ask an administrator to deploy the deletion functions and create account_deletion_jobs.'
  },
  {
    patterns: [/account_delete_session_expired/i, /invalid_session/i],
    zh: '登录状态已失效，请重新登录后再注销。',
    en: 'Your session has expired. Please sign in again before deleting your account.'
  },
  {
    patterns: [/account_delete_verification_failed/i, /auth_delete_failed/i],
    zh: '注销验证码错误或已过期，请重新获取验证码后再试。',
    en: 'The deletion verification code is invalid or expired. Request a new code and try again.'
  },
  {
    patterns: [/account_delete_service_unavailable/i],
    zh: '注销服务暂时不可用，请稍后重试；若持续出现，请联系管理员检查云函数。',
    en: 'The account-deletion service is temporarily unavailable. Try again later or ask an administrator to check the cloud function.'
  },
  {
    patterns: [/account_delete_failed/i, /Failed to delete user data/i, /Delete user failed/i],
    zh: '注销失败，请重新获取验证码后重试。',
    en: 'Account deletion failed. Request a new verification code and try again.'
  },
  {
    patterns: [/local_cleanup_failed/i],
    zh: '账号已注销，但本地数据清理失败，请重新启动应用后重试清理',
    en: 'Account deleted, but local cleanup failed. Restart the app and retry cleanup.'
  },
  {
    patterns: [/CloudBase 管理员 API 暂未集成/, /请联系 WorkBuddy AI 助手/, /password_reset_requires_admin/],
    zh: '密码重置需要管理员协助，请通过 WorkBuddy AI 助手（我）修改',
    en: 'Password reset requires admin. Please ask the WorkBuddy AI assistant to reset it via MCP.'
  }
]

/** 通用兜底 */
const FALLBACK_ZH = '云端服务返回未分类错误'
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

  return lang === 'zh' ? '云端服务暂时不可用，请稍后再试' : 'Cloud service is temporarily unavailable. Try again later.'
}

/** 把 Error 对象转成友好提示 */
export function friendlyError(e: unknown, lang: Lang, fallback?: string): string {
  const raw = e instanceof Error ? e.message : String(e)
  const translated = translateError(raw, lang)
  if (translated !== (lang === 'zh' ? FALLBACK_ZH : FALLBACK_EN)) return translated
  // 没匹配上但有兜底文案
  if (fallback) return fallback
  // 不能把后端英文/IPC 包装错误直接暴露给中文用户；截图中的
  // "Error invoking remote method ... phone or email does not match validation code"
  // 等未知变体统一落到中文可操作提示。
  return fallback || translated
}
