import { useEffect, useState } from 'react'
import { Layout } from '@/components/Layout'
import { Home } from '@/pages/Home'
import { Bills } from '@/pages/Bills'
import { Stats } from '@/pages/Stats'
import { AddBillDialog } from '@/components/AddBillDialog'
import { CategoryManager } from '@/components/CategoryManager'
import { SettingsDialog } from '@/components/SettingsDialog'
import { AuthGuard } from '@/components/AuthGuard'
/**
 * 应用根组件。
 * 初始化时加载分类和账单数据，注册全局快捷键（Ctrl+N 快速记账）。
 * 布局：左侧 Sidebar + 右侧内容区（根据 activePage 切换页面）。
 */
import { useStore } from '@/store'
import { LanguageProvider } from '@/i18n/LanguageContext'

export default function App() {
  const activePage = useStore((s) => s.activePage)
  const openAddDialog = useStore((s) => s.openAddDialog)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // 启动时检查登录状态
  useEffect(() => {
    const store = useStore.getState()
    store.setCheckingSession(true)
    window.electronAPI.checkSession()
      .then(result => store.setUser(result?.user || null))
      .catch(e => console.error('检查登录状态失败:', e))
      .finally(() => store.setCheckingSession(false))
  }, [])

  // 首次加载时刷新数据（登录后）
  useEffect(() => {
    const store = useStore.getState()
    if (store.user) {
      store.refreshBills()
      store.refreshCategories()
    }
  }, [])

  // 监听全局快捷键
  useEffect(() => {
    const unsub = window.electronAPI.onShortcut((action) => {
      if (action === 'addBill') {
        openAddDialog()
      }
    })
    return unsub
  }, [openAddDialog])

  return (
    <LanguageProvider>
      <AuthGuard>
        <Layout onOpenSettings={() => setSettingsOpen(true)}>
          {activePage === 'home' && <Home />}
          {activePage === 'bills' && <Bills />}
          {activePage === 'stats' && <Stats />}
          {activePage === 'categories' && <CategoryManager isOpen={true} onClose={() => {}} mode="page" />}
          <AddBillDialog />
          <SettingsDialog isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </Layout>
      </AuthGuard>
    </LanguageProvider>
  )
}
