/**
 * 通用确认弹窗组件。
 * 支持普通模式和危险操作模式（danger 属性开启红色高亮），由调用方控制 open/onConfirm/onCancel。
 */
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useLanguage } from '@/i18n/LanguageContext'

interface Props {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel
}: Props) {
  const { t } = useLanguage()
  const finalConfirmLabel = confirmLabel ?? t('确认')
  const finalCancelLabel = cancelLabel ?? t('取消')
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    cancelButtonRef.current?.focus()

    return () => {
      returnFocusRef.current?.focus()
      returnFocusRef.current = null
    }
  }, [open])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
      return
    }

    if (e.key === 'Tab') {
      const focusable = Array.from(
        e.currentTarget.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
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

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onCancel} aria-hidden="true" />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        tabIndex={-1}
        className="relative rounded-2xl shadow-xl w-full max-w-sm mx-4 animate-slide-up p-6 aurora-dialog"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-start justify-between mb-4">
          <h3 id="confirm-dialog-title" className="text-lg font-bold text-gray-900">{title}</h3>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t('关闭')}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <p id="confirm-dialog-message" className="text-sm text-gray-600 mb-6">{message}</p>

        <div className="flex justify-end gap-2">
          <button ref={cancelButtonRef} type="button" onClick={onCancel} className="btn-secondary text-sm">
            {finalCancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`text-sm min-w-[80px] px-4 py-2 rounded-lg font-medium transition-colors duration-150
              ${danger
                ? 'bg-red-500 text-white hover:bg-red-600 active:bg-red-700'
                : 'btn-primary'
              }`}
          >
            {finalConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
