/**
 * Toast 通知容器组件。
 * 固定在屏幕右下角，根据类型（success/error/info）显示不同颜色和图标的通知条。
 * 每条通知 3 秒后自动消失。
 */
import { useStore } from '@/store'
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react'

// Toast 类型 → Lucide 图标映射
const iconMap = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info
}

// Toast 类型 → Tailwind 颜色样式映射
const colorMap = {
  success: 'border-green-200 bg-green-50 text-green-800',
  error: 'border-red-200 bg-red-50 text-red-800',
  info: 'border-blue-200 bg-blue-50 text-blue-800'
}

export function ToastContainer() {
  const toasts = useStore((s) => s.toasts)
  const removeToast = useStore((s) => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => {
        const Icon = iconMap[toast.type]
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center gap-2 px-4 py-3 rounded-lg border shadow-lg animate-slide-up min-w-[280px] max-w-sm ${colorMap[toast.type]}`}
          >
            <Icon size={16} className="shrink-0" />
            <span className="text-sm flex-1">{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
