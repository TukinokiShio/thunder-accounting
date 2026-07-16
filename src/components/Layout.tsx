import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { ToastContainer } from './Toast'
import { Plus } from 'lucide-react'
/**
 * 主布局组件。
 * 组合 Sidebar + 内容区，管理分类管理弹窗、设置弹窗、记账弹窗、Toast 容器的显示。
 */
import { useStore } from '@/store'
import { useLanguage } from '@/i18n/LanguageContext'

interface Props {
  children: ReactNode
  onOpenSettings: () => void
}

export function Layout({ children, onOpenSettings }: Props) {
  const openAddDialog = useStore((s) => s.openAddDialog)
  const { t } = useLanguage()

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden">
      {/* Sidebar */}
      <Sidebar onOpenSettings={onOpenSettings} />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-14 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-850 flex items-center justify-between px-6 shrink-0">
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t('雷霆记账')}</h1>
          <button
            onClick={openAddDialog}
            className="btn-primary flex items-center gap-1.5 text-sm"
          >
            <Plus size={16} />
            {t('记一笔')}
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>

      {/* Toast notifications */}
      <ToastContainer />
    </div>
  )
}
