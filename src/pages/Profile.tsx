/**
 * 个人中心页面。
 * 左侧标签导航 + 右侧内容区布局（借鉴 shadcn-admin Settings 模块）。
 * 包含：账号信息、安全设置、绑定管理、数据概览、危险操作 5 个标签页。
 */
import { useState, useEffect, useCallback } from 'react'
import { useStore } from '@/store'
import {
  User, Lock, Link, BarChart3, AlertTriangle,
  Copy, Check, Eye, EyeOff, Loader2, Trash2,
  Mail, Phone, Shield, Key, LogOut
} from 'lucide-react'

type Tab = 'info' | 'security' | 'binding' | 'stats' | 'danger'

interface AccountInfo {
  accountId: string
  email: string
  phone: string
}

interface UserStats {
  billCount: number
  categoryCount: number
  totalExpense: number
  totalIncome: number
}

export default function ProfilePage() {
  const { user, addToast, appLogout } = useStore()
  const [activeTab, setActiveTab] = useState<Tab>('info')

  // ── 账号信息 ──
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [copied, setCopied] = useState(false)

  // ── 安全设置 ──
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showOldPwd, setShowOldPwd] = useState(false)
  const [showNewPwd, setShowNewPwd] = useState(false)
  const [reauthCode, setReauthCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [changingPwd, setChangingPwd] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)

  // ── 绑定管理 ──
  const [bindTarget, setBindTarget] = useState('')
  const [bindCode, setBindCode] = useState('')
  const [bindVid, setBindVid] = useState('')
  const [bindCodeSent, setBindCodeSent] = useState(false)
  const [binding, setBinding] = useState(false)
  const [sendingBindCode, setSendingBindCode] = useState(false)
  const [unbindTarget, setUnbindTarget] = useState<'email' | 'phone' | null>(null)
  const [unbindCode, setUnbindCode] = useState('')
  const [unbindVid, setUnbindVid] = useState('')
  const [unbindCodeSent, setUnbindCodeSent] = useState(false)
  const [unbinding, setUnbinding] = useState(false)
  const [sendingUnbindCode, setSendingUnbindCode] = useState(false)

  // ── 数据概览 ──
  const [stats, setStats] = useState<UserStats | null>(null)

  // ── 危险操作 ──
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteCode, setDeleteCode] = useState('')
  const [deleteVid, setDeleteVid] = useState('')
  const [deleteCodeSent, setDeleteCodeSent] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [sendingDeleteCode, setSendingDeleteCode] = useState(false)

  // ── 加载账号信息 ──
  const loadAccount = useCallback(async () => {
    try {
      const info = await window.electronAPI.getAccountBindings()
      setAccount(info)
    } catch { /* ignore */ }
  }, [])

  // ── 加载数据概览 ──
  const loadStats = useCallback(async () => {
    try {
      const s = await window.electronAPI.getUserStats()
      setStats(s)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    loadAccount()
    loadStats()
  }, [loadAccount, loadStats])

  // ── 复制账号 ID ──
  const copyAccountId = () => {
    if (!account?.accountId) return
    navigator.clipboard.writeText(account.accountId)
    setCopied(true)
    addToast('success', '已复制账号ID')
    setTimeout(() => setCopied(false), 2000)
  }

  // ── 发送重认证验证码 ──
  const handleSendReauthCode = async () => {
    if (!oldPassword) return
    setSendingCode(true)
    try {
      await window.electronAPI.sendReauthCode(oldPassword)
      setCodeSent(true)
      addToast('success', '验证码已发送到邮箱')
    } catch (e: any) {
      addToast('error', e.message || '发送失败')
    } finally {
      setSendingCode(false)
    }
  }

  // ── 修改密码 ──
  const handleChangePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      addToast('error', '新密码至少6位')
      return
    }
    if (!codeSent) {
      addToast('error', '请先发送验证码')
      return
    }
    setChangingPwd(true)
    try {
      await window.electronAPI.changePassword(newPassword)
      addToast('success', '密码修改成功')
      setShowPasswordForm(false)
      setOldPassword('')
      setNewPassword('')
      setReauthCode('')
      setCodeSent(false)
    } catch (e: any) {
      addToast('error', e.message || '修改失败')
    } finally {
      setChangingPwd(false)
    }
  }

  // ── 发送绑定验证码 ──
  const handleSendBindCode = async (target: string) => {
    if (!target) return
    setSendingBindCode(true)
    try {
      const result = await window.electronAPI.sendBindCode(target)
      setBindVid(result.verificationId)
      setBindCodeSent(true)
      addToast('success', `验证码已发送到${result.type === 'phone' ? '手机' : '邮箱'}`)
    } catch (e: any) {
      addToast('error', e.message || '发送失败')
    } finally {
      setSendingBindCode(false)
    }
  }

  // ── 确认绑定 ──
  const handleConfirmBind = async (type: 'email' | 'phone') => {
    if (!bindCode || !bindVid) {
      addToast('error', '请输入验证码')
      return
    }
    setBinding(true)
    try {
      if (type === 'email') {
        await window.electronAPI.bindEmail(bindTarget, bindCode, bindVid)
      } else {
        await window.electronAPI.bindPhone(bindTarget, bindCode, bindVid)
      }
      addToast('success', '绑定成功')
      setBindTarget('')
      setBindCode('')
      setBindVid('')
      setBindCodeSent(false)
      loadAccount()
    } catch (e: any) {
      addToast('error', e.message || '绑定失败')
    } finally {
      setBinding(false)
    }
  }

  // ── 发送解绑验证码 ──
  const handleSendUnbindCode = async (type: 'email' | 'phone') => {
    if (!account) return
    const target = type === 'email' ? account.email : account.phone
    if (!target) return
    setSendingUnbindCode(true)
    try {
      // 使用 sendVerificationCode（已绑定的目标）
      await window.electronAPI.sendCode(target)
      // 获取 verificationId 需要调用 sendBindCode
      const result = await window.electronAPI.sendBindCode(target)
      setUnbindVid(result.verificationId)
      setUnbindCodeSent(true)
      setUnbindTarget(type)
      addToast('success', `验证码已发送到${type === 'phone' ? '手机' : '邮箱'}`)
    } catch (e: any) {
      addToast('error', e.message || '发送失败')
    } finally {
      setSendingUnbindCode(false)
    }
  }

  // ── 确认解绑 ──
  const handleConfirmUnbind = async () => {
    if (!unbindCode || !unbindVid || !unbindTarget) {
      addToast('error', '请输入验证码')
      return
    }
    setUnbinding(true)
    try {
      if (unbindTarget === 'email') {
        await window.electronAPI.unbindEmail(unbindCode, unbindVid)
      } else {
        await window.electronAPI.unbindPhone(unbindCode, unbindVid)
      }
      addToast('success', '解绑成功')
      setUnbindTarget(null)
      setUnbindCode('')
      setUnbindVid('')
      setUnbindCodeSent(false)
      loadAccount()
    } catch (e: any) {
      addToast('error', e.message || '解绑失败')
    } finally {
      setUnbinding(false)
    }
  }

  // ── 发送注销验证码 ──
  const handleSendDeleteCode = async () => {
    if (!account) return
    const target = account.phone || account.email
    if (!target) return
    setSendingDeleteCode(true)
    try {
      const result = await window.electronAPI.sendBindCode(target)
      setDeleteVid(result.verificationId)
      setDeleteCodeSent(true)
      addToast('success', `验证码已发送到${result.type === 'phone' ? '手机' : '邮箱'}`)
    } catch (e: any) {
      addToast('error', e.message || '发送失败')
    } finally {
      setSendingDeleteCode(false)
    }
  }

  // ── 确认注销 ──
  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== account?.accountId) {
      addToast('error', '请输入正确的账号ID确认注销')
      return
    }
    if (!deleteCode || !deleteVid) {
      addToast('error', '请输入验证码')
      return
    }
    setDeleting(true)
    try {
      await window.electronAPI.deleteAccount(deleteCode, deleteVid)
      addToast('success', '账号已注销')
      setTimeout(() => appLogout(), 500)
    } catch (e: any) {
      addToast('error', e.message || '注销失败')
    } finally {
      setDeleting(false)
    }
  }

  // ── 退出登录 ──
  const handleLogout = async () => {
    await appLogout()
    addToast('info', '已退出登录')
  }

  // ── 标签定义 ──
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'info', label: '账号信息', icon: <User size={16} /> },
    { id: 'security', label: '安全设置', icon: <Lock size={16} /> },
    { id: 'binding', label: '绑定管理', icon: <Link size={16} /> },
    { id: 'stats', label: '数据概览', icon: <BarChart3 size={16} /> },
    { id: 'danger', label: '危险操作', icon: <AlertTriangle size={16} /> },
  ]

  // ── 判断是否为内部邮箱（phone@phone.tb） ──
  const isInternalEmail = (email: string) => email.endsWith('@phone.tb')

  return (
    <div className="flex h-full">
      {/* ── 左侧标签导航 ── */}
      <div className="w-48 border-r border-gray-200 bg-white shrink-0">
        <div className="p-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800">个人中心</h2>
        </div>
        <nav className="p-2 space-y-1">
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
      </div>

      {/* ── 右侧内容区 ── */}
      <div className="flex-1 overflow-auto p-8">
        {/* ===== 账号信息 ===== */}
        {activeTab === 'info' && (
          <div className="max-w-lg space-y-6">
            {/* 头像 + 欢迎语 */}
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center text-2xl font-bold text-blue-600">
                {user?.email?.charAt(0).toUpperCase() || '?'}
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900">
                  {user?.email || '未知用户'}
                </h3>
                <p className="text-sm text-gray-500">雷霆记账用户</p>
              </div>
            </div>

            {/* 账号 ID */}
            <div className="bg-gray-50 rounded-xl p-4">
              <label className="text-xs text-gray-500 mb-1 block">雷霆记账账号</label>
              <div className="flex items-center gap-2">
                <code className="text-lg font-mono font-bold text-gray-800 tracking-wider">
                  {account?.accountId || '加载中...'}
                </code>
                <button
                  onClick={copyAccountId}
                  className="p-1.5 rounded-md hover:bg-gray-200 transition-colors"
                  title="复制账号ID"
                >
                  {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} className="text-gray-400" />}
                </button>
              </div>
            </div>

            {/* 邮箱 */}
            <div className="flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-xl">
              <Mail size={20} className="text-gray-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500">邮箱</p>
                <p className="text-sm text-gray-800 truncate">
                  {account?.email && !isInternalEmail(account.email)
                    ? account.email
                    : '未绑定邮箱'}
                </p>
              </div>
              {account?.email && !isInternalEmail(account.email) && (
                <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">已验证</span>
              )}
            </div>

            {/* 手机号 */}
            <div className="flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-xl">
              <Phone size={20} className="text-gray-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500">手机号</p>
                <p className="text-sm text-gray-800">
                  {account?.phone || '未绑定手机号'}
                </p>
              </div>
            </div>

            {/* 退出登录按钮 */}
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <LogOut size={16} />
              退出登录
            </button>
          </div>
        )}

        {/* ===== 安全设置 ===== */}
        {activeTab === 'security' && (
          <div className="max-w-lg space-y-6">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Shield size={20} className="text-blue-600" />
              安全设置
            </h2>

            {/* 修改密码 */}
            <div className="border border-gray-200 rounded-xl p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Key size={18} className="text-gray-400" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">修改密码</p>
                    <p className="text-xs text-gray-500">建议定期更换密码以保证账号安全</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowPasswordForm(!showPasswordForm)}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  {showPasswordForm ? '收起' : '修改'}
                </button>
              </div>

              {showPasswordForm && (
                <div className="mt-4 space-y-3 pl-11">
                  {/* 旧密码 */}
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">当前密码</label>
                    <div className="relative">
                      <input
                        type={showOldPwd ? 'text' : 'password'}
                        value={oldPassword}
                        onChange={e => setOldPassword(e.target.value)}
                        className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="输入当前密码"
                      />
                      <button
                        onClick={() => setShowOldPwd(!showOldPwd)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                      >
                        {showOldPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* 发送验证码 */}
                  <button
                    onClick={handleSendReauthCode}
                    disabled={!oldPassword || sendingCode}
                    className="text-sm px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {sendingCode && <Loader2 size={14} className="animate-spin" />}
                    {codeSent ? '重新发送验证码' : '发送验证码'}
                  </button>

                  {/* 新密码 */}
                  {codeSent && (
                    <>
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">新密码</label>
                        <div className="relative">
                          <input
                            type={showNewPwd ? 'text' : 'password'}
                            value={newPassword}
                            onChange={e => setNewPassword(e.target.value)}
                            className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            placeholder="输入新密码（至少6位）"
                          />
                          <button
                            onClick={() => setShowNewPwd(!showNewPwd)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                          >
                            {showNewPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </div>

                      {/* 验证码 */}
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">验证码</label>
                        <input
                          value={reauthCode}
                          onChange={e => setReauthCode(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="输入收到的验证码"
                        />
                      </div>

                      <button
                        onClick={handleChangePassword}
                        disabled={changingPwd || !newPassword}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {changingPwd && <Loader2 size={14} className="animate-spin" />}
                        确认修改
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* 安全提示 */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
              <p className="font-medium mb-1">安全提示</p>
              <ul className="list-disc list-inside space-y-1 text-amber-700">
                <li>密码应包含字母、数字和特殊字符</li>
                <li>不要在多个平台使用相同密码</li>
                <li>如发现异常登录，请立即修改密码</li>
              </ul>
            </div>
          </div>
        )}

        {/* ===== 绑定管理 ===== */}
        {activeTab === 'binding' && (
          <div className="max-w-lg space-y-6">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Link size={20} className="text-blue-600" />
              绑定管理
            </h2>
            <p className="text-sm text-gray-500">绑定邮箱和手机号可以增强账号安全性，用于找回密码和接收重要通知。</p>

            {/* 邮箱绑定 */}
            <div className="border border-gray-200 rounded-xl p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Mail size={18} className="text-gray-400" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">邮箱</p>
                    <p className="text-xs text-gray-500">
                      {account?.email && !isInternalEmail(account.email)
                        ? account.email
                        : '未绑定'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {account?.email && !isInternalEmail(account.email) ? (
                    <button
                      onClick={() => handleSendUnbindCode('email')}
                      disabled={unbinding}
                      className="text-sm text-red-600 hover:text-red-700 font-medium"
                    >
                      解绑
                    </button>
                  ) : (
                    <span className="text-xs text-gray-400">-</span>
                  )}
                </div>
              </div>

              {/* 解绑邮箱验证码 */}
              {unbindTarget === 'email' && (
                <div className="mt-4 pl-11 space-y-3">
                  <input
                    value={unbindCode}
                    onChange={e => setUnbindCode(e.target.value)}
                    placeholder="输入验证码"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <button
                    onClick={handleConfirmUnbind}
                    disabled={unbinding}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm disabled:opacity-50 flex items-center gap-2"
                  >
                    {unbinding && <Loader2 size={14} className="animate-spin" />}
                    确认解绑邮箱
                  </button>
                </div>
              )}

              {/* 绑定新邮箱 */}
              {(!account?.email || isInternalEmail(account.email || '')) && (
                <div className="mt-4 pl-11 space-y-3">
                  <input
                    type="email"
                    value={bindTarget}
                    onChange={e => setBindTarget(e.target.value)}
                    placeholder="输入要绑定的邮箱"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  {!bindCodeSent ? (
                    <button
                      onClick={() => handleSendBindCode(bindTarget)}
                      disabled={!bindTarget || sendingBindCode}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50 flex items-center gap-2"
                    >
                      {sendingBindCode && <Loader2 size={14} className="animate-spin" />}
                      发送验证码
                    </button>
                  ) : (
                    <>
                      <input
                        value={bindCode}
                        onChange={e => setBindCode(e.target.value)}
                        placeholder="输入验证码"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                      <button
                        onClick={() => handleConfirmBind('email')}
                        disabled={binding}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50 flex items-center gap-2"
                      >
                        {binding && <Loader2 size={14} className="animate-spin" />}
                        确认绑定邮箱
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* 手机号绑定 */}
            <div className="border border-gray-200 rounded-xl p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Phone size={18} className="text-gray-400" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">手机号</p>
                    <p className="text-xs text-gray-500">
                      {account?.phone || '未绑定'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {account?.phone ? (
                    <button
                      onClick={() => handleSendUnbindCode('phone')}
                      disabled={unbinding}
                      className="text-sm text-red-600 hover:text-red-700 font-medium"
                    >
                      解绑
                    </button>
                  ) : (
                    <span className="text-xs text-gray-400">未绑定</span>
                  )}
                </div>
              </div>

              {/* 解绑手机号验证码 */}
              {unbindTarget === 'phone' && (
                <div className="mt-4 pl-11 space-y-3">
                  <input
                    value={unbindCode}
                    onChange={e => setUnbindCode(e.target.value)}
                    placeholder="输入验证码"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <button
                    onClick={handleConfirmUnbind}
                    disabled={unbinding}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm disabled:opacity-50 flex items-center gap-2"
                  >
                    {unbinding && <Loader2 size={14} className="animate-spin" />}
                    确认解绑手机号
                  </button>
                </div>
              )}

              {/* 绑定新手机号 */}
              {!account?.phone && (
                <div className="mt-4 pl-11 space-y-3">
                  <input
                    value={bindTarget}
                    onChange={e => setBindTarget(e.target.value.replace(/\D/g, '').slice(0, 11))}
                    placeholder="输入11位手机号"
                    maxLength={11}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  {!bindCodeSent ? (
                    <button
                      onClick={() => handleSendBindCode(bindTarget)}
                      disabled={bindTarget.length !== 11 || sendingBindCode}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50 flex items-center gap-2"
                    >
                      {sendingBindCode && <Loader2 size={14} className="animate-spin" />}
                      发送验证码
                    </button>
                  ) : (
                    <>
                      <input
                        value={bindCode}
                        onChange={e => setBindCode(e.target.value)}
                        placeholder="输入验证码"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                      <button
                        onClick={() => handleConfirmBind('phone')}
                        disabled={binding}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50 flex items-center gap-2"
                      >
                        {binding && <Loader2 size={14} className="animate-spin" />}
                        确认绑定手机号
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== 数据概览 ===== */}
        {activeTab === 'stats' && (
          <div className="max-w-lg space-y-6">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <BarChart3 size={20} className="text-blue-600" />
              数据概览
            </h2>

            {/* 统计卡片 */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-blue-50 rounded-xl p-4">
                <p className="text-xs text-blue-600 font-medium">账单总数</p>
                <p className="text-2xl font-bold text-blue-900 mt-1">
                  {stats?.billCount ?? '...'}
                </p>
              </div>
              <div className="bg-green-50 rounded-xl p-4">
                <p className="text-xs text-green-600 font-medium">分类总数</p>
                <p className="text-2xl font-bold text-green-900 mt-1">
                  {stats?.categoryCount ?? '...'}
                </p>
              </div>
              <div className="bg-red-50 rounded-xl p-4">
                <p className="text-xs text-red-600 font-medium">累计支出</p>
                <p className="text-2xl font-bold text-red-900 mt-1">
                  ¥{stats?.totalExpense?.toLocaleString() ?? '...'}
                </p>
              </div>
              <div className="bg-emerald-50 rounded-xl p-4">
                <p className="text-xs text-emerald-600 font-medium">累计收入</p>
                <p className="text-2xl font-bold text-emerald-900 mt-1">
                  ¥{stats?.totalIncome?.toLocaleString() ?? '...'}
                </p>
              </div>
            </div>

            {/* 净收支 */}
            {stats && (
              <div className={`rounded-xl p-4 ${stats.totalIncome >= stats.totalExpense ? 'bg-emerald-50' : 'bg-red-50'}`}>
                <p className="text-xs text-gray-600 font-medium">净收支</p>
                <p className={`text-lg font-bold mt-1 ${stats.totalIncome >= stats.totalExpense ? 'text-emerald-700' : 'text-red-700'}`}>
                  ¥{(stats.totalIncome - stats.totalExpense).toLocaleString()}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ===== 危险操作 ===== */}
        {activeTab === 'danger' && (
          <div className="max-w-lg space-y-6">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <AlertTriangle size={20} className="text-red-600" />
              危险操作
            </h2>
            <p className="text-sm text-gray-500">以下操作不可逆，请谨慎操作。</p>

            {/* 注销账号 — Danger Zone 模式（借鉴 Origin UI） */}
            <div className="border-2 border-red-200 bg-red-50/30 rounded-xl overflow-hidden">
              {/* 红色左边框警示 */}
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
                  {/* 发送验证码 */}
                  <button
                    onClick={handleSendDeleteCode}
                    disabled={!account || sendingDeleteCode}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {sendingDeleteCode && <Loader2 size={14} className="animate-spin" />}
                    {deleteCodeSent ? '重新发送验证码' : '发送验证码'}
                  </button>

                  {deleteCodeSent && (
                    <>
                      {/* 验证码 */}
                      <div>
                        <label className="text-xs text-gray-600 block mb-1">验证码</label>
                        <input
                          value={deleteCode}
                          onChange={e => setDeleteCode(e.target.value)}
                          placeholder="输入收到的验证码"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                        />
                      </div>

                      {/* 输入账号ID确认 */}
                      <div>
                        <label className="text-xs text-gray-600 block mb-1">
                          输入账号ID <code className="text-red-600 font-mono">{account?.accountId}</code> 确认注销
                        </label>
                        <input
                          value={deleteConfirmText}
                          onChange={e => setDeleteConfirmText(e.target.value)}
                          placeholder={account?.accountId || 'TBXXXXXX'}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-red-500 focus:border-red-500"
                        />
                      </div>

                      {/* 确认按钮 */}
                      <button
                        onClick={handleDeleteAccount}
                        disabled={deleting || deleteConfirmText !== account?.accountId || !deleteCode}
                        className="px-6 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium flex items-center gap-2 transition-all"
                      >
                        {deleting && <Loader2 size={14} className="animate-spin" />}
                        确认注销，删除我的账号
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* 次要危险操作提示 */}
            <div className="border border-gray-200 rounded-xl p-5">
              <h4 className="text-sm font-medium text-gray-700 mb-2">数据导出</h4>
              <p className="text-xs text-gray-500 mb-3">
                在注销账号前，建议导出您的所有数据。您可以在「设置 → 数据管理」中进行备份。
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
