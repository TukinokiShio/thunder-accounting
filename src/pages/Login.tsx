import { useState, useEffect, useCallback } from 'react'
import { Zap, Mail, Lock, ShieldCheck, Eye, EyeOff, Loader2, Check, X, Send, ArrowLeft, Smartphone } from 'lucide-react'
import { useStore } from '@/store'
import { useLanguage } from '@/i18n/LanguageContext'
import { friendlyError } from '@/utils/errorMessages'
import pkg from '../../package.json'

type Mode = 'login' | 'register' | 'forgot'
type LoginMode = 'password' | 'phoneCode' | 'emailCode'
type Lang = 'zh' | 'en'
const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
const validPhone = (v: string) => /^\d{11}$/.test(v)
const validPassword = (v: string) => v.length >= 6
const strongPassword = (v: string) => [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(x => x.test(v)).length >= 3
const tr = (lang: Lang, zh: string, en: string) => lang === 'zh' ? zh : en

function ValidationIcon({ valid }: { valid: boolean | null }) {
  if (valid === null) return null
  return valid ? <Check size={15} className="text-green-500" /> : <X size={15} className="text-red-500" />
}

export function LoginPage() {
  const setUser = useStore(s => s.setUser)
  const addToast = useStore(s => s.addToast)
  const { language, setLanguage } = useLanguage()
  const lang = (language === 'en' ? 'en' : 'zh') as Lang
  const T = (zh: string, en: string) => tr(lang, zh, en)
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

  useEffect(() => { window.electronAPI.loadCredentials().then(c => { setRemember(c.rememberAccount); setAutoLogin(c.autoLogin); if (c.rememberAccount) setIdentifier(c.identifier) }) }, [])
  const clearCode = useCallback(() => { setVerifyCode(''); setVerificationId(''); setCodeSent(false) }, [])
  const clear = useCallback(() => { setError(''); setPassword(''); setConfirmPwd(''); clearCode() }, [clearCode])
  const go = (next: Mode) => { setMode(next); clear() }
  const changeLoginMode = (next: LoginMode) => { setLoginMode(next); setError(''); clearCode() }
  const onIdentifier = (value: string) => { setIdentifier(value); clearCode() }
  const type = validEmail(identifier.trim()) ? 'email' : validPhone(identifier.trim()) ? 'phone' : 'invalid'
  const channel = loginMode === 'phoneCode' ? 'phone' : loginMode === 'emailCode' ? 'email' : undefined
  const idOk = identifier.trim() ? (channel ? type === channel : type !== 'invalid') : null
  const showCode = (mode === 'login' && loginMode !== 'password') || mode !== 'login'
  const showPassword = (mode === 'login' && loginMode === 'password') || mode !== 'login'
  const idLabel = channel === 'phone' ? T('手机号', 'Phone number') : channel === 'email' ? T('邮箱', 'Email') : T('账号', 'Account')
  const idPlaceholder = channel === 'phone' ? T('请输入手机号', 'Enter your phone number') : channel === 'email' ? T('请输入邮箱', 'Enter your email') : T('邮箱或手机号', 'Email or phone number')
  const idError = () => { setError(channel === 'phone' ? T('请输入有效的手机号', 'Enter a valid phone number') : channel === 'email' ? T('请输入有效的邮箱', 'Enter a valid email') : T('请输入有效的邮箱或手机号', 'Enter a valid email or phone number')); return false }
  const input = 'h-12 w-full rounded-xl border border-gray-200 bg-white px-11 pr-10 text-sm text-gray-900 outline-none transition-[border-color,box-shadow] placeholder:text-gray-400 focus:border-primary-500 focus:ring-4 focus:ring-primary-500/15 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'

  async function sendCode() {
    if (!idOk) return idError()
    setError(''); setSendingCode(true)
    // Login and recovery must never issue a code for an unregistered identity; registration is the only ANY flow.
    try { const r = await window.electronAPI.sendCode(identifier.trim(), mode !== 'register'); setVerificationId(r.verificationId || ''); setCodeSent(true); addToast('success', r.type === 'phone' ? T(`验证码已发送到手机 ${r.target}`, `Code sent to phone ${r.target}`) : T(`验证码已发送到邮箱 ${r.target}`, `Code sent to email ${r.target}`)) }
    catch (e) { setError(friendlyError(e, lang)) } finally { setSendingCode(false) }
  }
  async function doLogin() {
    if (!idOk) return idError()
    if (loginMode === 'password' && !validPassword(password)) { setError(T('密码至少 6 位', 'Password must be at least 6 characters')); return }
    if (loginMode !== 'password' && (!codeSent || !verificationId)) { setError(T('请先发送验证码', 'Send a verification code first')); return }
    if (loginMode !== 'password' && !verifyCode.trim()) { setError(T('请输入验证码', 'Enter verification code')); return }
    setError(''); setLoading(true)
    try { const r = loginMode === 'password' ? await window.electronAPI.login(identifier.trim(), password) : await window.electronAPI.loginWithCode(identifier.trim(), verifyCode.trim(), verificationId); await window.electronAPI.saveCredentials(identifier.trim(), remember, autoLogin); setUser(r.user); addToast('success', T('欢迎回来！', 'Welcome back!')) }
    catch (e) { setError(friendlyError(e, lang)) } finally { setLoading(false) }
  }
  async function doRegister() {
    if (!idOk) return idError()
    if (!codeSent || !verificationId) { setError(T('请先发送验证码', 'Send a verification code first')); return }
    if (!verifyCode.trim()) { setError(T('请输入验证码', 'Enter verification code')); return }
    if (!validPassword(password)) { setError(T('密码至少 6 位', 'Password must be at least 6 characters')); return }
    if (!strongPassword(password)) { setError(T('密码强度不够', 'Password is too weak')); return }
    if (password !== confirmPwd) { setError(T('两次密码不一致', 'Passwords do not match')); return }
    setError(''); setLoading(true)
    try { const r = await window.electronAPI.register(identifier.trim(), password, verifyCode.trim(), verificationId); await window.electronAPI.saveCredentials(identifier.trim(), remember, autoLogin); setUser(r.user || r); addToast('success', T('注册成功！', 'Registered!')) }
    catch (e) { setError(friendlyError(e, lang)) } finally { setLoading(false) }
  }
  async function doReset() {
    if (!idOk) return idError()
    if (!codeSent || !verificationId) { setError(T('请先发送验证码', 'Send a verification code first')); return }
    if (!verifyCode.trim()) { setError(T('请输入验证码', 'Enter verification code')); return }
    if (!validPassword(password)) { setError(T('密码至少 6 位', 'Password must be at least 6 characters')); return }
    if (!strongPassword(password)) { setError(T('密码强度不够', 'Password is too weak')); return }
    if (password !== confirmPwd) { setError(T('两次密码不一致', 'Passwords do not match')); return }
    setError(''); setLoading(true)
    try { await window.electronAPI.resetPassword(identifier.trim(), password, verifyCode.trim(), verificationId); addToast('success', T('密码已重置，请登录', 'Password reset. Please sign in.')); go('login') }
    catch (e) { setError(friendlyError(e, lang)) } finally { setLoading(false) }
  }
  const submit = () => mode === 'login' ? doLogin() : mode === 'register' ? doRegister() : doReset()
  const rememberChange = (value: boolean) => { setRemember(value); if (!value) { setAutoLogin(false); void window.electronAPI.saveCredentials('', false, false) } }

  return <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 dark:bg-gray-900"><section aria-labelledby="login-title" className="relative w-full max-w-[450px] rounded-[20px] border border-gray-200 bg-white p-7 shadow-sm dark:border-gray-800 dark:bg-gray-850 sm:p-8">
    <div className="absolute right-4 top-4 flex overflow-hidden rounded-lg border border-gray-200 text-xs dark:border-gray-700"><button type="button" onClick={() => setLanguage('zh')} className={`min-h-8 px-2.5 ${language === 'zh' ? 'bg-primary-500 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>中</button><button type="button" onClick={() => setLanguage('en')} className={`min-h-8 px-2.5 ${language === 'en' ? 'bg-primary-500 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>EN</button></div>
    <header className="mb-7 pt-2 text-center"><div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-500 text-white"><Zap size={24} /></div><h1 id="login-title" className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">雷霆记账</h1><p className="mt-1 text-sm text-gray-500">{T('个人记账，轻松管理', 'Simple personal finance')}</p></header>
    {mode === 'forgot' ? <button type="button" onClick={() => go('login')} className="mb-5 inline-flex min-h-10 items-center gap-1 text-sm text-gray-500 hover:text-primary-500"><ArrowLeft size={16}/>{T('返回登录', 'Back to sign in')}</button> : <nav className="mb-5 grid grid-cols-2 rounded-xl bg-gray-100 p-1 dark:bg-gray-800"><button type="button" onClick={() => go('login')} className={`min-h-10 rounded-lg text-sm font-medium ${mode === 'login' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100' : 'text-gray-500'}`}>{T('登录', 'Sign in')}</button><button type="button" onClick={() => go('register')} className={`min-h-10 rounded-lg text-sm font-medium ${mode === 'register' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100' : 'text-gray-500'}`}>{T('注册', 'Sign up')}</button></nav>}
    {mode === 'login' && <div className="mb-5 grid grid-cols-3 rounded-xl bg-gray-100 p-1 dark:bg-gray-800">{([['password',T('账号密码','Password')],['phoneCode',T('手机验证码','Phone code')],['emailCode',T('邮箱验证码','Email code')]] as const).map(([value,label]) => <button key={value} type="button" onClick={() => changeLoginMode(value)} className={`min-h-10 rounded-lg px-1 text-xs font-medium ${loginMode === value ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100' : 'text-gray-500'}`}>{label}</button>)}</div>}
    {error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600">{error}</div>}
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); void submit() }} noValidate>
      <div><label htmlFor="login-identifier" className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-gray-200">{idLabel}</label><div className="relative">{type === 'phone' || channel === 'phone' ? <Smartphone size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/> : <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/>}<input id="login-identifier" aria-invalid={idOk === false} type="text" autoComplete={channel === 'phone' ? 'tel' : 'username'} value={identifier} onChange={e => onIdentifier(e.target.value)} placeholder={idPlaceholder} className={input}/><span className="absolute right-3.5 top-1/2 -translate-y-1/2"><ValidationIcon valid={idOk}/></span></div></div>
      {showPassword && <div><label htmlFor="login-password" className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-gray-200">{mode === 'register' ? T('设置密码','Set password') : mode === 'forgot' ? T('新密码','New password') : T('密码','Password')}</label><div className="relative"><Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/><input id="login-password" type={showPwd ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'register' ? T('设置密码','Set password') : mode === 'forgot' ? T('新密码','New password') : T('请输入密码','Enter password')} className={input}/><span className="absolute right-10 top-1/2 -translate-y-1/2"><ValidationIcon valid={password ? (mode === 'login' ? validPassword(password) : strongPassword(password)) : null}/></span><button type="button" aria-label={showPwd ? T('隐藏密码','Hide password') : T('显示密码','Show password')} onClick={() => setShowPwd(v => !v)} className="absolute right-2.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100">{showPwd ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></div>}
      {showCode && <div><label htmlFor="verification-code" className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-gray-200">{T('验证码','Verification code')}</label><div className="flex gap-2"><input id="verification-code" type="text" inputMode="numeric" value={verifyCode} onChange={e => setVerifyCode(e.target.value)} placeholder={T('请输入验证码','Enter code')} className={`${input} min-w-0 px-3`}/><button type="button" onClick={() => void sendCode()} disabled={sendingCode || !idOk} className="inline-flex h-12 shrink-0 items-center gap-1 rounded-xl border border-primary-200 bg-primary-50 px-3 text-xs font-medium text-primary-600 disabled:opacity-50">{sendingCode ? <Loader2 size={14} className="animate-spin"/> : <Send size={14}/>}{codeSent ? T('已发送','Sent') : T('发送验证码','Send code')}</button></div></div>}
      {mode !== 'login' && <div><label htmlFor="confirm-password" className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-gray-200">{mode === 'register' ? T('确认密码','Confirm password') : T('确认新密码','Confirm new password')}</label><div className="relative"><ShieldCheck size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/><input id="confirm-password" type={showPwd ? 'text' : 'password'} value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} placeholder={mode === 'register' ? T('确认密码','Confirm password') : T('确认新密码','Confirm new password')} className={input}/><span className="absolute right-3.5 top-1/2 -translate-y-1/2"><ValidationIcon valid={confirmPwd ? password === confirmPwd : null}/></span></div></div>}
      {mode === 'login' && loginMode === 'password' && <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-4"><label className="flex min-h-8 items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={remember} onChange={e => rememberChange(e.target.checked)}/>{T('记住账号','Remember account')}</label><label className="flex min-h-8 items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={autoLogin} disabled={!remember} onChange={e => setAutoLogin(e.target.checked)}/>{T('自动登录','Auto sign in')}</label></div><button type="button" onClick={() => go('forgot')} className="min-h-8 text-sm font-medium text-primary-600">{T('忘记密码？','Forgot password?')}</button></div>}
      <button type="submit" disabled={loading} className="mt-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary-500 text-sm font-semibold text-white transition-[background-color,transform] hover:-translate-y-px hover:bg-primary-600 active:scale-[0.98] disabled:opacity-60">{loading && <Loader2 size={17} className="animate-spin"/>}{mode === 'login' ? T('登录','Sign in') : mode === 'register' ? T('注册','Sign up') : T('重置密码','Reset password')}</button>
    </form><p className="mt-7 text-center text-xs text-gray-400">v{pkg.version}</p>
  </section></main>
}
