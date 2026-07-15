import { useEffect, useState } from 'react'
import { Layout } from '@/components/Layout'
import { Home } from '@/pages/Home'
import { Bills } from '@/pages/Bills'
import { Stats } from '@/pages/Stats'
import { AddBillDialog } from '@/components/AddBillDialog'
import { CategoryManager } from '@/components/CategoryManager'
import { SettingsDialog } from '@/components/SettingsDialog'
import { useStore } from '@/store'

export default function App() {
  const activePage = useStore((s) => s.activePage)
  const openAddDialog = useStore((s) => s.openAddDialog)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // 首次加载时刷新数据
  useEffect(() => {
    const store = useStore.getState()
    store.refreshBills()
    store.refreshCategories()
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
    <Layout onOpenSettings={() => setSettingsOpen(true)}>
      {activePage === 'home' && <Home />}
      {activePage === 'bills' && <Bills />}
      {activePage === 'stats' && <Stats />}
      {activePage === 'categories' && <CategoryManager isOpen={true} onClose={() => {}} mode="page" />}
      <AddBillDialog />
      <SettingsDialog isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </Layout>
  )
}
