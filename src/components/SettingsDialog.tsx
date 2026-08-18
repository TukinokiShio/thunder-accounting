/**
 * 设置弹窗组件。
 * 包含：偏好设置（语言、时区）、数据管理（导出/导入备份、清除数据）、关于信息。
 */
import { useState } from 'react'
import { X, Globe, Clock } from 'lucide-react'
import { useStore } from '@/store'
import { useLanguage } from '@/i18n/LanguageContext'
import { loadSettings, saveSettings, TIMEZONE_OPTIONS } from '@/utils/settings'
import { formatLocalDate } from '@/utils/date'
import { BackupRestore } from './SettingsDialog/BackupRestore'
import { About } from './SettingsDialog/About'

interface Props {
  isOpen: boolean
  onClose: () => void
}

export function SettingsDialog({ isOpen, onClose }: Props) {
  const refreshBills = useStore((s) => s.refreshBills)
  const refreshCategories = useStore((s) => s.refreshCategories)
  const addToast = useStore((s) => s.addToast)
  const notifyChange = useStore((s) => s.notifyChange)
  const { t, language, setLanguage } = useLanguage()

  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearStep, setClearStep] = useState(0)
  const [timezone, setTimezone] = useState(() => loadSettings().timezone)

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
      if (!result) {
        setImporting(false)
        return
      }

      const { bills, categories } = await window.electronAPI.importBackup(result.content)
      addToast(
        'success',
        t('数据已恢复：{bills} 条账单，{categories} 个自定义分类')
          .replace('{bills}', String(bills))
          .replace('{categories}', String(categories))
      )
      await refreshBills()
      await refreshCategories()
      notifyChange()
    } catch (e) {
      console.error('Import failed:', e)
      addToast(
        'error',
        e instanceof Error ? e.message : t('导入失败，请检查文件格式')
      )
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
      <div className="relative rounded-2xl shadow-xl w-full max-w-md mx-4 animate-slide-up max-h-[85vh] overflow-y-auto aurora-dialog">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 z-10 aurora-dialog aurora-border">
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
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Account entry kept in settings for discoverability; details live in Profile. */}
          <section>
            <h3 className="text-sm font-semibold mb-2">账户</h3>
            <button
              type="button"
              onClick={onClose}
              className="w-full text-left px-3 py-2 rounded-lg border aurora-border aurora-muted hover:text-[var(--accent)] hover:bg-[var(--accent-dim)] transition-colors"
            >
              在个人中心管理账号绑定与安全设置
            </button>
          </section>

          {/* ── Data Management ── */}
          <BackupRestore
            exporting={exporting}
            importing={importing}
            clearing={clearing}
            clearStep={clearStep}
            onExport={handleExport}
            onImport={handleImport}
            onClear={handleClear}
            onCancelClear={cancelClear}
            t={t}
          />

          {/* ── About ── */}
          <About t={t} />
        </div>
      </div>
    </div>
  )
}
