/**
 * Toast 通知容器组件。
 * 固定在屏幕中央底部，根据类型（success/error/info）显示不同颜色和图标的通知条。
 * 每条通知 5 秒后自动消失。
 */
import { useStore } from '@/store'
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react'

// Toast 类型 → Lucide 图标映射
const iconMap = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info
}

export function ToastContainer() {
  const toasts = useStore((s) => s.toasts)
  const removeToast = useStore((s) => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex w-[calc(100%-2rem)] -translate-x-1/2 flex-col items-center gap-2 pointer-events-none">
      {toasts.map((toast) => {
        const Icon = iconMap[toast.type]
        return (
          <div
            key={toast.id}
            className={`aurora-toast aurora-toast-${toast.type} pointer-events-auto flex w-full max-w-md items-center gap-3 px-4 py-3 rounded-xl border shadow-lg animate-slide-up`}
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
