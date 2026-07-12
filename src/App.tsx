import { useEffect } from 'react'
import { Layout } from '@/components/Layout'
import { Home } from '@/pages/Home'
import { Bills } from '@/pages/Bills'
import { Stats } from '@/pages/Stats'
import { AddBillDialog } from '@/components/AddBillDialog'
import { useStore } from '@/store'

export default function App() {
  const activePage = useStore((s) => s.activePage)
  const openAddDialog = useStore((s) => s.openAddDialog)

  // 首次加载时刷新数据
  useEffect(() => {
    useStore.getState().refreshBills()
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
    <Layout>
      {activePage === 'home' && <Home />}
      {activePage === 'bills' && <Bills />}
      {activePage === 'stats' && <Stats />}
      <AddBillDialog />
    </Layout>
  )
}
