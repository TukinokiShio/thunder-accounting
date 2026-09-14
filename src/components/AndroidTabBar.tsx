/**
 * 安卓竖屏底部导航（P2-1 方案 B）：4 个 Tab + 中央凸起「记一笔」。
 *
 * 关键约束：
 * - 本组件**只在 `isAndroid()` 为真时被 Layout 挂载**，所以桌面 DOM 里没有它、也没有
 *   底部导航的文案（否则 `Sidebar.test.tsx` / `Layout.test.tsx` 的 `getByText('账单')` 会
 *   因出现第二个同名文本节点而失败）。这也是「桌面零变化」最直接的保障：桌面连节点都不渲染。
 * - 视觉全部落在 `mobile/android.css`（选择器以 `html.platform-android` 开头），
 *   组件内只挂语义类名，不写颜色。
 * - 可访问性：`<nav aria-label>` + 每项 `aria-current="page"`；触控目标由 CSS 保证 ≥44px。
 * - FAB 与顶栏「记一笔」走同一个 `openAddDialog()`，不新增宿主能力（AppAPI 仍是 41 键）。
 */
import { Home, FileText, PieChart, User, Plus } from 'lucide-react'
import { useStore } from '@/store'
import { useLanguage } from '@/i18n/LanguageContext'

/** 4 Tab 与侧栏 5 项的关系：分类管理不占 Tab，归入「我的」（见 Profile 页入口） */
const TABS = [
  { id: 'home' as const, icon: Home },
  { id: 'bills' as const, icon: FileText },
  { id: 'stats' as const, icon: PieChart },
  { id: 'profile' as const, icon: User }
]

export function AndroidTabBar() {
  const activePage = useStore((s) => s.activePage)
  const setActivePage = useStore((s) => s.setActivePage)
  const openAddDialog = useStore((s) => s.openAddDialog)
  const { t } = useLanguage()

  /** Tab 显示名（中文原文即词典 key，随语言切换） */
  const tabLabels: Record<(typeof TABS)[number]['id'], string> = {
    home: t('首页'),
    bills: t('账单'),
    stats: t('统计'),
    profile: t('我的')
  }

  const renderTab = (tab: (typeof TABS)[number]) => {
    const Icon = tab.icon
    // 「分类管理」是「我的」的子页，指示器仍高亮「我的」
    const isActive = activePage === tab.id || (tab.id === 'profile' && activePage === 'categories')
    return (
      <button
        key={tab.id}
        type="button"
        onClick={() => setActivePage(tab.id)}
        className={`android-tab${isActive ? ' android-tab-active' : ''}`}
        aria-current={isActive ? 'page' : undefined}
        aria-label={tabLabels[tab.id]}
      >
        <Icon size={22} className="android-tab-icon" aria-hidden="true" />
        <span className="android-tab-label">{tabLabels[tab.id]}</span>
      </button>
    )
  }

  return (
    <nav className="android-tabbar" aria-label={t('底部导航')}>
      {TABS.slice(0, 2).map(renderTab)}

      <div className="android-fab-slot">
        <button
          type="button"
          onClick={openAddDialog}
          className="android-fab"
          aria-label={t('记一笔')}
          title={t('记一笔')}
        >
          <Plus size={22} aria-hidden="true" />
        </button>
      </div>

      {TABS.slice(2).map(renderTab)}
    </nav>
  )
}
