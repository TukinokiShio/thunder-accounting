import { Home, FileText, PieChart, Zap } from 'lucide-react'
import { useStore } from '@/store'

const navItems = [
  { id: 'home' as const, label: '总览', icon: Home },
  { id: 'bills' as const, label: '账单', icon: FileText },
  { id: 'stats' as const, label: '统计', icon: PieChart }
]

export function Sidebar() {
  const activePage = useStore((s) => s.activePage)
  const setActivePage = useStore((s) => s.setActivePage)

  return (
    <aside className="w-56 bg-white dark:bg-gray-850 border-r border-gray-100 dark:border-gray-700 flex flex-col shrink-0">
      {/* Logo */}
      <div className="h-14 flex items-center gap-2 px-5 border-b border-gray-100 dark:border-gray-700">
        <div className="w-8 h-8 bg-primary-500 rounded-lg flex items-center justify-center">
          <Zap size={18} className="text-white" />
        </div>
        <span className="font-bold text-gray-900 dark:text-gray-100">雷霆记账</span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = activePage === item.id
          return (
            <button
              key={item.id}
              onClick={() => setActivePage(item.id)}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                transition-colors duration-150
                ${isActive
                  ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-750 hover:text-gray-900 dark:hover:text-gray-200'
                }
              `}
            >
              <Icon size={18} />
              {item.label}
            </button>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700">
        <p className="text-xs text-gray-400 dark:text-gray-500">雷霆记账 v1.1.2</p>
      </div>
    </aside>
  )
}
