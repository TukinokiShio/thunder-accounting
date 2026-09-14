/**
 * 设置弹窗组件。
 * 包含：偏好设置（语言、时区）、数据管理（导出/导入备份、清除数据）、关于信息。
 *
 * 本文件只负责「弹窗外壳」（portal / 遮罩 / 焦点与 Escape 处理 / 标题栏）；
 * 三块内容都来自共享实现，安卓「我的」页内联的是同一批组件与同一个 hook：
 *   - `./SettingsDialog/Preferences`  —— 语言 + 时区
 *   - `./SettingsDialog/BackupRestore` + `./SettingsDialog/useDataManagement` —— 数据管理
 *   - `./SettingsDialog/About`        —— 关于
 * 不要在弹窗里再写一份同义实现：两个入口必须逐步一致。
 */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useStore } from '@/store'
import { useLanguage } from '@/i18n/LanguageContext'
import { modalPortalScope } from '@/utils/modalScope'
import { BackupRestore } from './SettingsDialog/BackupRestore'
import { About } from './SettingsDialog/About'
import { Preferences } from './SettingsDialog/Preferences'
import { useDataManagement } from './SettingsDialog/useDataManagement'

interface Props {
  isOpen: boolean
  onClose: () => void
}

export function SettingsDialog({ isOpen, onClose }: Props) {
  const setActivePage = useStore((s) => s.setActivePage)
  const { t } = useLanguage()

  const { exporting, importing, clearing, clearStep, handleExport, handleImport, handleClear, cancelClear } =
    useDataManagement()

  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const handleAccountClick = () => {
    onClose()
    setActivePage('profile')
  }

  useEffect(() => {
    if (!isOpen) return

    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    closeButtonRef.current?.focus()

    return () => {
      returnFocusRef.current?.focus()
      returnFocusRef.current = null
    }
  }, [isOpen])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }

    if (e.key === 'Tab') {
      const focusable = Array.from(
        e.currentTarget.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        )
      )
      if (focusable.length === 0) {
        e.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  if (!isOpen) return null

  const portalScope = modalPortalScope()

  return createPortal(
    <div
      className={`${portalScope.className} flex items-center justify-center`}
      data-theme={portalScope['data-theme']}
      style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 9000 }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} aria-hidden="true" />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        tabIndex={-1}
        className="relative w-full max-w-md mx-4 animate-slide-up max-h-[85vh] overflow-y-auto settings-dialog aurora-dialog"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="settings-dialog-header flex items-center justify-between px-6 py-4 sticky top-0 z-10">
          <h2 id="settings-dialog-title" className="text-lg font-bold text-gray-900">{t('设置')}</h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t('关闭')}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-6">
          {/* ── Preferences（与「我的」页内联块共用 `./SettingsDialog/Preferences`） ── */}
          <section>
            <Preferences idPrefix="settings" />
          </section>

          {/* Account entry kept in settings for discoverability; details live in Profile. */}
          <section>
            <h3 id="settings-account-title" className="text-sm font-semibold mb-2">{t('账户')}</h3>
            <button
              type="button"
              onClick={handleAccountClick}
              aria-label={t('个人中心')}
              className="w-full text-left px-3 py-2 rounded-lg border aurora-border aurora-muted hover:text-[var(--accent)] hover:bg-[var(--accent-dim)] transition-colors"
            >
              {t('在个人中心管理账号绑定与安全设置')}
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
    </div>,
    document.body
  )
}
