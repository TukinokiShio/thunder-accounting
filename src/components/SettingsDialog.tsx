/**
 * 设置弹窗组件。
 * 包含：偏好设置（语言、时区）、数据管理（导出/导入 JSON 备份、三步确认清除数据）、关于信息。
 */
import { useState } from 'react'
import { X, Download, Upload, Trash2, Zap, Github, Globe, Clock, Mail, LogOut, Key, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useStore } from '@/store'
import { useLanguage } from '@/i18n/LanguageContext'
import { loadSettings, saveSettings, TIMEZONE_OPTIONS } from '@/utils/settings'
import { formatLocalDate } from '@/utils/date'
import { friendlyError } from '@/utils/errorMessages'
import pkg from '../../package.json'

interface Props {
  isOpen: boolean
  onClose: () => void
}

export function SettingsDialog({ isOpen, onClose }: Props) {
  const refreshBills = useStore((s) => s.refreshBills)
  const refreshCategories = useStore((s) => s.refreshCategories)
  const addToast = useStore((s) => s.addToast)
  const notifyChange = useStore((s) => s.notifyChange)
  const user = useStore((s) => s.user)
  const appLogout = useStore((s) => s.appLogout)
  const { t, language, setLanguage } = useLanguage()

  const handleLogout = async () => {
    await appLogout()
    addToast('info', t('已退出登录'))
  }

  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearStep, setClearStep] = useState(0)
  const [timezone, setTimezone] = useState(() => loadSettings().timezone)

  // Change password
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
    if (!oldPassword) { setPwdError(t('请输入当前密码')); return }
    setSendingCode(true)
    try {
      await window.electronAPI.sendReauthCode(oldPassword)
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
    if (!newPassword) { setPwdError(t('请输入新密码')); return }
    if (newPassword.length < 6) { setPwdError(t('新密码至少 6 位')); return }
    if (!codeSent) { setPwdError(t('请先发送验证码')); return }
    setChangingPwd(true)
    try {
      await window.electronAPI.changePassword(newPassword)
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

  const handleExport = async () => {
    setExporting(true)
    try {
      const json = await window.electronAPI.exportBackup()
      const filePath = await window.electronAPI.showSaveDialog(
        `ThunderBooks_Backup_${formatLocalDate()}.json`
      )
      if (filePath) {
        await window.electronAPI.writeFile(filePath, json)
        addToast('success', t('数据备份已导出'))
      } else {
        addToast('info', t('已取消导出'))
      }
    } catch (e) {
      console.error('Export failed:', e)
      addToast('error', t('导出失败，请重试'))
    } finally {
      setExporting(false)
    }
  }

  const handleImport = async () => {
    setImporting(true)
    try {
      const result = await window.electronAPI.showOpenDialog()
      if (!result) { setImporting(false); return }

      const { bills, categories } = await window.electronAPI.importBackup(result.content)
      addToast('success', t('数据已恢复：{bills} 条账单，{categories} 个自定义分类')
        .replace('{bills}', String(bills))
        .replace('{categories}', String(categories)))
      await refreshBills()
      await refreshCategories()
      notifyChange()
    } catch (e) {
      console.error('Import failed:', e)
      addToast('error', e instanceof Error ? e.message : t('导入失败，请检查文件格式'))
    } finally {
      setImporting(false)
    }
  }

  const handleClear = async () => {
    if (clearStep === 0) {
      setClearStep(1)
      return
    }
    if (clearStep === 1) {
      setClearStep(2)
      return
    }

    setClearing(true)
    try {
      await window.electronAPI.clearAllData()
      addToast('success', t('所有数据已清除'))
      setClearStep(0)
      await refreshBills()
      await refreshCategories()
      notifyChange()
    } catch (e) {
      console.error('Clear failed:', e)
      addToast('error', t('清除失败，请重试'))
    } finally {
      setClearing(false)
    }
  }

  const cancelClear = () => {
    setClearStep(0)
  }

  const handleTimezoneChange = (tz: string) => {
    setTimezone(tz)
    saveSettings({ timezone: tz })
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 animate-slide-up max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold text-gray-900">{t('设置')}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-6">
          {/* ── Preferences ── */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">{t('偏好设置')}</h3>
            <div className="space-y-3">
              {/* Language */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <Globe size={16} className="text-indigo-500" />
                  <span>{t('语言')}</span>
                </div>
                <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
                  <button
                    onClick={() => setLanguage('zh')}
                    className={`px-3 py-1.5 transition-colors ${
                      language === 'zh'
                        ? 'bg-primary-500 text-white'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {t('中文')}
                  </button>
                  <button
                    onClick={() => setLanguage('en')}
                    className={`px-3 py-1.5 transition-colors ${
                      language === 'en'
                        ? 'bg-primary-500 text-white'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {t('English')}
                  </button>
                </div>
              </div>

              {/* Timezone */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <Clock size={16} className="text-blue-500" />
                  <span>{t('时区')}</span>
                </div>
                <select
                  value={timezone}
                  onChange={(e) => handleTimezoneChange(e.target.value)}
                  className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 max-w-[180px]"
                >
                  {TIMEZONE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* ── Data Management ── */}
          <section className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">{t('数据管理')}</h3>
            <div className="space-y-2">
              {/* Export */}
              <button
                onClick={handleExport}
                disabled={exporting}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <Download size={16} className="text-blue-500 shrink-0" />
                <div className="flex-1">
                  <div className="font-medium">{t('导出备份')}</div>
                  <div className="text-xs text-gray-400">{t('将所有账单和分类导出为 JSON 文件')}</div>
                </div>
              </button>

              {/* Import */}
              <button
                onClick={handleImport}
                disabled={importing}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <Upload size={16} className="text-green-500 shrink-0" />
                <div className="flex-1">
                  <div className="font-medium">{t('导入备份')}</div>
                  <div className="text-xs text-gray-400">{t('从 JSON 备份文件恢复数据（会覆盖现有数据）')}</div>
                </div>
              </button>

              {/* Clear */}
              <div>
                <button
                  onClick={handleClear}
                  disabled={clearing}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left transition-colors disabled:opacity-50
                    ${clearStep > 0
                      ? 'bg-red-50 text-red-600 hover:bg-red-100'
                      : 'text-gray-700 hover:bg-gray-50'
                    }`}
                >
                  <Trash2 size={16} className={`shrink-0 ${clearStep > 0 ? 'text-red-500' : 'text-red-400'}`} />
                  <div className="flex-1">
                    <div className="font-medium">
                      {clearStep === 0 && t('清除所有数据')}
                      {clearStep === 1 && t('⚠️ 再次确认：清除所有数据？')}
                      {clearStep === 2 && t('🚨 最后确认：此操作不可恢复！')}
                    </div>
                    <div className="text-xs text-gray-400">
                      {clearStep === 0 && t('删除所有账单和自定义分类（预设分类保留）')}
                      {clearStep === 1 && t('所有账单将被永久删除')}
                      {clearStep === 2 && t('点击第三次将执行清除')}
                    </div>
                  </div>
                </button>
                {clearStep > 0 && (
                  <button
                    onClick={cancelClear}
                    className="mt-1 ml-11 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {t('取消清除')}
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* ── Account ── */}
          <section className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">{t('账户')}</h3>
            {user ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800">
                  <Mail size={16} className="text-primary-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-700 dark:text-gray-300 truncate">{user.email}</div>
                    <div className="text-xs text-gray-400">
                      {user.emailVerified ? t('邮箱已验证') : t('邮箱未验证')}
                    </div>
                  </div>
                </div>
                {/* Change Password Button */}
                <button
                  onClick={() => setShowPwdForm(v => !v)}
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
                        onChange={e => setOldPassword(e.target.value)}
                        className="w-full pr-8 py-2 px-3 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500"
                      />
                      <button type="button" onClick={() => setShowOldPwd(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
                        {showOldPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type={showNewPwd ? 'text' : 'password'}
                        placeholder={t('新密码')}
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        className="w-full pr-8 py-2 px-3 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500"
                      />
                      <button type="button" onClick={() => setShowNewPwd(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
                        {showNewPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder={t('验证码')}
                        value={verifyCode}
                        onChange={e => setVerifyCode(e.target.value)}
                        className="flex-1 py-2 px-3 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500"
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
                      className="w-full py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm rounded-lg transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                    >
                      {changingPwd && <Loader2 size={14} className="animate-spin" />}
                      {t('确认修改')}
                    </button>
                  </div>
                )}
                <button
                  onClick={handleLogout}
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

          {/* ── About ── */}
          <section className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">{t('关于')}</h3>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-primary-500 rounded-xl flex items-center justify-center">
                <Zap size={20} className="text-white" />
              </div>
              <div>
                <div className="font-semibold text-gray-900 text-sm">{t('雷霆记账')}</div>
                <div className="text-xs text-gray-400">v{pkg.version} — {t('轻量级个人日常记账工具')}</div>
              </div>
            </div>

            <div className="space-y-1.5 text-xs text-gray-500">
              <div className="flex items-center gap-2">
                <span className="w-16 text-gray-400">{t('快捷键')}</span>
                <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600 font-mono text-xs">Ctrl+N</kbd>
                <span>{t('快速记一笔')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-16 text-gray-400">{t('数据存储')}</span>
                <span>{t('本地 SQLite + 云端同步')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-16 text-gray-400">{t('开源协议')}</span>
                <span>MIT License</span>
              </div>
            </div>

            <a
              href="https://github.com/TukinokiShio/thunder-accounting"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 mt-3 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              <Github size={14} />
              GitHub
            </a>
          </section>
        </div>
      </div>
    </div>
  )
}
