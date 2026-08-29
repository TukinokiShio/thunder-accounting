import { useState, useEffect, useCallback } from 'react'
import { Mail, Lock, ShieldCheck, Eye, EyeOff, Loader2, Check, X, Send, ArrowLeft, Smartphone, Sun, Moon } from 'lucide-react'
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
  const { language } = useLanguage()
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
  const [codeExpiresAt, setCodeExpiresAt] = useState<number | null>(null)
  const [remember, setRemember] = useState(true)
  const [autoLogin, setAutoLogin] = useState(false)
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [codeSent, setCodeSent] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem('thunder_theme') === 'dark' ? 'dark' : 'light')
  useEffect(() => { window.electronAPI.loadCredentials().then(c => { setRemember(c.rememberAccount); setAutoLogin(c.autoLogin); if (c.rememberAccount) setIdentifier(c.identifier) }) }, [])
  useEffect(() => { localStorage.setItem('thunder_theme', theme); document.querySelector('.login-shell')?.classList.toggle('dark', theme === 'dark') }, [theme])
  const clearCode = useCallback(() => { setVerifyCode(''); setVerificationId(''); setCodeSent(false); setCodeExpiresAt(null) }, [])
  const clear = useCallback(() => { setPassword(''); setConfirmPwd(''); clearCode() }, [clearCode])
  const go = (next: Mode) => { setMode(next); setIdentifier(''); clear() }
  const changeLoginMode = (next: LoginMode) => { setLoginMode(next); setIdentifier(''); setPassword(''); clearCode() }
  const changeRegisterChannel = (next: 'phone' | 'email') => { setRegisterChannel(next); setIdentifier(''); clearCode() }
  const onIdentifier = (value: string) => { setIdentifier(value); clearCode() }
  const type = validEmail(identifier.trim()) ? 'email' : validPhone(identifier.trim()) ? 'phone' : 'invalid'
  const channel = loginMode === 'phoneCode' ? 'phone' : loginMode === 'emailCode' ? 'email' : undefined
  const activeChannel = mode === 'register' ? registerChannel : channel
  const idOk = identifier.trim() ? (activeChannel ? type === activeChannel : type !== 'invalid') : null
  const showCode = (mode === 'login' && loginMode !== 'password') || mode !== 'login'
  const showPassword = (mode === 'login' && loginMode === 'password') || mode !== 'login'
  const idLabel = mode === 'register' ? T('账号', 'Account') : activeChannel === 'phone' ? T('手机号', 'Phone number') : activeChannel === 'email' ? T('邮箱', 'Email') : T('账号', 'Account')
  const idPlaceholder = activeChannel === 'phone' ? T('请输入手机号', 'Enter your phone number') : activeChannel === 'email' ? T('请输入邮箱', 'Enter your email') : T('邮箱或手机号', 'Email or phone number')
  const notifyError = (message: string) => { addToast('error', message); return false }
  const idError = () => notifyError(activeChannel === 'phone' ? T('请输入有效的手机号', 'Enter a valid phone number') : activeChannel === 'email' ? T('请输入有效的邮箱', 'Enter a valid email') : T('请输入有效的邮箱或手机号', 'Enter a valid email or phone number'))
  const authErrorText = (e: unknown) => {
    const raw = e instanceof Error ? e.message : String(e)
    if (/account_not_found|user_not_found|账号不存在|尚未注册/i.test(raw)) {
      return activeChannel === 'phone' ? T('该手机号尚未注册', 'This phone number is not registered') : activeChannel === 'email' ? T('该邮箱尚未注册', 'This email is not registered') : T('该账号尚未注册', 'This account is not registered')
    }
    return friendlyError(e, lang)
  }
  const input = 'login-control h-12 w-full rounded-[10px] border px-11 pr-10 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-[#98a2b3]'

  async function sendCode() {
    if (!idOk) return idError()
    setSendingCode(true)
    // Login and recovery must never issue a code for an unregistered identity; registration is the only ANY flow.
    try { const r = await window.electronAPI.sendCode(identifier.trim(), mode !== 'register'); const serverExpiry = r.expiresIn > 0 ? r.expiresIn : 600; const expirySeconds = Math.min(serverExpiry, 600); setVerificationId(r.verificationId || ''); setCodeSent(true); setCodeExpiresAt(Date.now() + expirySeconds * 1000); addToast('success', r.type === 'phone' ? T(`验证码已发送到手机 ${r.target}，10分钟内有效`, `Code sent to phone ${r.target}; valid for 10 minutes`) : T(`验证码已发送到邮箱 ${r.target}，10分钟内有效`, `Code sent to email ${r.target}; valid for 10 minutes`)) }
    catch (e) { addToast('error', authErrorText(e)) } finally { setSendingCode(false) }
  }
  async function doLogin() {
    if (!idOk) return idError()
    if (loginMode === 'password' && !validPassword(password)) { notifyError(T('密码至少 6 位', 'Password must be at least 6 characters')); return }
    if (loginMode !== 'password' && (!codeSent || !verificationId)) { notifyError(T('请先发送验证码', 'Send a verification code first')); return }
    if (loginMode !== 'password' && !verifyCode.trim()) { notifyError(T('请输入验证码', 'Enter verification code')); return }
    if (loginMode !== 'password' && codeExpiresAt !== null && Date.now() >= codeExpiresAt) { notifyError(T('验证码已过期，请重新获取', 'Verification code expired. Request a new code.')); clearCode(); return }
    setLoading(true)
    try { const r = loginMode === 'password' ? await window.electronAPI.login(identifier.trim(), password) : await window.electronAPI.loginWithCode(identifier.trim(), verifyCode.trim(), verificationId); await window.electronAPI.saveCredentials(identifier.trim(), remember, autoLogin); setUser(r.user); addToast('success', T('欢迎回来！', 'Welcome back!')) }
    catch (e) { addToast('error', authErrorText(e)) } finally { setLoading(false) }
  }
  async function doRegister() {
    if (!idOk) return idError()
    if (!codeSent || !verificationId) { notifyError(T('请先发送验证码', 'Send a verification code first')); return }
    if (!verifyCode.trim()) { notifyError(T('请输入验证码', 'Enter verification code')); return }
    if (codeExpiresAt !== null && Date.now() >= codeExpiresAt) { notifyError(T('验证码已过期，请重新获取', 'Verification code expired. Request a new code.')); clearCode(); return }
    if (!validPassword(password)) { notifyError(T('密码至少 6 位', 'Password must be at least 6 characters')); return }
    if (!strongPassword(password)) { notifyError(T('密码强度不够', 'Password is too weak')); return }
    if (password !== confirmPwd) { notifyError(T('两次密码不一致', 'Passwords do not match')); return }
    setLoading(true)
    try { const r = await window.electronAPI.register(identifier.trim(), password, verifyCode.trim(), verificationId); await window.electronAPI.saveCredentials(identifier.trim(), remember, autoLogin); setUser(r.user || r); addToast('success', T('注册成功！', 'Registered!')) }
    catch (e) { addToast('error', authErrorText(e)) } finally { setLoading(false) }
  }
  async function doReset() {
    if (!idOk) return idError()
    if (!codeSent || !verificationId) { notifyError(T('请先发送验证码', 'Send a verification code first')); return }
    if (!verifyCode.trim()) { notifyError(T('请输入验证码', 'Enter verification code')); return }
    if (codeExpiresAt !== null && Date.now() >= codeExpiresAt) { notifyError(T('验证码已过期，请重新获取', 'Verification code expired. Request a new code.')); clearCode(); return }
    if (!validPassword(password)) { notifyError(T('密码至少 6 位', 'Password must be at least 6 characters')); return }
    if (!strongPassword(password)) { notifyError(T('密码强度不够', 'Password is too weak')); return }
    if (password !== confirmPwd) { notifyError(T('两次密码不一致', 'Passwords do not match')); return }
    setLoading(true)
    try { await window.electronAPI.resetPassword(identifier.trim(), password, verifyCode.trim(), verificationId); addToast('success', T('密码已重置，请登录', 'Password reset. Please sign in.')); go('login') }
    catch (e) { addToast('error', authErrorText(e)) } finally { setLoading(false) }
  }
  const submit = () => mode === 'login' ? doLogin() : mode === 'register' ? doRegister() : doReset()
  const rememberChange = (value: boolean) => { setRemember(value); if (!value) { setAutoLogin(false); void window.electronAPI.saveCredentials('', false, false) } }

  return <main className="round3-login login-shell min-h-screen"><div className="login-layout mx-auto grid min-h-screen max-w-[1440px] lg:grid-cols-[minmax(560px,1.1fr)_minmax(420px,0.9fr)]"><aside className="login-hero relative hidden overflow-hidden p-12 lg:flex lg:flex-col lg:justify-between"><div className="login-orb login-orb-one" aria-hidden="true"/><div className="login-orb login-orb-two" aria-hidden="true"/><div className="login-product-nav relative z-10"><div className="flex items-center gap-3"><div className="login-brand-mark"><img src={logoUrl} alt="" className="h-8 w-8 object-contain" /></div><span className="text-sm font-semibold tracking-[0.12em]">雷霆记账</span></div><span className="login-nav-active">{T('总览', 'Overview')}</span><span>{T('账单', 'Bills')}</span><span>{T('统计', 'Stats')}</span><span>{T('分类管理', 'Categories')}</span><small>v{pkg.version} · {T('个人账本', 'Personal ledger')}</small></div><div className="relative z-10 max-w-[680px] pb-10"><span className="login-kicker">YOUR DAILY LEDGER</span><h2 className="login-hero-title">{T('今天的账，', 'Today’s ledger,')}<br/><em>{T('一眼就清楚。', 'clear at a glance.')}</em></h2><p className="mt-5 max-w-[450px] text-base leading-7">{T('登录后即可继续查看收支、账单和本月统计。', 'Continue reviewing spending, bills and this month’s numbers.')}</p><div className="login-ledger-preview" aria-label={T('雷霆记账总览预览', 'Thunder Accounting overview preview')}><div className="login-preview-top"><b>{T('总览', 'Overview')}</b><span>2026年8月　⌄</span><i>＋ {T('记一笔', 'Add')}</i></div><div className="login-preview-metrics"><div><small>{T('今日支出', 'Today')}</small><strong>¥ 86.00</strong><em>2 {T('笔', 'items')}</em></div><div><small>{T('本月支出', 'This month')}</small><strong>¥ 3,280</strong><em>↓ 8.4%</em></div><div><small>{T('本月结余', 'Balance')}</small><strong>¥ 5,320</strong><em>{T('记录良好', 'On track')}</em></div></div><div className="login-preview-body"><div><b>{T('本月支出趋势', 'Spending trend')}</b><svg viewBox="0 0 420 100" role="img" aria-label={T('本月支出趋势', 'Monthly spending trend')}><path d="M4 80 C45 72 53 42 92 58 S143 89 180 54 S230 68 267 36 S325 55 370 20 S399 32 416 16"/></svg></div><div><b>{T('最近记录', 'Recent')}</b><span>早餐 <strong>- ¥28.00</strong></span><span>地铁 <strong>- ¥6.00</strong></span><span>工资 <strong className="income">+ ¥8,600</strong></span></div></div></div></div><p className="relative z-10 text-xs">© 2025 Thunder Accounting</p></aside><section aria-labelledby="login-title" className="login-content relative flex min-h-screen w-full items-center justify-center px-5 py-10 sm:px-10"><div className="login-panel relative w-full max-w-[480px] p-7 sm:p-10">
    <div className="mb-8 pr-16"><div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-[#fff8e6] sm:hidden"><img src={logoUrl} alt="" className="h-8 w-8 object-contain" /></div><p className="mb-2 text-sm font-medium text-[#d4a72c]">{mode === 'register' ? T('开始建立你的账本', 'Create your workspace') : mode === 'forgot' ? T('找回访问权限', 'Recover access') : T('欢迎回来', 'Welcome back')}</p><h1 id="login-title" aria-label="雷霆记账" className="text-[30px] font-semibold tracking-[-0.035em] text-[#101828] dark:text-[#ededef]">{mode === 'register' ? T('创建账号', 'Create account') : mode === 'forgot' ? T('重置密码', 'Reset password') : T('登录雷霆记账', 'Sign in to Thunder')}</h1><p className="mt-2 text-sm leading-6 text-[#667085]">{mode === 'register' ? T('注册后即可同步和管理你的日常收支。', 'Sync and manage your daily spending in one place.') : mode === 'forgot' ? T('验证身份后设置一个新密码。', 'Verify your identity and choose a new password.') : T('继续记录你的每一天。', 'Pick up where you left off.')}</p></div>
    <span className="sr-only">雷霆记账</span>
    <span className="sr-only">账号密码</span>
    {mode === 'forgot' && <button type="button" onClick={() => go('login')} className="mb-3 inline-flex min-h-8 items-center gap-1 text-sm text-gray-500 hover:text-[var(--accent)]"><ArrowLeft size={16}/>{T('返回登录', 'Back to sign in')}</button>}
    {mode === 'login' && loginMode !== 'password' && <div className="mb-3 flex items-center justify-between text-sm"><span className="font-semibold text-[#101828] dark:text-gray-100">{channel === 'phone' ? T('手机号验证码登录', 'Phone code sign in') : T('邮箱验证码登录', 'Email code sign in')}</span><button type="button" onClick={() => changeLoginMode('password')} className="inline-flex min-h-8 items-center gap-1 text-[var(--accent)] hover:text-[var(--accent-h)]"><ArrowLeft size={14}/>{T('返回账号密码登录', 'Back to password sign in')}</button></div>}
    <form className="flex flex-col gap-[10px]" onSubmit={e => { e.preventDefault(); void submit() }} noValidate>
      {mode === 'register' && <div className="mb-1 flex rounded-[10px] border border-[#e4e7ec] bg-[#f9fafb] p-1"><button type="button" onClick={() => changeRegisterChannel('phone')} className={`min-h-9 flex-1 rounded-lg text-sm font-medium ${registerChannel === 'phone' ? 'bg-white text-[var(--accent)] shadow-sm' : 'text-[#667085]'}`}>{T('手机号注册', 'Phone')}</button><button type="button" onClick={() => changeRegisterChannel('email')} className={`min-h-9 flex-1 rounded-lg text-sm font-medium ${registerChannel === 'email' ? 'bg-white text-[var(--accent)] shadow-sm' : 'text-[#667085]'}`}>{T('邮箱注册', 'Email')}</button></div>}
      <div><label htmlFor="login-identifier" className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-gray-200">{idLabel}</label><div className="relative">{activeChannel === 'phone' ? <Smartphone size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/> : <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/>}<input id="login-identifier" aria-invalid={idOk === false} type="text" autoComplete={activeChannel === 'phone' ? 'tel' : 'username'} value={identifier} onChange={e => onIdentifier(e.target.value)} placeholder={idPlaceholder} className={input}/><span className="absolute right-3.5 top-1/2 -translate-y-1/2"><ValidationIcon valid={idOk}/></span></div></div>
      {showPassword && <div><label htmlFor="login-password" className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-gray-200">{mode === 'register' ? T('设置密码','Set password') : mode === 'forgot' ? T('新密码','New password') : T('密码','Password')}</label><div className="relative"><Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/><input id="login-password" type={showPwd ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'register' ? T('设置密码','Set password') : mode === 'forgot' ? T('新密码','New password') : T('请输入密码','Enter password')} className={input}/><span className="absolute right-10 top-1/2 -translate-y-1/2"><ValidationIcon valid={password ? (mode === 'login' ? validPassword(password) : strongPassword(password)) : null}/></span><button type="button" aria-label={showPwd ? T('隐藏密码','Hide password') : T('显示密码','Show password')} onClick={() => setShowPwd(v => !v)} className="absolute right-2.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100">{showPwd ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></div>}
      {showCode && <div><label htmlFor="verification-code" className="mb-1.5 block text-sm font-semibold text-[#101828] dark:text-gray-200">{T('验证码','Verification code')}</label><div className="flex h-12 overflow-hidden rounded-[10px] border border-[#e4e7ec] bg-[#f9fafb]"><input id="verification-code" type="text" inputMode="numeric" value={verifyCode} onChange={e => setVerifyCode(e.target.value)} placeholder={T('请输入验证码','Enter code')} className="min-w-0 flex-1 border-0 bg-transparent px-3 text-sm text-[#101828] outline-none placeholder:text-[#667085]"/><button type="button" onClick={() => void sendCode()} disabled={sendingCode || !idOk} className={`inline-flex h-full shrink-0 items-center gap-1 border-0 bg-transparent px-3 text-xs font-medium ${idOk ? 'text-[var(--accent)] hover:text-[var(--accent-h)]' : 'cursor-not-allowed text-[#98a2b3]'}`}>{sendingCode ? <Loader2 size={14} className="animate-spin"/> : <Send size={14}/>}{codeSent ? T('已发送','Sent') : T('获取验证码','Get code')}</button></div></div>}
      {mode !== 'login' && <div><label htmlFor="confirm-password" className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-gray-200">{mode === 'register' ? T('确认密码','Confirm password') : T('确认新密码','Confirm new password')}</label><div className="relative"><ShieldCheck size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/><input id="confirm-password" type={showPwd ? 'text' : 'password'} value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} placeholder={mode === 'register' ? T('确认密码','Confirm password') : T('确认新密码','Confirm new password')} className={input}/><span className="absolute right-3.5 top-1/2 -translate-y-1/2"><ValidationIcon valid={confirmPwd ? password === confirmPwd : null}/></span></div></div>}
      {mode === 'login' && loginMode === 'password' && <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-x-4 gap-y-1"><label className="flex min-h-8 items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={remember} onChange={e => rememberChange(e.target.checked)}/>{T('记住账号','Remember me')}</label><label className="flex min-h-8 items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={autoLogin} disabled={!remember} onChange={e => setAutoLogin(e.target.checked)}/>{T('自动登录','Auto sign in')}</label></div></div>}
      <button type="submit" disabled={loading} className="mt-[20px] inline-flex h-[50px] w-full items-center justify-center gap-2 rounded-[10px] border-0 bg-[var(--accent)] text-[15px] font-medium text-white transition hover:bg-[var(--accent-h)] active:scale-[0.98] disabled:opacity-60">{loading && <Loader2 size={17} className="animate-spin"/>}{mode === 'login' ? T('登录','Sign In') : mode === 'register' ? T('注册','Sign Up') : T('重置密码','Reset password')}</button>
    </form>
    <p className="my-5 text-center text-sm text-black dark:text-gray-200">{mode === 'login' ? <><button type="button" className="min-h-8 text-[var(--accent)]" onClick={() => go('forgot')}>{T('忘记密码？','Forgot password?')}</button><span aria-hidden="true" className="mx-2 text-gray-400">·</span><button type="button" className="min-h-8 text-[var(--accent)]" onClick={() => go('register')}>{T('创建账号','Create account')}</button></> : <>{T('已有账号？','Already have an account?')} <button type="button" className="ml-1 min-h-8 text-[var(--accent)]" onClick={() => go('login')}>{T('登录','Sign In')}</button></>}</p>
    {mode === 'login' && <><div className="my-3 flex items-center gap-3 text-sm text-gray-500"><span className="h-px flex-1 bg-gray-200"/><span>{T('其他登录方式','Other sign-in methods')}</span><span className="h-px flex-1 bg-gray-200"/></div><div className="flex gap-[10px]"><button type="button" onClick={() => changeLoginMode('phoneCode')} className="mt-2 flex h-[50px] flex-1 items-center justify-center gap-2 rounded-[10px] border border-[#e4e7ec] bg-white text-sm font-medium text-[#101828] hover:border-[var(--accent)]"><Smartphone size={18}/>{T('手机验证码','Phone code')}</button><button type="button" onClick={() => changeLoginMode('emailCode')} className="mt-2 flex h-[50px] flex-1 items-center justify-center gap-2 rounded-[10px] border border-[#e4e7ec] bg-white text-sm font-medium text-[#101828] hover:border-[var(--accent)]"><Mail size={18}/>{T('邮箱验证码','Email code')}</button></div></>}
    <p className="mt-5 text-center text-xs text-gray-400">v{pkg.version}</p>
    </div></section></div></main>
}
