import { useState, useEffect, useCallback } from 'react'
import { Mail, Lock, ShieldCheck, Eye, EyeOff, Loader2, Check, X, Send, ArrowLeft, Smartphone } from 'lucide-react'
import { useStore } from '@/store'
import { useLanguage } from '@/i18n/LanguageContext'
import { friendlyError } from '@/utils/errorMessages'
import pkg from '../../package.json'
import logoUrl from '../../resources/icon.ico?url'

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
  const [registerChannel, setRegisterChannel] = useState<'phone' | 'email'>('email')
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
  const changeRegisterChannel = (next: 'phone' | 'email') => { setRegisterChannel(next); setIdentifier(''); setError(''); clearCode() }
  const onIdentifier = (value: string) => { setIdentifier(value); clearCode() }
  const type = validEmail(identifier.trim()) ? 'email' : validPhone(identifier.trim()) ? 'phone' : 'invalid'
  const channel = loginMode === 'phoneCode' ? 'phone' : loginMode === 'emailCode' ? 'email' : undefined
  const activeChannel = mode === 'register' ? registerChannel : channel
  const idOk = identifier.trim() ? (activeChannel ? type === activeChannel : type !== 'invalid') : null
  const showCode = (mode === 'login' && loginMode !== 'password') || mode !== 'login'
  const showPassword = (mode === 'login' && loginMode === 'password') || mode !== 'login'
  const idLabel = mode === 'register' ? T('账号', 'Account') : activeChannel === 'phone' ? T('手机号', 'Phone number') : activeChannel === 'email' ? T('邮箱', 'Email') : T('账号', 'Account')
  const idPlaceholder = activeChannel === 'phone' ? T('请输入手机号', 'Enter your phone number') : activeChannel === 'email' ? T('请输入邮箱', 'Enter your email') : T('邮箱或手机号', 'Email or phone number')
  const idError = () => { setError(activeChannel === 'phone' ? T('请输入有效的手机号', 'Enter a valid phone number') : activeChannel === 'email' ? T('请输入有效的邮箱', 'Enter a valid email') : T('请输入有效的邮箱或手机号', 'Enter a valid email or phone number')); return false }
  const input = 'h-12 w-full rounded-[10px] border border-[#e4e7ec] bg-[#f9fafb] px-11 pr-10 text-sm text-[#101828] outline-none transition-[border-color] placeholder:text-[#667085] focus:border-[#d0d5dd] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'

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

  return <main className="login-shell grid min-h-screen bg-white dark:bg-[#0a0a0b] lg:grid-cols-[minmax(0,1fr)_minmax(500px,600px)]"><aside className="relative hidden min-h-screen overflow-hidden border-r border-[#e4e7ec] bg-white dark:border-[#27272b] dark:bg-[#0a0a0b] lg:flex lg:items-center lg:justify-center"><div className="text-center"><div className="relative mx-auto mb-7 flex h-44 w-44 items-center justify-center"><span aria-hidden="true" className="pointer-events-none absolute -inset-3 rounded-[42px] border-2 border-transparent border-t-[#d4a72c] border-r-[#d4a72c]/40 motion-safe:animate-[spin_8s_linear_infinite]"/><span aria-hidden="true" className="pointer-events-none absolute -inset-1 rounded-[40px] border border-[#d4a72c]/30 motion-safe:animate-[pulse_3s_ease-in-out_infinite]"/><div className="relative flex h-40 w-40 items-center justify-center rounded-[36px] border border-[#e4e7ec] bg-[#f7f8fa] dark:border-[#27272b] dark:bg-[#161618]"><img src={logoUrl} alt="雷霆记账标志" className="h-32 w-32 object-contain" /></div></div><h2 className="text-3xl font-semibold tracking-tight text-[#101828] dark:text-[#ededef]">雷霆记账</h2><p className="mt-3 text-base text-[#475467] dark:text-[#a0a0a6]">{T('简单记录每一笔，清晰管理每一天', 'Track every expense, manage every day')}</p></div></aside><section aria-labelledby="login-title" className="relative flex min-h-screen w-full items-center justify-center bg-white px-6 py-10 dark:bg-[#0a0a0b]"><div className="relative w-full max-w-[450px] p-[30px] font-sans">
    <div className="absolute right-5 top-5 flex overflow-hidden rounded-lg border border-[#e4e7ec] text-xs dark:border-gray-700"><button type="button" onClick={() => setLanguage('zh')} className={`min-h-8 px-2.5 ${language === 'zh' ? 'bg-[#2563eb] text-white' : 'text-[#667085] hover:bg-[#eff4ff]'}`}>中</button><button type="button" onClick={() => setLanguage('en')} className={`min-h-8 px-2.5 ${language === 'en' ? 'bg-[#2563eb] text-white' : 'text-[#667085] hover:bg-[#eff4ff]'}`}>EN</button></div>
    <h1 id="login-title" className="sr-only">雷霆记账</h1>
    <span className="sr-only">账号密码</span>
    {mode === 'forgot' && <button type="button" onClick={() => go('login')} className="mb-3 inline-flex min-h-8 items-center gap-1 text-sm text-gray-500 hover:text-[#2563eb]"><ArrowLeft size={16}/>{T('返回登录', 'Back to sign in')}</button>}
    {mode === 'login' && loginMode !== 'password' && <div className="mb-3 flex items-center justify-between text-sm"><span className="font-semibold text-[#101828] dark:text-gray-100">{channel === 'phone' ? T('手机号验证码登录', 'Phone code sign in') : T('邮箱验证码登录', 'Email code sign in')}</span><button type="button" onClick={() => changeLoginMode('password')} className="inline-flex min-h-8 items-center gap-1 text-[#2563eb] hover:text-[#1d4ed8]"><ArrowLeft size={14}/>{T('返回账号密码登录', 'Back to password sign in')}</button></div>}
    {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600">{error}</div>}
    <form className="flex flex-col gap-[10px]" onSubmit={e => { e.preventDefault(); void submit() }} noValidate>
      {mode === 'register' && <div className="mb-1 flex rounded-[10px] border border-[#e4e7ec] bg-[#f9fafb] p-1"><button type="button" onClick={() => changeRegisterChannel('phone')} className={`min-h-9 flex-1 rounded-lg text-sm font-medium ${registerChannel === 'phone' ? 'bg-white text-[#2563eb] shadow-sm' : 'text-[#667085]'}`}>{T('手机号注册', 'Phone')}</button><button type="button" onClick={() => changeRegisterChannel('email')} className={`min-h-9 flex-1 rounded-lg text-sm font-medium ${registerChannel === 'email' ? 'bg-white text-[#2563eb] shadow-sm' : 'text-[#667085]'}`}>{T('邮箱注册', 'Email')}</button></div>}
      <div><label htmlFor="login-identifier" className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-gray-200">{idLabel}</label><div className="relative">{type === 'phone' || activeChannel === 'phone' ? <Smartphone size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/> : <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/>}<input id="login-identifier" aria-invalid={idOk === false} type="text" autoComplete={activeChannel === 'phone' ? 'tel' : 'username'} value={identifier} onChange={e => onIdentifier(e.target.value)} placeholder={idPlaceholder} className={input}/><span className="absolute right-3.5 top-1/2 -translate-y-1/2"><ValidationIcon valid={idOk}/></span></div></div>
      {showPassword && <div><label htmlFor="login-password" className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-gray-200">{mode === 'register' ? T('设置密码','Set password') : mode === 'forgot' ? T('新密码','New password') : T('密码','Password')}</label><div className="relative"><Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/><input id="login-password" type={showPwd ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'register' ? T('设置密码','Set password') : mode === 'forgot' ? T('新密码','New password') : T('请输入密码','Enter password')} className={input}/><span className="absolute right-10 top-1/2 -translate-y-1/2"><ValidationIcon valid={password ? (mode === 'login' ? validPassword(password) : strongPassword(password)) : null}/></span><button type="button" aria-label={showPwd ? T('隐藏密码','Hide password') : T('显示密码','Show password')} onClick={() => setShowPwd(v => !v)} className="absolute right-2.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100">{showPwd ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></div>}
      {showCode && <div><label htmlFor="verification-code" className="mb-1.5 block text-sm font-semibold text-[#101828] dark:text-gray-200">{T('验证码','Verification code')}</label><div className="flex h-12 overflow-hidden rounded-[10px] border border-[#e4e7ec] bg-[#f9fafb]"><input id="verification-code" type="text" inputMode="numeric" value={verifyCode} onChange={e => setVerifyCode(e.target.value)} placeholder={T('请输入验证码','Enter code')} className="min-w-0 flex-1 border-0 bg-transparent px-3 text-sm text-[#101828] outline-none placeholder:text-[#667085]"/><button type="button" onClick={() => void sendCode()} disabled={sendingCode || !idOk} className={`inline-flex h-full shrink-0 items-center gap-1 border-0 bg-transparent px-3 text-xs font-medium ${idOk ? 'text-[#2563eb] hover:text-[#1d4ed8]' : 'cursor-not-allowed text-[#98a2b3]'}`}>{sendingCode ? <Loader2 size={14} className="animate-spin"/> : <Send size={14}/>}{codeSent ? T('已发送','Sent') : T('获取验证码','Get code')}</button></div></div>}
      {mode !== 'login' && <div><label htmlFor="confirm-password" className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-gray-200">{mode === 'register' ? T('确认密码','Confirm password') : T('确认新密码','Confirm new password')}</label><div className="relative"><ShieldCheck size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/><input id="confirm-password" type={showPwd ? 'text' : 'password'} value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} placeholder={mode === 'register' ? T('确认密码','Confirm password') : T('确认新密码','Confirm new password')} className={input}/><span className="absolute right-3.5 top-1/2 -translate-y-1/2"><ValidationIcon valid={confirmPwd ? password === confirmPwd : null}/></span></div></div>}
      {mode === 'login' && loginMode === 'password' && <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-x-4 gap-y-1"><label className="flex min-h-8 items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={remember} onChange={e => rememberChange(e.target.checked)}/>{T('记住账号','Remember me')}</label><label className="flex min-h-8 items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={autoLogin} disabled={!remember} onChange={e => setAutoLogin(e.target.checked)}/>{T('自动登录','Auto sign in')}</label></div><button type="button" onClick={() => go('forgot')} className="min-h-8 text-sm font-medium text-primary-600">{T('忘记密码？','Forgot password?')}</button></div>}
      <button type="submit" disabled={loading} className="mt-[20px] inline-flex h-[50px] w-full items-center justify-center gap-2 rounded-[10px] border-0 bg-[#2563eb] text-[15px] font-medium text-white transition hover:bg-[#1d4ed8] active:scale-[0.98] disabled:opacity-60">{loading && <Loader2 size={17} className="animate-spin"/>}{mode === 'login' ? T('登录','Sign In') : mode === 'register' ? T('注册','Sign Up') : T('重置密码','Reset password')}</button>
    </form>
    <p className="my-5 text-center text-sm text-black dark:text-gray-200">{mode === 'login' ? T('还没有账号？','Don\'t have an account?') : T('已有账号？','Already have an account?')} <button type="button" className="ml-1 text-primary-600" onClick={() => go(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? T('注册','Sign Up') : T('登录','Sign In')}</button></p>
    {mode === 'login' && <><div className="my-3 flex items-center gap-3 text-sm text-gray-500"><span className="h-px flex-1 bg-gray-200"/><span>{T('其他登录方式','Other sign-in methods')}</span><span className="h-px flex-1 bg-gray-200"/></div><div className="flex gap-[10px]"><button type="button" onClick={() => changeLoginMode('phoneCode')} className="mt-2 flex h-[50px] flex-1 items-center justify-center gap-2 rounded-[10px] border border-[#e4e7ec] bg-white text-sm font-medium text-[#101828] hover:border-[#2563eb]"><Smartphone size={18}/>{T('手机验证码','Phone code')}</button><button type="button" onClick={() => changeLoginMode('emailCode')} className="mt-2 flex h-[50px] flex-1 items-center justify-center gap-2 rounded-[10px] border border-[#e4e7ec] bg-white text-sm font-medium text-[#101828] hover:border-[#2563eb]"><Mail size={18}/>{T('邮箱验证码','Email code')}</button></div></>}
    <p className="mt-5 text-center text-xs text-gray-400">v{pkg.version}</p>
  </div></section></main>
}
