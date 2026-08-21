import { useState } from 'react'
import { Mail, Key, Eye, EyeOff, LogOut, Loader2 } from 'lucide-react'
import { friendlyError } from '@/utils/errorMessages'

interface Props {
  user: { email: string; emailVerified: boolean } | null
  t: (key: string) => string
  language: 'zh' | 'en'
  addToast: (type: 'error' | 'success' | 'info', message: string) => void
  onLogout: () => void
}

export function SyncStatus({ user, t, language, addToast, onLogout }: Props) {
  const [showPwdForm, setShowPwdForm] = useState(false)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [showOldPwd, setShowOldPwd] = useState(false)
  const [showNewPwd, setShowNewPwd] = useState(false)
  const [changingPwd, setChangingPwd] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [codeSent, setCodeSent] = useState(false)
  const [pwdError, setPwdError] = useState('')

  const handleSendCode = async () => {
    setPwdError('')
    setSendingCode(true)
    try {
      const bindings = await window.electronAPI.getAccountBindings()
      const verifyOpt = bindings?.phone ? 'phone_code' : bindings?.email || user?.email ? 'email_code' : null
      if (!verifyOpt) {
        setPwdError(t('发送失败'))
        return
      }
      await window.electronAPI.sendReauthCode(verifyOpt)
      setCodeSent(true)
      addToast('success', t('验证码已发送到邮箱'))
    } catch (e) {
      setPwdError(friendlyError(e, language, t('发送失败')))
    } finally {
      setSendingCode(false)
    }
  }

  const handleChangePassword = async () => {
    setPwdError('')
    if (!newPassword) {
      setPwdError(t('请输入新密码'))
      return
    }
    const passwordClasses = [/[a-z]/, /[A-Z]/, /\d/, /[()!@#$%^&*|?><_\-]/]
    if (newPassword.length < 8 || newPassword.length > 32 || passwordClasses.filter(pattern => pattern.test(newPassword)).length < 3) {
      setPwdError('新密码需为 8-32 位，并包含小写字母、大写字母、数字、特殊字符中的至少三类')
      return
    }
    if (!codeSent || !verifyCode) {
      setPwdError(t('请先发送验证码'))
      return
    }
    setChangingPwd(true)
    try {
      await window.electronAPI.changePassword(newPassword, verifyCode, oldPassword || undefined)
      addToast('success', t('密码修改成功'))
      setShowPwdForm(false)
      setOldPassword('')
      setNewPassword('')
      setVerifyCode('')
      setCodeSent(false)
    } catch (e) {
      setPwdError(friendlyError(e, language, t('修改失败')))
    } finally {
      setChangingPwd(false)
    }
  }

  return (
    <section className="border-t border-gray-100 pt-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">{t('账户')}</h3>
      {user ? (
        <div className="space-y-2">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800">
            <Mail size={16} className="text-[var(--accent)] shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-700 dark:text-gray-300 truncate">{user.email}</div>
              <div className="text-xs text-gray-400">
                {user.emailVerified ? t('邮箱已验证') : t('邮箱未验证')}
              </div>
            </div>
          </div>
          {/* Change Password Button */}
          <button
            onClick={() => setShowPwdForm((v) => !v)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
          >
            <Key size={16} className="shrink-0" />
            <span className="font-medium">{t('修改密码')}</span>
          </button>
          {/* Change Password Form */}
          {showPwdForm && (
            <div className="px-3 py-2 space-y-3 border border-gray-200 dark:border-gray-700 rounded-lg">
              {pwdError && <p className="text-xs text-red-500">{pwdError}</p>}
              <div className="relative">
                <input
                  type={showOldPwd ? 'text' : 'password'}
                  placeholder={t('旧密码')}
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  className="w-full pr-8 py-2 px-3 text-sm border border-[var(--border)] rounded-lg bg-[var(--bg-card)] text-[var(--text)] placeholder:text-[var(--text3)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                />
                <button
                  type="button"
                  onClick={() => setShowOldPwd((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400"
                >
                  {showOldPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <div className="relative">
                <input
                  type={showNewPwd ? 'text' : 'password'}
                  placeholder={t('新密码')}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full pr-8 py-2 px-3 text-sm border border-[var(--border)] rounded-lg bg-[var(--bg-card)] text-[var(--text)] placeholder:text-[var(--text3)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPwd((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400"
                >
                  {showNewPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={t('验证码')}
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                  className="flex-1 py-2 px-3 text-sm border border-[var(--border)] rounded-lg bg-[var(--bg-card)] text-[var(--text)] placeholder:text-[var(--text3)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                />
                <button
                  onClick={handleSendCode}
                  disabled={sendingCode || codeSent}
                  className="px-3 py-2 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-200 disabled:opacity-50 whitespace-nowrap flex items-center gap-1"
                >
                  {sendingCode ? <Loader2 size={12} className="animate-spin" /> : null}
                  {codeSent ? (language === 'zh' ? '已发送' : 'Sent') : t('发送验证码')}
                </button>
              </div>
              <button
                onClick={handleChangePassword}
                disabled={changingPwd}
                className="w-full py-2 bg-[var(--accent)] hover:bg-[var(--accent-h)] text-white text-sm rounded-lg transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {changingPwd && <Loader2 size={14} className="animate-spin" />}
                {t('确认修改')}
              </button>
            </div>
          )}
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <LogOut size={16} className="shrink-0" />
            <span className="font-medium">{t('退出登录')}</span>
          </button>
        </div>
      ) : (
        <p className="text-sm text-gray-400 px-3">{t('未登录，数据仅存储在本地。')}</p>
      )}
    </section>
  )
}
