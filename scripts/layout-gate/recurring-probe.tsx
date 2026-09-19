/**
 * 周期支出/记一笔 弹窗版式门禁 —— 被量测页面。
 *
 * 只挂「两个弹窗」而不是整个 App：本轮要判的是弹窗自身的版式（宽度骨架、复选框尺寸、
 * 可输入性、横向溢出），与登录态/页面路由无关；直接挂弹窗可以把断言写得又准又快，
 * 同时仍然跑在**真实组件 + 真实构建 CSS + 真浏览器排版引擎**里。
 *
 * 外壳上下文必须补齐（否则量到的是「脱壳后的样式」）：`.aurora-shell` 是弹窗版式的
 * 后代作用域祖先，`LanguageProvider` 提供 t()。弹窗自身经 createPortal 挂到 body，
 * 替身根由 `modalScope` 提供（`aurora-shell aurora-portal-root`）。
 */
import './fixture'
import '@/index.css'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LanguageProvider } from '@/i18n/LanguageContext'
import { RecurringFormDialog } from '@/components/Recurring/RecurringFormDialog'
import { AddBillDialog } from '@/components/AddBillDialog'
import { ToastContainer } from '@/components/Toast'
import { useStore } from '@/store'
import { runGate } from './recurring-driver'

document.body.classList.add('ready')

/** 驱动器用的最小控制面（避免它去猜 UI 怎么开合） */
declare global {
  interface Window {
    __gate?: {
      setRecurringOpen: (open: boolean) => void
      openAddBill: () => void
      closeAll: () => void
    }
  }
}

function Harness() {
  const [recurringOpen, setRecurringOpen] = useState(true)
  if (typeof window !== 'undefined') {
    window.__gate = {
      setRecurringOpen,
      openAddBill: () => useStore.setState({ isAddDialogOpen: true, editBillId: null, recurringPreset: null }),
      closeAll: () => {
        setRecurringOpen(false)
        useStore.setState({ isAddDialogOpen: false })
      }
    }
  }
  return (
    <div className="aurora-shell" data-theme="light" style={{ minHeight: '100vh' }}>
      <RecurringFormDialog isOpen={recurringOpen} editing={null} onClose={() => setRecurringOpen(false)} />
      <AddBillDialog />
      {/* 校验失败的 toast 必须真的渲染出来才可断言（v2.0.5） */}
      <ToastContainer />
    </div>
  )
}

const rootEl = document.getElementById('root')
createRoot(rootEl as HTMLElement).render(
  <LanguageProvider>
    <Harness />
  </LanguageProvider>
)

function publish(payload: unknown): void {
  const out = document.getElementById('out')
  if (out) out.textContent = JSON.stringify(payload)
}

runGate()
  .then((report) => publish(report))
  .catch((e) => publish({ fatal: e instanceof Error ? `${e.name}: ${e.message}` : String(e), checks: [] }))
