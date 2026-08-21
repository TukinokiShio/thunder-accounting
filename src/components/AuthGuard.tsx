import { type ReactNode } from 'react'
import { useStore } from '@/store'
import { LoginPage } from '@/pages/Login'

interface Props {
  children: ReactNode
}

/** 认证路由守卫 — 未登录时显示登录页，检查中显示加载 */
export function AuthGuard({ children }: Props) {
  const user = useStore(s => s.user)
  const isCheckingSession = useStore(s => s.isCheckingSession)

  if (isCheckingSession) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-400">加载中...</p>
        </div>
      </div>
    )
  }

  if (!user) return <LoginPage />

  return <>{children}</>
}
