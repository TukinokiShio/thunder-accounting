import { useState, useEffect, useCallback } from 'react'
import { Zap, Mail, Lock, ShieldCheck, Eye, EyeOff, Loader2, Check, X, Send } from 'lucide-react'
import { useStore } from '@/store'
import { useLanguage } from '@/i18n/LanguageContext'
import { friendlyError } from '@/utils/errorMessages'

// ─── Error messages zh/en ─────────────────────────

const MSG = {
  emailRequired: { zh: '请输入邮箱', en: 'Email is required' },
  emailInvalid: { zh: '邮箱格式不正确', en: 'Invalid email format' },
  passwordRequired: { zh: '请输入密码', en: 'Password is required' },
  passwordTooShort: { zh: '密码至少 6 位', en: 'At least 6 characters' },
  passwordWeak: { zh: '密码需含大小写字母+数字+特殊字符中的至少3种', en: 'Password needs 3 of: upper, lower, digit, special' },
  passwordMismatch: { zh: '两次密码不一致', en: 'Passwords do not match' },
  registerOk: { zh: '注册成功！', en: 'Registered!' },
  welcome: { zh: '欢迎回来！', en: 'Welcome back!' },
  remember: { zh: '记住账号', en: 'Remember me' },
  registerHint: { zh: '输入邮箱后点击发送验证码，再到邮箱查收验证码完成注册', en: 'Enter email, send code, then verify with email code' },
  loginHint: { zh: '登录后数据将自动同步到云端', en: 'Data syncs to cloud after login' },
  loginHintNew: { zh: '新设备首次登录需验证邮箱', en: 'New device - email verification required' },
  codeSent: { zh: '验证码已发送到邮箱', en: 'Code sent to email' },
  sendCode: { zh: '发送验证码', en: 'Send Code' },
} as const

type Lang = 'zh' | 'en'
function m(l: Lang, key: keyof typeof MSG): string { return MSG[key][l] }

// ─── Validation ───────────────────────────────────

function validateEmail(v: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) }
function validatePassword(v: string): boolean { return v.length >= 6 }
function isStrongPassword(v: string): boolean {
  let score = 0
  if (/[a-z]/.test(v)) score++
  if (/[A-Z]/.test(v)) score++
  if (/[0-9]/.test(v)) score++
  if (/[^a-zA-Z0-9]/.test(v)) score++
  return score >= 3
}

export function LoginPage() {
  const setUser = useStore(s => s.setUser)
  const addToast = useStore(s => s.addToast)
  const { language, setLanguage } = useLanguage()
  const lang = (language === 'en' ? 'en' : 'zh') as Lang

  const [isRegister, setIsRegister] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [codeSent, setCodeSent] = useState(false)
  const [error, setError] = useState('')

  // Detect new device: no stored credentials → new device
  const [isNewDevice, setIsNewDevice] = useState(false)

  // Load saved credentials on mount
  useEffect(() => {
    window.electronAPI.loadCredentials().then(c => {
      if (c.email) {
        setEmail(c.email); setPassword(c.password)
      } else {
        setIsNewDevice(true)
      }
    })
  }, [])

  // Handle remember me toggle: clear saved credentials when unchecked
  const handleRememberChange = useCallback((checked: boolean) => {
    setRemember(checked)
    if (!checked) window.electronAPI.saveCredentials('', '')
  }, [])

  // Computed validations (trim input for consistent display)
  const trimmedEmail = email.trim()
  const emailOk = trimmedEmail ? validateEmail(trimmedEmail) : null
  const passwordOk = password ? validatePassword(password) : null
  const passwordStrong = password ? isStrongPassword(password) : null
  const confirmOk = confirmPassword ? password === confirmPassword : null

  const validate = (): boolean => {
    if (!emailOk) { setError(m(lang, 'emailInvalid')); return false }
    if (!passwordOk) { setError(m(lang, 'passwordTooShort')); return false }
    if (isRegister && !passwordStrong) { setError(m(lang, 'passwordWeak')); return false }
    if (isRegister && !confirmOk) { setError(m(lang, 'passwordMismatch')); return false }
    if ((isRegister || (isNewDevice && !isRegister)) && !verifyCode.trim()) { setError(lang === 'zh' ? '请输入验证码' : 'Enter verification code'); return false }
    return true
  }

  const handleSendCode = async () => {
    if (!validateEmail(trimmedEmail)) { setError(m(lang, 'emailInvalid')); return }
    setError('')
    setSendingCode(true)
    try {
      await window.electronAPI.sendCode(trimmedEmail)
      setCodeSent(true)
      addToast('success', m(lang, 'codeSent'))
    } catch (e) {
      setError(friendlyError(e, lang))
    } finally {
      setSendingCode(false)
    }
  }

  const handleSubmit = async () => {
    setError('')
    if (!validate()) return

    setLoading(true)
    try {
      if (isRegister) {
        const user = await window.electronAPI.register(trimmedEmail, password, verifyCode.trim())
        if (remember) window.electronAPI.saveCredentials(trimmedEmail, password)
        setUser(user)
        addToast('success', m(lang, 'registerOk'))
      } else {
        const result = await window.electronAPI.login(trimmedEmail, password)
        if (remember) window.electronAPI.saveCredentials(trimmedEmail, password)
        setUser(result.user)
        addToast('success', m(lang, 'welcome'))
      }
    } catch (e) {
      setError(friendlyError(e, lang))
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !sendingCode) handleSubmit()
  }

  const ValIcon = ({ ok }: { ok: boolean | null }) => {
    if (ok === null) return null
    return ok ? <Check size={14} className="text-green-500" /> : <X size={14} className="text-red-400" />
  }

  return (
    <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-sm mx-4 bg-white dark:bg-gray-850 rounded-2xl shadow-lg p-8 relative">
        {/* Language Switch */}
        <div className="absolute top-3 right-3 flex rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
          <button onClick={() => setLanguage('zh')} className={`px-2 py-1 ${language === 'zh' ? 'bg-primary-500 text-white' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>中</button>
          <button onClick={() => setLanguage('en')} className={`px-2 py-1 ${language === 'en' ? 'bg-primary-500 text-white' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>EN</button>
        </div>

        {/* Logo */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 bg-primary-500 rounded-xl flex items-center justify-center mb-3">
            <Zap size={24} className="text-white" />
          </div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">雷霆记账</h1>
          <p className="text-sm text-gray-400 mt-1">{lang === 'zh' ? '个人记账，轻松管理' : 'Simple personal finance'}</p>
        </div>

        {/* Tab Switch */}
        <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1 mb-6">
          <button onClick={() => { setIsRegister(false); setError(''); setCodeSent(false); setVerifyCode('') }}
            className={`flex-1 py-2 text-sm rounded-md font-medium transition-colors ${!isRegister ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500'}`}>{lang === 'zh' ? '登录' : 'Login'}</button>
          <button onClick={() => { setIsRegister(true); setError(''); setCodeSent(false); setVerifyCode('') }}
            className={`flex-1 py-2 text-sm rounded-md font-medium transition-colors ${isRegister ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500'}`}>{lang === 'zh' ? '注册' : 'Register'}</button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">{error}</div>
        )}

        {/* Form */}
        <div className="space-y-4" onKeyDown={handleKeyDown}>
          {/* Email */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{lang === 'zh' ? '邮箱' : 'Email'}</label>
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="email" value={email} onChange={e => { setEmail(e.target.value); setCodeSent(false) }}
                placeholder="name@example.com"
                className="w-full pl-9 pr-9 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2"><ValIcon ok={emailOk} /></span>
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{lang === 'zh' ? '密码' : 'Password'}</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••"
                className="w-full pl-9 pr-9 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
              <span className="absolute right-8 top-1/2 -translate-y-1/2">
                {isRegister ? <ValIcon ok={passwordStrong} /> : <ValIcon ok={passwordOk} />}
              </span>
              <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {/* Verification Code for registration or new device login */}
          {(isRegister || (isNewDevice && !isRegister)) && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{lang === 'zh' ? '验证码' : 'Verification Code'}</label>
              <div className="flex gap-2">
                <input type="text" value={verifyCode} onChange={e => setVerifyCode(e.target.value)}
                  placeholder={lang === 'zh' ? '邮箱收到的验证码' : 'Code from email'}
                  className="flex-1 py-2.5 px-3 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                <button type="button" onClick={handleSendCode} disabled={sendingCode || !emailOk}
                  className="px-3 py-2 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-200 disabled:opacity-50 whitespace-nowrap flex items-center gap-1">
                  {sendingCode ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  {codeSent ? (lang === 'zh' ? '已发送' : 'Sent') : m(lang, 'sendCode')}
                </button>
              </div>
            </div>
          )}

          {/* Confirm Password (register only) */}
          {isRegister && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{lang === 'zh' ? '确认密码' : 'Confirm'}</label>
              <div className="relative">
                <ShieldCheck size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type={showConfirm ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="••••••"
                  className="w-full pl-9 pr-9 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                <span className="absolute right-8 top-1/2 -translate-y-1/2"><ValIcon ok={confirmOk} /></span>
                <button type="button" onClick={() => setShowConfirm(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showConfirm ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          )}

          {/* Remember Me */}
          <label className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 cursor-pointer select-none">
            <input type="checkbox" checked={remember} onChange={e => handleRememberChange(e.target.checked)}
              className="rounded border-gray-300 text-primary-500 focus:ring-primary-500" />
            {m(lang, 'remember')}
          </label>

          {/* Submit */}
          <button onClick={handleSubmit} disabled={loading}
            className="w-full py-2.5 bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
            {loading && <Loader2 size={16} className="animate-spin" />}
            {isRegister ? (lang === 'zh' ? '注册' : 'Register') : (lang === 'zh' ? '登录' : 'Login')}
          </button>
        </div>

        {/* Hint */}
        <p className="text-xs text-gray-400 text-center mt-4">
          {isRegister ? m(lang, 'registerHint') : isNewDevice ? m(lang, 'loginHintNew') : m(lang, 'loginHint')}
        </p>
      </div>
    </div>
  )
}
