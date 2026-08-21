/**
 * 主布局组件。
 * 组合 Sidebar + 内容区，管理分类管理弹窗、设置弹窗、记账弹窗、Toast 容器的显示。
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Plus, Cloud, CloudOff, CloudCog, Moon, Sun } from 'lucide-react'
import { useStore } from '@/store'
import { useLanguage } from '@/i18n/LanguageContext'

interface Props {
  children: ReactNode
  onOpenSettings: () => void
}

export function Layout({ children, onOpenSettings }: Props) {
  const openAddDialog = useStore((s) => s.openAddDialog)
  const user = useStore((s) => s.user)
  const syncStatus = useStore((s) => s.syncStatus)
  const { t } = useLanguage()
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('thunder_theme') === 'dark' ? 'dark' : 'light'
    } catch {
      return 'light'
    }
  })

  useEffect(() => {
    try { localStorage.setItem('thunder_theme', theme) } catch { /* storage unavailable */ }
  }, [theme])

  const syncIcon = () => {
    if (!user) return <span title="未登录"><CloudOff size={16} className="text-gray-400" /></span>
    switch (syncStatus) {
      case 'syncing': return <span title="同步中"><CloudCog size={16} className="text-[var(--accent)] animate-spin" /></span>
      case 'error': return <span title="同步失败"><CloudOff size={16} className="text-red-400" /></span>
      case 'offline': return <span title="离线"><CloudOff size={16} className="text-gray-400" /></span>
      default: return <span title="已同步"><Cloud size={16} className="text-green-500" /></span>
    }
  }

  return (
    <div className={`${theme === 'dark' ? 'dark' : ''} flex h-screen min-w-0 aurora-shell`} data-testid="app-shell" data-theme={theme}>
      {/* Sidebar */}
      <Sidebar onOpenSettings={onOpenSettings} />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Top bar */}
        <header className="h-16 min-w-0 border-b flex items-center justify-between gap-3 px-6 shrink-0 aurora-topbar">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">{t('雷霆记账')}</h1>
            {syncIcon()}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')}
              className="theme-toggle-btn"
              aria-label={theme === 'light' ? t('切换深色主题') : t('切换浅色主题')}
              title={theme === 'light' ? t('切换深色主题') : t('切换浅色主题')}
            >
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <button onClick={openAddDialog} className="btn-primary flex items-center gap-1.5 text-sm shrink-0">
              <Plus size={16} />
              {t('记一笔')}
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 min-w-0 aurora-main" data-testid="app-main">
          <div className="page-viewport">
            <div className="page-frame" data-testid="page-frame">
              {children}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
