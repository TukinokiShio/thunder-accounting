/**
 * 应用根组件。
 * 初始化时加载分类和账单数据，注册全局快捷键（Ctrl+N 快速记账）。
 * 布局：左侧 Sidebar + 右侧内容区（根据 activePage 切换页面）。
 */
import { useEffect, useState } from 'react'
import { Layout } from '@/components/Layout'
import { Home } from '@/pages/Home'
import { Bills } from '@/pages/Bills'
import { Stats } from '@/pages/Stats'
import ProfilePage from '@/pages/Profile'
import { AddBillDialog } from '@/components/AddBillDialog'
import { CategoryManager } from '@/components/CategoryManager'
import { SettingsDialog } from '@/components/SettingsDialog'
import { AuthGuard } from '@/components/AuthGuard'
import { ToastContainer } from '@/components/Toast'
import { useStore } from '@/store'
import { LanguageProvider } from '@/i18n/LanguageContext'

export default function App() {
  const activePage = useStore((s) => s.activePage)
  const openAddDialog = useStore((s) => s.openAddDialog)
  const user = useStore((s) => s.user)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // 启动时恢复持久化会话；只有 CloudBase 明确判定会话失效时才回到登录页。
  useEffect(() => {
    let cancelled = false
    const restoreSession = async () => {
      const store = useStore.getState()
      store.setCheckingSession(true)
      try {
        const preferences = await window.electronAPI.loadCredentials()
        const session = await window.electronAPI.checkSession(preferences.autoLogin)
        if (!cancelled) store.setUser(session?.user ?? null)
      } catch (error) {
        console.error('恢复登录会话失败:', error)
        if (!cancelled) store.setUser(null)
      } finally {
        if (!cancelled) store.setCheckingSession(false)
      }
    }

    void restoreSession()
    return () => { cancelled = true }
  }, [])

  // 登录后加载账单和分类数据
  useEffect(() => {
    if (user) {
      useStore.getState().refreshBills()
      useStore.getState().refreshCategories()
    }
  }, [user])

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
          {activePage === 'profile' && <ProfilePage />}
          <AddBillDialog />
          <SettingsDialog isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </Layout>
      </AuthGuard>
      {/* Toast 必须在 AuthGuard 外部，才能在登录页可见 */}
      <ToastContainer />
    </LanguageProvider>
  )
}
