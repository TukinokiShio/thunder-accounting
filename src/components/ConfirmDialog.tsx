/**
 * 通用确认弹窗组件。
 * 支持普通模式和危险操作模式（danger 属性开启红色高亮），由调用方控制 open/onConfirm/onCancel。
 */
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

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onCancel} />

      {/* Dialog */}
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 animate-slide-up p-6">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          <button
            onClick={onCancel}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-6">{message}</p>

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn-secondary text-sm">
            {finalCancelLabel}
          </button>
          <button
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
