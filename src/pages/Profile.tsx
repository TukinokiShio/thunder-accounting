/**
 * 个人中心页面 — 重构版 v2
 *
 * 架构：
 *   - 5 个独立子组件：AccountInfo / ChangePasswordForm / EmailBinding / PhoneBinding / DangerZone
 *   - 统一使用 friendlyError() 处理所有后端错误
 *   - 按钮全部带图标 + Tailwind 样式（不再用裸文字）
 *   - 验证渠道选择：当只有 1 个渠道时直接发送，不显示选择器
 *
 * 借鉴来源：
 *   - shadcn-admin Settings 模块布局（左侧导航+右侧内容）
 *   - Origin UI Danger Zone 模式（红边警示+输入确认）
 *   - react-hook-form 验证思路（手动实现，无第三方依赖）
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useStore } from '@/store'
import { useLanguage } from '@/i18n/LanguageContext'
import { friendlyError } from '@/utils/errorMessages'
import {
  User, Lock, Link, BarChart3, AlertTriangle, AlertCircle,
  Copy, Check, Eye, EyeOff, Loader2, Trash2,
  Mail, Phone, Shield, Key, LogOut, ChevronDown, ChevronRight, Send, X
} from 'lucide-react'

type Tab = 'info' | 'security' | 'binding' | 'stats' | 'danger'

interface AccountInfo {
  accountId: string
  email: string
  phone: string
  nickname?: string
}

interface UserStats {
  billCount: number
  categoryCount: number
  totalExpense: number
  totalIncome: number
}

function isInternalEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase()
  return !normalized || normalized.endsWith('@phone.tb') || normalized.endsWith('@thunder.invalid') || normalized.endsWith('@lgs.invalid')
}

function isInternalPhone(phone: string): boolean {
  const normalized = phone.replace(/\s/g, '')
  return !normalized || normalized.startsWith('+86140') || normalized.startsWith('86140') || normalized.startsWith('140')
}

function isPasswordValid(pwd: string): boolean {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[()!@#$%^&*|?><_\-]/]
  return pwd.length >= 8 && pwd.length <= 32 && classes.filter(pattern => pattern.test(pwd)).length >= 3
}

function bindingError(e: unknown, lang: Parameters<typeof friendlyError>[1]): string {
  const raw = e instanceof Error ? e.message : String(e)
  if (raw.includes('binding_mapping_pending')) {
    return lang === 'zh'
      ? 'CloudBase Auth 已完成绑定，但账号映射尚未同步。请配置 CLOUDBASE_API_KEY 后刷新重试。'
      : 'CloudBase Auth binding completed, but the account mapping is pending. Configure CLOUDBASE_API_KEY and retry.'
  }
  return friendlyError(e, lang)
}

export default function ProfilePage() {
  const { user, addToast, appLogout } = useStore()
  const { lang } = useLanguage()
  const [activeTab, setActiveTab] = useState<Tab>('info')

  // ── 账号信息 ──
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [copied, setCopied] = useState(false)
  // 云端服务可用性：null = 检测中, true = 可用, false = 未配置
  const [cloudAvailable, setCloudAvailable] = useState<boolean | null>(null)

  // ── 数据概览 ──
  const [stats, setStats] = useState<UserStats | null>(null)

  // ── 加载账号信息 ──
  const loadAccount = useCallback(async () => {
    try {
      const info = await window.electronAPI.getAccountBindings()
      setAccount(info)
    } catch { /* ignore */ }
  }, [])

  const loadStats = useCallback(async () => {
    try {
      const s = await window.electronAPI.getUserStats()
      setStats(s)
    } catch { /* ignore */ }
  }, [])

  const checkCloud = useCallback(async () => {
    try {
      const ok = await window.electronAPI.isCloudSyncEnabled()
      setCloudAvailable(ok)
    } catch {
      setCloudAvailable(false)
    }
  }, [])

  useEffect(() => {
    loadAccount()
    loadStats()
    checkCloud()
  }, [loadAccount, loadStats, checkCloud])

  // ── 派生值 ──
  const accountId = account?.accountId || user?.accountId || ''
  const visibleEmail = account?.email && !isInternalEmail(account.email) ? account.email : ''
  const nickname =
    account?.nickname ||
    user?.nickname ||
    (visibleEmail.split('@')[0] ?? '') ||
    '未知用户'
  const boundEmail = visibleEmail
  const boundPhone = account?.phone && !isInternalPhone(account.phone) ? account.phone : ''

  // ── 复制账号 ID ──
  const copyAccountId = () => {
    if (!accountId) return
    navigator.clipboard.writeText(accountId)
    setCopied(true)
    addToast('success', '已复制账号ID')
    setTimeout(() => setCopied(false), 2000)
  }

  // ── 退出登录 ──
  const handleLogout = async () => {
    await appLogout()
    addToast('info', '已退出登录')
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'info', label: '账号信息', icon: <User size={16} /> },
    { id: 'security', label: '安全设置', icon: <Lock size={16} /> },
    { id: 'binding', label: '绑定管理', icon: <Link size={16} /> },
    { id: 'stats', label: '数据概览', icon: <BarChart3 size={16} /> },
    { id: 'danger', label: '危险操作', icon: <AlertTriangle size={16} /> },
  ]

  return (
    <div className="profile-layout page-view w-full min-w-0 flex min-h-full flex-col gap-4 md:flex-row">
      {/* ── 左侧标签导航 ── */}
      <aside className="profile-nav w-full min-w-0 shrink-0 md:w-48">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">个人中心</h2>
        <nav className="space-y-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* ── 右侧内容区 ── */}
      <div className="profile-content flex-1 min-w-0 space-y-4">
        {/* 云端服务状态提示（统一在顶部展示） */}
        {cloudAvailable === false && <CloudUnavailableNotice />}

        {activeTab === 'info' && (
          <InfoTab
            nickname={nickname}
            email={boundEmail}
            accountId={accountId}
            copied={copied}
            onCopy={copyAccountId}
            onLogout={handleLogout}
          />
        )}
        {activeTab === 'security' && (
          <SecurityTab
            email={boundEmail}
            phone={boundPhone}
            cloudAvailable={cloudAvailable === true}
          />
        )}
        {activeTab === 'binding' && (
          <BindingTab
            email={boundEmail}
            phone={boundPhone}
            cloudAvailable={cloudAvailable === true}
            onChange={loadAccount}
          />
        )}
        {activeTab === 'stats' && stats && (
          <StatsTab stats={stats} />
        )}
        {activeTab === 'danger' && (
          <DangerTab
            accountId={accountId}
            email={boundEmail}
            phone={boundPhone}
            nickname={nickname}
            cloudAvailable={cloudAvailable === true}
            onDeleted={() => setTimeout(() => appLogout(), 500)}
          />
        )}
      </div>
    </div>
  )
}

/**
 * 云端服务未配置提示
 * 当 .env 缺失或 CLOUDBASE_API_KEY 无效时，Profile 顶部统一展示
 */
function CloudUnavailableNotice() {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
      <AlertCircle size={20} className="text-amber-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-amber-800">云端服务未配置</h3>
        <p className="text-xs text-amber-700 mt-1">
          当前应用未配置 CLOUDBASE_API_KEY（安装版可将 <code className="px-1 bg-amber-100 rounded">.env</code> 放在 exe 同级目录），
          云端数据库同步与账号映射暂不可用；登录态下的 Auth 绑定、注销和修改密码会走独立链路。
        </p>
        <p className="text-xs text-amber-700 mt-1">
          本地功能（账号信息查看、数据概览、退出登录）仍可正常使用。
        </p>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 子组件：账号信息
// ═════════════════════════════════════════════════════════════════

function InfoTab({
  nickname, email, accountId, copied, onCopy, onLogout
}: {
  nickname: string
  email: string
  accountId: string
  copied: boolean
  onCopy: () => void
  onLogout: () => void
}) {
  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center text-2xl font-bold text-blue-600">
          {nickname?.charAt(0).toUpperCase() || '?'}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-xl font-semibold text-gray-900 truncate">{nickname}</h3>
          <p className="text-sm text-gray-500 truncate">{email || '雷霆记账用户'}</p>
        </div>
      </div>

      <div className="bg-gray-50 rounded-xl p-4">
        <label className="text-xs text-gray-500 mb-1 block">雷霆记账账号</label>
        <div className="flex items-center gap-2">
          <code className="text-lg font-mono font-bold text-gray-800 tracking-wider flex-1">
            {accountId || '加载中...'}
          </code>
          <button
            onClick={onCopy}
            disabled={!accountId}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50 transition-colors"
            title="复制账号ID"
          >
            {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
            {copied ? '已复制' : '复制'}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          你的雷霆记账专属账号ID，可用于登录、找回账号和跨设备数据同步。
        </p>
      </div>

      <div className="flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-xl">
        <Mail size={20} className="text-gray-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500">邮箱</p>
          <p className="text-sm text-gray-800 truncate">{email || '未绑定邮箱'}</p>
        </div>
        {email && (
          <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">已绑定</span>
        )}
      </div>

      <button
        onClick={onLogout}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
      >
        <LogOut size={16} />
        退出登录
      </button>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 子组件：安全设置（修改密码）
// ═════════════════════════════════════════════════════════════════

function SecurityTab({ email, phone, cloudAvailable: _cloudAvailable }: { email: string; phone: string; cloudAvailable: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [verifyChannel, setVerifyChannel] = useState<'email' | 'phone' | null>(null)
  const [showChannelDropdown, setShowChannelDropdown] = useState(false)
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const { addToast } = useStore()
  const { lang } = useLanguage()

  // 可用渠道
  const channels: Array<{ key: 'email' | 'phone'; label: string; value: string }> = []
  if (email) channels.push({ key: 'email', label: '邮箱', value: email })
  if (phone) channels.push({ key: 'phone', label: '手机号', value: phone })

  // 点击外部关闭下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowChannelDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // 重置所有状态
  const reset = () => {
    setVerifyChannel(null)
    setCode('')
    setCodeSent(false)
    setNewPwd('')
    setConfirmPwd('')
    setExpanded(false)
  }

  // 发送验证码
  const handleSendCode = async () => {
    if (channels.length === 0) {
      addToast('error', '请先在「绑定管理」中绑定邮箱或手机号')
      return
    }
    // 只有 1 个渠道时直接发送，不显示选择器
    const target = verifyChannel || channels[0].key
    if (!channels.find(c => c.key === target)?.value) return

    setSending(true)
    try {
      await window.electronAPI.sendReauthCode(target === 'phone' ? 'phone_code' : 'email_code')
      setCodeSent(true)
      setVerifyChannel(target) // 记住用户选择（多个渠道时）
      addToast('success', `验证码已发送到${target === 'phone' ? '手机' : '邮箱'}`)
    } catch (e) {
      addToast('error', bindingError(e, lang))
    } finally {
      setSending(false)
    }
  }

  // 提交修改
  const handleSubmit = async () => {
    if (!code) {
      addToast('error', '请先发送并填写验证码')
      return
    }
    if (!isPasswordValid(newPwd)) {
      addToast('error', '新密码需为 8-32 位，并包含小写字母、大写字母、数字、特殊字符中的至少三类')
      return
    }
    if (newPwd !== confirmPwd) {
      addToast('error', '两次输入的密码不一致')
      return
    }
    setSubmitting(true)
    try {
      if (!verifyChannel) {
        addToast('error', '请选择验证方式并发送验证码')
        return
      }
      await window.electronAPI.changePassword(newPwd, code)
      addToast('success', '密码修改成功，请使用新密码重新登录')
      reset()
    } catch (e) {
      addToast('error', bindingError(e, lang))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
        <Shield size={20} className="text-blue-600" />
        安全设置
      </h2>

      {/* 修改密码卡片 */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <Key size={18} className="text-gray-400" />
            <div>
              <p className="text-sm font-medium text-gray-900">修改密码</p>
              <p className="text-xs text-gray-500">无需旧密码，验证身份后即可设置新密码</p>
            </div>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
          >
            {expanded ? '收起' : '修改'}
            <ChevronRight size={14} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </button>
        </div>

        {expanded && (
          <div className="px-4 pb-4 pt-2 space-y-3 border-t border-gray-100 bg-gray-50/50">
            {channels.length === 0 ? (
              <div className="text-sm text-amber-600 p-3 bg-amber-50 rounded-lg">
                ⚠ 请先在「绑定管理」中绑定邮箱或手机号
              </div>
            ) : (
              <>
                {/* 渠道选择（只在多个渠道时显示） */}
                {channels.length > 1 && (
                  <div ref={dropdownRef} className="relative">
                    <label className="text-xs text-gray-500 block mb-1">验证方式</label>
                    <button
                      onClick={() => setShowChannelDropdown(!showChannelDropdown)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-left flex items-center justify-between"
                    >
                      <span>
                        {verifyChannel
                          ? channels.find(c => c.key === verifyChannel)?.label
                          : '请选择验证方式'}
                      </span>
                      <ChevronDown size={14} className="text-gray-400" />
                    </button>
                    {showChannelDropdown && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                        {channels.map(c => (
                          <button
                            key={c.key}
                            onClick={() => {
                              setVerifyChannel(c.key)
                              setShowChannelDropdown(false)
                              setCodeSent(false)
                              setCode('')
                            }}
                            className="w-full px-3 py-2 text-sm text-left hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
                          >
                            {c.label} ({c.value})
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 单渠道时的明确展示 */}
                {channels.length === 1 && !verifyChannel && (
                  <div className="text-xs text-gray-600">
                    验证码将发送到 {channels[0].label}：{channels[0].value}
                  </div>
                )}

                {/* 发送验证码 */}
                <button
                  onClick={handleSendCode}
                  disabled={sending || (channels.length > 1 && !verifyChannel)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sending && <Loader2 size={14} className="animate-spin" />}
                  <Send size={14} />
                  {codeSent ? '重新发送验证码' : '发送验证码'}
                </button>

                {codeSent && (
                  <>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">验证码</label>
                      <input
                        value={code}
                        onChange={e => setCode(e.target.value)}
                        className="profile-input w-full px-3 py-2 rounded-lg text-sm"
                        placeholder="输入收到的验证码"
                        maxLength={6}
                      />
                    </div>

                    <div>
                      <label className="text-xs text-gray-500 block mb-1">
                        新密码 <span className="text-gray-400">（8-32 位，至少包含三类字符）</span>
                      </label>
                      <div className="relative">
                        <input
                          type={showPwd ? 'text' : 'password'}
                          value={newPwd}
                          onChange={e => setNewPwd(e.target.value)}
                          className="profile-input w-full px-3 py-2 pr-10 rounded-lg text-sm"
                          placeholder="输入新密码"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPwd(!showPwd)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                        >
                          {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-gray-500 block mb-1">确认新密码</label>
                      <div className="relative">
                        <input
                          type={showPwd ? 'text' : 'password'}
                          value={confirmPwd}
                          onChange={e => setConfirmPwd(e.target.value)}
                          className={`profile-input w-full px-3 py-2 pr-10 rounded-lg text-sm ${
                            confirmPwd && newPwd !== confirmPwd ? 'is-invalid' : ''
                          }`}
                          placeholder="再次输入新密码"
                        />
                      </div>
                      {confirmPwd && newPwd !== confirmPwd && (
                        <p className="text-xs text-red-500 mt-1">两次密码不一致</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSubmit}
                        disabled={submitting || !code || !newPwd || newPwd !== confirmPwd || !isPasswordValid(newPwd)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {submitting && <Loader2 size={14} className="animate-spin" />}
                        确认修改
                      </button>
                      <button
                        onClick={reset}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
                      >
                        <X size={14} />
                        取消
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* 安全提示 */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <p className="font-medium mb-1 flex items-center gap-2">
          <Shield size={14} />
          安全提示
        </p>
        <ul className="list-disc list-inside space-y-1 text-amber-700">
          <li>密码应包含字母、数字和特殊字符</li>
          <li>不要在多个平台使用相同密码</li>
          <li>如发现异常登录，请立即修改密码</li>
        </ul>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 子组件：绑定管理（邮箱 + 手机号）
// ═════════════════════════════════════════════════════════════════

function BindingTab({ email, phone, onChange, cloudAvailable: _cloudAvailable }: {
  email: string
  phone: string
  onChange: () => void | Promise<void>
  cloudAvailable?: boolean
}) {
  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
        <Link size={20} className="text-blue-600" />
        绑定管理
      </h2>
      <p className="text-sm text-gray-500">
        绑定邮箱和手机号可以增强账号安全性，用于找回密码和接收重要通知。
        {email && !phone && ' 至少需要保留一种绑定方式。'}
      </p>

      <EmailBindingCard boundEmail={email} boundPhone={phone} onChange={onChange} />
      <PhoneBindingCard boundPhone={phone} boundEmail={email} onChange={onChange} />
    </div>
  )
}

// ─── 邮箱绑定 ──────────────────────────────────────────

function EmailBindingCard({ boundEmail, boundPhone, onChange }: {
  boundEmail: string
  boundPhone: string
  onChange: () => void | Promise<void>
}) {
  const [target, setTarget] = useState('')
  const [code, setCode] = useState('')
  const [vid, setVid] = useState('')
  const [step, setStep] = useState<'idle' | 'code-sent'>('idle')
  const [sending, setSending] = useState(false)
  const [binding, setBinding] = useState(false)
  const [unbinding, setUnbinding] = useState(false)
  const [unbindCode, setUnbindCode] = useState('')
  const [unbindVid, setUnbindVid] = useState('')
  const [unbindStep, setUnbindStep] = useState<'idle' | 'code-sent'>('idle')
  const [sendingUnbind, setSendingUnbind] = useState(false)
  const { addToast } = useStore()
  const { lang } = useLanguage()

  const reset = () => { setTarget(''); setCode(''); setVid(''); setStep('idle') }

  const sendCode = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      addToast('error', '请输入正确的邮箱地址')
      return
    }
    setSending(true)
    try {
      const r = await window.electronAPI.sendBindCode(target)
      setVid(r.verificationId)
      setStep('code-sent')
      addToast('success', '验证码已发送到邮箱')
    } catch (e) {
      addToast('error', bindingError(e, lang))
    } finally {
      setSending(false)
    }
  }

  const confirmBind = async () => {
    if (!code || !vid) { addToast('error', '请输入验证码'); return }
    setBinding(true)
    try {
      await window.electronAPI.bindEmail(target, code, vid)
      addToast('success', '邮箱绑定成功')
      reset()
      await onChange()
    } catch (e) {
      addToast('error', bindingError(e, lang))
    } finally {
      setBinding(false)
    }
  }

  const sendUnbindCode = async () => {
    if (!boundEmail) return
    if (!boundPhone) {
      addToast('error', '当前只绑定一个平台，不能进行解绑操作，请先绑定另一个平台')
      return
    }
    setSendingUnbind(true)
    try {
      const r = await window.electronAPI.sendBindCode(boundEmail)
      setUnbindVid(r.verificationId)
      setUnbindStep('code-sent')
      addToast('success', '验证码已发送到邮箱')
    } catch (e) {
      addToast('error', friendlyError(e, lang))
    } finally {
      setSendingUnbind(false)
    }
  }

  const confirmUnbind = async () => {
    if (!unbindCode || !unbindVid) { addToast('error', '请输入验证码'); return }
    setUnbinding(true)
    try {
      await window.electronAPI.unbindEmail(unbindCode, unbindVid)
      addToast('success', '邮箱解绑成功')
      setUnbindCode(''); setUnbindVid(''); setUnbindStep('idle')
      await onChange()
    } catch (e) {
      addToast('error', friendlyError(e, lang))
    } finally {
      setUnbinding(false)
    }
  }

  return (
    <div className="border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Mail size={18} className="text-gray-400" />
          <div>
            <p className="text-sm font-medium text-gray-900">邮箱</p>
            <p className="text-xs text-gray-500 truncate max-w-[200px]">
              {boundEmail || '未绑定'}
            </p>
          </div>
        </div>
        {boundEmail && unbindStep === 'idle' && (
          <button
            onClick={sendUnbindCode}
            disabled={sendingUnbind}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg disabled:opacity-50"
          >
            {sendingUnbind && <Loader2 size={14} className="animate-spin" />}
            解绑
          </button>
        )}
      </div>

      {/* 解绑流程 */}
      {unbindStep === 'code-sent' && (
        <div className="mt-4 pl-11 space-y-3 bg-red-50/30 -mx-5 -mb-5 px-5 pb-5 pt-4 border-t border-red-100">
          <p className="text-xs text-red-700">验证码已发送到：{boundEmail}</p>
          <input
            value={unbindCode}
            onChange={e => setUnbindCode(e.target.value)}
            placeholder="输入验证码"
            maxLength={6}
            className="profile-input w-full px-3 py-2 rounded-lg text-sm"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={confirmUnbind}
              disabled={unbinding || !unbindCode}
              className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm disabled:opacity-50"
            >
              {unbinding && <Loader2 size={14} className="animate-spin" />}
              确认解绑邮箱
            </button>
            <button
              onClick={() => { setUnbindCode(''); setUnbindVid(''); setUnbindStep('idle') }}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              <X size={14} />
              取消
            </button>
          </div>
        </div>
      )}

      {/* 绑定新邮箱 */}
      {!boundEmail && step === 'idle' && (
        <div className="mt-4 pl-11 space-y-3">
          <input
            type="email"
            value={target}
            onChange={e => setTarget(e.target.value)}
            placeholder="输入要绑定的邮箱"
            className="profile-input w-full px-3 py-2 rounded-lg text-sm"
          />
          <button
            onClick={sendCode}
            disabled={!target || sending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50"
          >
            {sending && <Loader2 size={14} className="animate-spin" />}
            <Send size={14} />
            发送验证码
          </button>
        </div>
      )}

      {!boundEmail && step === 'code-sent' && (
        <div className="mt-4 pl-11 space-y-3 bg-blue-50/30 -mx-5 -mb-5 px-5 pb-5 pt-4 border-t border-blue-100">
          <p className="text-xs text-blue-700">验证码已发送到：{target}</p>
          <input
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="输入验证码"
            maxLength={6}
            className="profile-input w-full px-3 py-2 rounded-lg text-sm"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={confirmBind}
              disabled={binding || !code}
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50"
            >
              {binding && <Loader2 size={14} className="animate-spin" />}
              确认绑定邮箱
            </button>
            <button
              onClick={reset}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              <X size={14} />
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 手机号绑定 ──────────────────────────────────────────

function PhoneBindingCard({ boundPhone, boundEmail, onChange }: {
  boundPhone: string
  boundEmail: string
  onChange: () => void | Promise<void>
}) {
  const [target, setTarget] = useState('')
  const [code, setCode] = useState('')
  const [vid, setVid] = useState('')
  const [step, setStep] = useState<'idle' | 'code-sent'>('idle')
  const [sending, setSending] = useState(false)
  const [binding, setBinding] = useState(false)
  const [unbinding, setUnbinding] = useState(false)
  const [unbindCode, setUnbindCode] = useState('')
  const [unbindVid, setUnbindVid] = useState('')
  const [unbindStep, setUnbindStep] = useState<'idle' | 'code-sent'>('idle')
  const [sendingUnbind, setSendingUnbind] = useState(false)
  const { addToast } = useStore()
  const { lang } = useLanguage()

  const reset = () => { setTarget(''); setCode(''); setVid(''); setStep('idle') }

  const sendCode = async () => {
    if (target.length !== 11) { addToast('error', '请输入11位手机号'); return }
    setSending(true)
    try {
      const r = await window.electronAPI.sendBindCode(target)
      setVid(r.verificationId)
      setStep('code-sent')
      addToast('success', '验证码已发送到手机')
    } catch (e) {
      addToast('error', friendlyError(e, lang))
    } finally {
      setSending(false)
    }
  }

  const confirmBind = async () => {
    if (!code || !vid) { addToast('error', '请输入验证码'); return }
    setBinding(true)
    try {
      await window.electronAPI.bindPhone(target, code, vid)
      addToast('success', '手机号绑定成功')
      reset()
      await onChange()
    } catch (e) {
      addToast('error', friendlyError(e, lang))
    } finally {
      setBinding(false)
    }
  }

  const sendUnbindCode = async () => {
    if (!boundPhone) return
    if (!boundEmail) {
      addToast('error', '当前只绑定一个平台，不能进行解绑操作，请先绑定另一个平台')
      return
    }
    setSendingUnbind(true)
    try {
      const r = await window.electronAPI.sendBindCode(boundPhone)
      setUnbindVid(r.verificationId)
      setUnbindStep('code-sent')
      addToast('success', '验证码已发送到手机')
    } catch (e) {
      addToast('error', friendlyError(e, lang))
    } finally {
      setSendingUnbind(false)
    }
  }

  const confirmUnbind = async () => {
    if (!unbindCode || !unbindVid) { addToast('error', '请输入验证码'); return }
    setUnbinding(true)
    try {
      await window.electronAPI.unbindPhone(unbindCode, unbindVid)
      addToast('success', '手机号解绑成功')
      setUnbindCode(''); setUnbindVid(''); setUnbindStep('idle')
      await onChange()
    } catch (e) {
      addToast('error', friendlyError(e, lang))
    } finally {
      setUnbinding(false)
    }
  }

  return (
    <div className="border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Phone size={18} className="text-gray-400" />
          <div>
            <p className="text-sm font-medium text-gray-900">手机号</p>
            <p className="text-xs text-gray-500">{boundPhone || '未绑定'}</p>
          </div>
        </div>
        {boundPhone && unbindStep === 'idle' && (
          <button
            onClick={sendUnbindCode}
            disabled={sendingUnbind}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg disabled:opacity-50"
          >
            {sendingUnbind && <Loader2 size={14} className="animate-spin" />}
            解绑
          </button>
        )}
      </div>

      {/* 解绑流程 */}
      {unbindStep === 'code-sent' && (
        <div className="mt-4 pl-11 space-y-3 bg-red-50/30 -mx-5 -mb-5 px-5 pb-5 pt-4 border-t border-red-100">
          <p className="text-xs text-red-700">验证码已发送到：{boundPhone}</p>
          <input
            value={unbindCode}
            onChange={e => setUnbindCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="输入验证码"
            className="profile-input w-full px-3 py-2 rounded-lg text-sm"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={confirmUnbind}
              disabled={unbinding || !unbindCode}
              className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm disabled:opacity-50"
            >
              {unbinding && <Loader2 size={14} className="animate-spin" />}
              确认解绑手机号
            </button>
            <button
              onClick={() => { setUnbindCode(''); setUnbindVid(''); setUnbindStep('idle') }}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              <X size={14} />
              取消
            </button>
          </div>
        </div>
      )}

      {/* 绑定新手机号 */}
      {!boundPhone && step === 'idle' && (
        <div className="mt-4 pl-11 space-y-3">
          <input
            value={target}
            onChange={e => setTarget(e.target.value.replace(/\D/g, '').slice(0, 11))}
            placeholder="输入11位手机号"
            maxLength={11}
            className="profile-input w-full px-3 py-2 rounded-lg text-sm"
          />
          <button
            onClick={sendCode}
            disabled={target.length !== 11 || sending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50"
          >
            {sending && <Loader2 size={14} className="animate-spin" />}
            <Send size={14} />
            发送验证码
          </button>
        </div>
      )}

      {!boundPhone && step === 'code-sent' && (
        <div className="mt-4 pl-11 space-y-3 bg-blue-50/30 -mx-5 -mb-5 px-5 pb-5 pt-4 border-t border-blue-100">
          <p className="text-xs text-blue-700">验证码已发送到：{target}</p>
          <input
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="输入验证码"
            className="profile-input w-full px-3 py-2 rounded-lg text-sm"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={confirmBind}
              disabled={binding || !code}
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50"
            >
              {binding && <Loader2 size={14} className="animate-spin" />}
              确认绑定手机号
            </button>
            <button
              onClick={reset}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              <X size={14} />
              取消
            </button>
          </div>
        </div>
      )}

      {/* 安全提示：解绑后只剩一种绑定 */}
      {!boundPhone && boundEmail && (
        <p className="text-xs text-gray-400 mt-3 pl-11">
          提示：解绑邮箱后，账号将无法通过邮箱找回密码
        </p>
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 子组件：数据概览
// ═════════════════════════════════════════════════════════════════

function StatsTab({ stats }: { stats: UserStats }) {
  const net = stats.totalIncome - stats.totalExpense
  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
        <BarChart3 size={20} className="text-blue-600" />
        数据概览
      </h2>

      <div className="grid grid-cols-2 gap-4">
        <StatCard label="账单总数" value={stats.billCount} variant="blue" />
        <StatCard label="分类总数" value={stats.categoryCount} variant="green" />
        <StatCard label="累计支出" value={`¥${stats.totalExpense.toLocaleString()}`} variant="red" />
        <StatCard label="累计收入" value={`¥${stats.totalIncome.toLocaleString()}`} variant="emerald" />
      </div>

      <div className={`rounded-xl p-4 ${net >= 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
        <p className="text-xs text-gray-600 font-medium">净收支</p>
        <p className={`text-2xl font-bold mt-1 ${net >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
          ¥{net.toLocaleString()}
        </p>
        <p className="text-xs text-gray-500 mt-1">
          {net >= 0 ? '收大于支' : '支大于收'} · {stats.totalIncome >= stats.totalExpense ? '盈余' : '亏损'}
        </p>
      </div>
    </div>
  )
}

function StatCard({ label, value, variant }: {
  label: string
  value: string | number
  variant: 'blue' | 'green' | 'red' | 'emerald'
}) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600 text-blue-900',
    green: 'bg-green-50 text-green-600 text-green-900',
    red: 'bg-red-50 text-red-600 text-red-900',
    emerald: 'bg-emerald-50 text-emerald-600 text-emerald-900'
  }
  const [bg, light, dark] = colors[variant].split(' ')
  return (
    <div className={`${bg} rounded-xl p-4`}>
      <p className={`text-xs ${light} font-medium`}>{label}</p>
      <p className={`text-2xl font-bold ${dark} mt-1`}>{value}</p>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 子组件：危险操作（注销账号）
// ═════════════════════════════════════════════════════════════════

function DangerTab({
  accountId, email, phone, nickname, onDeleted, cloudAvailable: _cloudAvailable
}: {
  accountId: string
  email: string
  phone: string
  nickname: string
  onDeleted: () => void
  cloudAvailable?: boolean
}) {
  const [step, setStep] = useState<'idle' | 'code-sent'>('idle')
  const [code, setCode] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [sending, setSending] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { addToast } = useStore()
  const { lang } = useLanguage()

  // 可用注销验证渠道
  const verifyTarget = phone || email
  const verifyType = phone ? 'phone' : 'email'

  const reset = () => {
    setStep('idle')
    setCode('')
    setConfirmText('')
  }

  const sendCode = async () => {
    if (!verifyTarget) {
      addToast('error', '请先在「绑定管理」中绑定邮箱或手机号')
      return
    }
    setSending(true)
    try {
      await window.electronAPI.sendReauthCode(verifyType === 'phone' ? 'phone_code' : 'email_code')
      setStep('code-sent')
      addToast('success', `验证码已发送到${verifyType === 'phone' ? '手机' : '邮箱'}`)
    } catch (e) {
      addToast('error', friendlyError(e, lang))
    } finally {
      setSending(false)
    }
  }

  const handleDelete = async () => {
    if (confirmText !== accountId) {
      addToast('error', `请输入正确的账号ID ${accountId} 确认注销`)
      return
    }
    if (!code) { addToast('error', '请输入验证码'); return }
    setDeleting(true)
    try {
      const result = await window.electronAPI.deleteAccount(code)
      addToast('success', result.cleanupPending ? '账号已注销，云端数据正在后台清理' : '账号和云端数据已注销')
      setTimeout(onDeleted, 500)
    } catch (e) {
      addToast('error', friendlyError(e, lang))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
        <AlertTriangle size={20} className="text-red-600" />
        危险操作
      </h2>
      <p className="text-sm text-gray-500">以下操作不可逆，请谨慎操作。</p>

      {/* 注销账号 — Danger Zone 模式 */}
      <div className="border-2 border-red-200 bg-red-50/30 rounded-xl overflow-hidden">
        <div className="border-l-4 border-red-500 p-5">
          <div className="flex items-start gap-3">
            <Trash2 size={20} className="text-red-500 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-red-800">注销账号</h3>
              <p className="text-xs text-red-600 mt-1">
                注销后，您的所有账单数据、分类数据和账号信息将被永久删除且无法恢复。
                请确保已导出重要数据。
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {!verifyTarget ? (
              <div className="text-sm text-amber-600 p-3 bg-amber-50 rounded-lg">
                ⚠ 您尚未绑定任何邮箱或手机号，请先在「绑定管理」中添加联系方式才能注销。
              </div>
            ) : step === 'idle' ? (
              <button
                onClick={sendCode}
                disabled={sending}
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm disabled:opacity-50"
              >
                {sending && <Loader2 size={14} className="animate-spin" />}
                <Send size={14} />
                发送验证码到 {verifyType === 'phone' ? '手机' : '邮箱'}
              </button>
            ) : (
              <>
                <p className="text-xs text-red-700">
                  验证码将发送到：{verifyTarget}
                </p>

                <div>
                  <label className="text-xs text-red-700 block mb-1">验证码</label>
                  <input
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    placeholder="输入收到的验证码"
                    maxLength={6}
                    className="profile-input-danger w-full px-3 py-2 rounded-lg text-sm"
                  />
                </div>

                <div>
                  <label className="text-xs text-red-700 block mb-1">
                    输入账号ID <code className="font-mono text-red-700 font-bold">{accountId}</code> 确认注销
                  </label>
                  <input
                    value={confirmText}
                    onChange={e => setConfirmText(e.target.value)}
                    placeholder={accountId || '加载中...'}
                    className="profile-input-danger w-full px-3 py-2 rounded-lg text-sm font-mono"
                  />
                  {confirmText && confirmText !== accountId && (
                    <p className="text-xs text-red-500 mt-1">账号ID 不匹配</p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleDelete}
                    disabled={deleting || confirmText !== accountId || !code || !accountId}
                    className="inline-flex items-center gap-2 px-6 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {deleting && <Loader2 size={14} className="animate-spin" />}
                    确认注销，删除我的账号
                  </button>
                  <button
                    onClick={reset}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
                  >
                    <X size={14} />
                    取消
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 数据导出提示 */}
      <div className="border border-gray-200 rounded-xl p-5">
        <h4 className="text-sm font-medium text-gray-700 mb-2">数据导出</h4>
        <p className="text-xs text-gray-500">
          在注销账号前，建议导出您的所有数据。您可以在「设置 → 数据管理」中进行备份。
        </p>
      </div>
    </div>
  )
}
