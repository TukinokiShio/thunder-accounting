import { useState, useEffect, useCallback } from 'react'
import { Zap, Mail, Lock, ShieldCheck, Eye, EyeOff, Loader2, Check, X, Send, ArrowLeft, Smartphone, User } from 'lucide-react'
import { useStore } from '@/store'
import { useLanguage } from '@/i18n/LanguageContext'
import { friendlyError } from '@/utils/errorMessages'
import pkg from '../../package.json'

type Mode = 'login' | 'register' | 'forgot'
type LoginMode = 'password' | 'verification'
type Lang = 'zh' | 'en'

function m(l: Lang, zh: string, en: string): string { return l === 'zh' ? zh : en }

// ─── 表单校验 ─────────────────────────────────────
function validEmail(v: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) }
function validPhone(v: string): boolean { return /^\d{11}$/.test(v) }
function validAccount(v: string): boolean { return /^[a-zA-Z0-9_]+$/.test(v) }
function validPasswordLen(v: string): boolean { return v.length >= 6 }
function strongPassword(v: string): boolean {
  let s = 0; if (/[a-z]/.test(v)) s++; if (/[A-Z]/.test(v)) s++; if (/[0-9]/.test(v)) s++; if (/[^a-zA-Z0-9]/.test(v)) s++; return s >= 3
}

function ValIcon({ ok }: { ok: boolean | null }) {
  if (ok === null) return null
  return ok ? <Check size={14} className="text-green-500" /> : <X size={14} className="text-red-400" />
}

export function LoginPage() {
  const setUser = useStore(s => s.setUser)
  const addToast = useStore(s => s.addToast)
  const { language, setLanguage } = useLanguage()
  const lang = (language === 'en' ? 'en' : 'zh') as Lang
  const T = (zh: string, en: string) => m(lang, zh, en)

  const [mode, setMode] = useState<Mode>('login')
  const [loginMode, setLoginMode] = useState<LoginMode>('password')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [verificationId, setVerificationId] = useState('')
  const [remember, setRemember] = useState(true)
  const [autoLogin, setAutoLogin] = useState(false)
  const [showPwd, setShowPwd] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [codeSent, setCodeSent] = useState(false)

  useEffect(() => {
    window.electronAPI.loadCredentials().then(c => {
      setRemember(c.rememberAccount)
      setAutoLogin(c.autoLogin)
      if (c.rememberAccount && c.identifier) setIdentifier(c.identifier)
    })
  }, [])

  const handleRemember = useCallback((v: boolean) => {
    setRemember(v)
    if (!v) {
      setAutoLogin(false)
      void window.electronAPI.saveCredentials('', false, false)
    }
  }, [])

  function toLogin() { setMode('login'); clear() }
  function toRegister() { setMode('register'); clear() }
  function toForgot() { setMode('forgot'); clear() }
  function clear() { setError(''); setVerifyCode(''); setConfirmPwd(''); setCodeSent(false) }

  // ── 标识符校验 ─────────────────────────────────────
  const idTrim = identifier.trim()
  const isAdmin = idTrim === 'admin'

  // 判断标识符类型
  const idType = (): 'email' | 'phone' | 'account' | 'invalid' => {
    if (isAdmin) return 'account'
    if (validEmail(idTrim)) return 'email'
    if (validPhone(idTrim)) return 'phone'
    if (validAccount(idTrim) && idTrim.length >= 3) return 'account'
    return 'invalid'
  }

  const idOk = idTrim ? (isAdmin ? true : idType() !== 'invalid') : null
  const noId = () => { setError(T('请输入有效的账号/邮箱/手机号', 'Enter valid account/email/phone')); return false }

  // ── 管理员映射 ──────────────────────────────────────
  const ADMIN_EMAIL = '15211073887@163.com'
  const resolveIdentifier = () => isAdmin ? ADMIN_EMAIL : idTrim

  // ── 验证码 ─────────────────────────────────────────
  async function sendCode() {
    if (idType() === 'invalid') { setError(T('请输入有效的邮箱或手机号', 'Enter valid email or phone')); return }
    setError('')
    setSendingCode(true)
    try {
      // 找回密码只向已注册的 Auth 用户发送验证码，避免 accounts 映射参与身份解析。
      const result = await window.electronAPI.sendCode(resolveIdentifier(), mode === 'forgot')
      setCodeSent(true)
      setVerificationId(result.verificationId || '')
      const hint = result.type === 'phone'
        ? T(`验证码已发送到手机 ${result.target}`, `Code sent to phone ${result.target}`)
        : T(`验证码已发送到邮箱 ${result.target}`, `Code sent to email ${result.target}`)
      addToast('success', hint)
    } catch (e) { setError(friendlyError(e, lang)) }
    finally { setSendingCode(false) }
  }

  // ── 登录 ───────────────────────────────────────────
  async function doLogin() {
    if (!idOk) return noId()
    const resolved = resolveIdentifier()

    if (loginMode === 'password') {
      if (!validPasswordLen(password)) { setError(T('密码至少 6 位', 'Password at least 6 characters')); return }
    } else {
      if (!verifyCode.trim()) { setError(T('请输入验证码', 'Enter verification code')); return }
    }

    setError(''); setLoading(true)
    try {
      const result = loginMode === 'password'
        ? await window.electronAPI.login(resolved, password)
        : await window.electronAPI.loginWithCode(resolved, verifyCode.trim(), verificationId)
      // 不保存密码；自动登录使用已持久化的 CloudBase 刷新令牌。
      await window.electronAPI.saveCredentials(resolved, remember, autoLogin)
      setUser(result.user)
      addToast('success', T('欢迎回来！', 'Welcome back!'))
    } catch (e) { setError(friendlyError(e, lang)) }
    finally { setLoading(false) }
  }

  // ── 注册 ───────────────────────────────────────────
  async function doRegister() {
    if (!idOk) return noId()
    if (!codeSent) { setError(T('请先发送验证码', 'Please send verification code first')); return }
    if (!verifyCode.trim()) { setError(T('请输入验证码', 'Enter verification code')); return }
    if (!validPasswordLen(password)) { setError(T('密码至少 6 位', 'Password at least 6 characters')); return }
    if (!strongPassword(password)) { setError(T('密码强度不够', 'Password too weak')); return }
    if (password !== confirmPwd) { setError(T('两次密码不一致', 'Passwords do not match')); return }
    setError(''); setLoading(true)
    try {
      // 注册逻辑：邮箱或手机号，由 main.ts IPC 内部分流到 registerWithEmail / registerWithPhone
      const result = await window.electronAPI.register(idTrim, password, verifyCode.trim(), verificationId)
      await window.electronAPI.saveCredentials(idTrim, remember, autoLogin)
      setUser(result.user || result)
      addToast('success', T('注册成功！', 'Registered!'))
    } catch (e) { setError(friendlyError(e, lang)) }
    finally { setLoading(false) }
  }

  // ── 忘记密码 ───────────────────────────────────────
  async function doReset() {
    if (!idOk) return noId()
    if (!codeSent) { setError(T('请先发送验证码', 'Please send verification code first')); return }
    if (!verifyCode.trim()) { setError(T('请输入验证码', 'Enter verification code')); return }
    if (!validPasswordLen(password)) { setError(T('密码至少 6 位', 'Password at least 6 characters')); return }
    if (!strongPassword(password)) { setError(T('密码强度不够', 'Password too weak')); return }
    if (password !== confirmPwd) { setError(T('两次密码不一致', 'Passwords do not match')); return }
    setError(''); setLoading(true)
    try {
      await window.electronAPI.resetPassword(idTrim, password, verifyCode.trim(), verificationId)
      addToast('success', T('密码已重置，请登录', 'Password reset! Please login'))
      toLogin()
    } catch (e) { setError(friendlyError(e, lang)) }
    finally { setLoading(false) }
  }

  async function submit() {
    if (mode === 'login')      await doLogin()
    else if (mode === 'register') await doRegister()
    else if (mode === 'forgot')   await doReset()
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !sendingCode) submit()
  }

  const cls = "w-full pl-9 pr-9 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
  const clsNoIcon = "w-full py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"

  function btnLabel() {
    if (mode === 'login')    return T('登录', 'Login')
    if (mode === 'register') return T('注册', 'Register')
    return T('重置密码', 'Reset')
  }

  // ── 标识符图标 ──────────────────────────────────────
  function IdIcon() {
    const t = idType()
    if (t === 'email') return <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
    if (t === 'phone') return <Smartphone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
    return <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
  }

  return (
    <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-sm mx-4 bg-white dark:bg-gray-850 rounded-2xl shadow-lg p-8 relative">

        {/* 语言切换 */}
        <div className="absolute top-3 right-3 flex rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
          <button onClick={() => setLanguage('zh')} className={`px-2 py-1 ${language==='zh'?'bg-primary-500 text-white':'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>中</button>
          <button onClick={() => setLanguage('en')} className={`px-2 py-1 ${language==='en'?'bg-primary-500 text-white':'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>EN</button>
        </div>

        {/* Logo */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 bg-primary-500 rounded-xl flex items-center justify-center mb-3"><Zap size={24} className="text-white" /></div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">雷霆记账</h1>
          <p className="text-sm text-gray-400 mt-1">{T('个人记账，轻松管理', 'Simple personal finance')}</p>
        </div>

        {/* 模式切换（登录/注册） */}
        <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1 mb-4">
          <button onClick={toLogin}    className={`flex-1 py-2 text-sm rounded-md font-medium transition-colors ${mode==='login'?'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm':'text-gray-500'}`}>{T('登录','Login')}</button>
          <button onClick={toRegister} className={`flex-1 py-2 text-sm rounded-md font-medium transition-colors ${mode==='register'?'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm':'text-gray-500'}`}>{T('注册','Register')}</button>
        </div>

        {/* 登录方式切换（仅登录模式） */}
        {mode === 'login' && (
          <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1 mb-4">
            <button onClick={() => { setLoginMode('password'); clear() }}
              className={`flex-1 py-1.5 text-xs rounded-md font-medium transition-colors ${loginMode==='password'?'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm':'text-gray-500'}`}>
              {T('密码登录','Password')}
            </button>
            <button onClick={() => { setLoginMode('verification'); clear() }}
              className={`flex-1 py-1.5 text-xs rounded-md font-medium transition-colors ${loginMode==='verification'?'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm':'text-gray-500'}`}>
              {T('验证码登录','Code')}
            </button>
          </div>
        )}

        {/* 忘记密码返回按钮 */}
        {mode === 'forgot' && (
          <button onClick={toLogin} className="flex items-center gap-1 text-xs text-gray-500 hover:text-primary-500 mb-4 transition-colors">
            <ArrowLeft size={14} />{T('返回登录','Back')}
          </button>
        )}

        {/* 错误信息 */}
        {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">{error}</div>}

        {/* 表单 */}
        <div className="space-y-4" onKeyDown={onKey}>

          {/* ── 标识符输入 ── */}
          <div>
            <div className="relative">
              <IdIcon />
              <input type="text" value={identifier} onChange={e => { setIdentifier(e.target.value); setCodeSent(false) }}
                placeholder={mode === 'forgot'
                  ? T('邮箱或手机号', 'Email or phone')
                  : mode === 'register'
                    ? T('邮箱或手机号', 'Email or phone')
                    : T('账号 / 邮箱 / 手机号', 'Account / Email / Phone')}
                className={cls} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2"><ValIcon ok={idOk} /></span>
            </div>
          </div>

          {/* ── 密码输入（密码登录 / 注册 / 忘记密码） ── */}
          {(loginMode === 'password' || mode !== 'login') && (
            <div>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type={showPwd?'text':'password'} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? T('设置密码', 'Set password') : mode === 'forgot' ? T('新密码','New Password') : '••••••'} className={cls} />
                <span className="absolute right-8 top-1/2 -translate-y-1/2">
                  {mode==='register' || mode==='forgot'
                    ? <ValIcon ok={password ? strongPassword(password) : null} />
                    : <ValIcon ok={password ? validPasswordLen(password) : null} />}
                </span>
                <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
                  {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          )}

          {/* ── 验证码输入（验证码登录 / 注册 / 忘记密码） ── */}
          {(loginMode === 'verification' || mode === 'register' || mode === 'forgot') && (
            <div className="flex gap-2">
              <input type="text" value={verifyCode} onChange={e => setVerifyCode(e.target.value)}
                placeholder={T('验证码', 'Verification code')} className={clsNoIcon + ' flex-1 px-3'} />
              <button onClick={sendCode} disabled={sendingCode || !idOk}
                className="px-3 py-2 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-200 disabled:opacity-50 whitespace-nowrap flex items-center gap-1">
                {sendingCode ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                {codeSent ? T('已发送','Sent') : T('发送验证码','Send Code')}
              </button>
            </div>
          )}

          {/* ── 确认密码（注册 / 忘记密码） ── */}
          {(mode === 'register' || mode === 'forgot') && (
            <div>
              <div className="relative">
                <ShieldCheck size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type={showPwd?'text':'password'} value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)}
                  placeholder={mode === 'register' ? T('确认密码', 'Confirm password') : T('确认新密码', 'Confirm new password')} className={cls} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2"><ValIcon ok={confirmPwd ? password===confirmPwd : null} /></span>
              </div>
            </div>
          )}

          {/* ── 记住我 ── */}
          {mode === 'login' && loginMode === 'password' && (
            <label className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 cursor-pointer select-none">
              <input type="checkbox" checked={remember} onChange={e => handleRemember(e.target.checked)}
                className="rounded border-gray-300 text-primary-500 focus:ring-primary-500" />
              {T('记住账号','Remember me')}
            </label>
          )}
          {mode === 'login' && loginMode === 'password' && (
            <label className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 cursor-pointer select-none">
              <input type="checkbox" checked={autoLogin} disabled={!remember}
                onChange={e => setAutoLogin(e.target.checked)}
                className="rounded border-gray-300 text-primary-500 focus:ring-primary-500 disabled:opacity-50" />
              {T('自动登录', 'Auto login')}
            </label>
          )}

          {/* ── 提交 ── */}
          <button onClick={submit} disabled={loading}
            className="w-full py-2.5 bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
            {loading && <Loader2 size={16} className="animate-spin" />}
            {btnLabel()}
          </button>

          {/* ── 忘记密码链接 ── */}
          {mode === 'login' && loginMode === 'password' && (
            <button onClick={toForgot} className="w-full text-xs text-gray-400 hover:text-primary-500 text-center transition-colors">
              {T('忘记密码？','Forgot password?')}
            </button>
          )}
        </div>

        {/* 版本号 */}
        <p className="text-center text-xs text-gray-300 dark:text-gray-600 mt-6">v{pkg.version}</p>
      </div>
    </div>
  )
}
