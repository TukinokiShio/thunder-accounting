/**
 * 「我的」页（安卓本机账本）几何门禁 —— 被量测页面。
 *
 * 与 `mobile/main.tsx` 的三点对齐（顺序不可换，`scripts/layout-gate/android-probe.tsx` 同规矩）：
 *  ① 先装宿主 API 替身（`ProfilePage` 挂载即调 `electronAPI.getUserStats`）；
 *  ② 给 `<html>` 打 `platform-android` —— 否则 `mobile/android.css` 全部规则不生效，
 *     量到的是桌面布局（这正是这类门禁最容易自我欺骗的地方）；
 *  ③ CSS 顺序与安卓链一致：`mobile/android.css` 先于 `src/index.css`
 *     （`mobile/main.tsx` 静态 import android.css，再动态 import 共享入口里的 index.css）。
 *
 * 只渲染 `Layout + ProfilePage`（不渲染整个 App）：量测目标是「我的」页本身的几何，
 * 不需要路由/弹窗/toast；但必须保留 `Layout` —— 顶栏与底部导航占据的高度决定了
 * 「可用内容带」的大小，把它们省掉会把内容带量得比真机更高，从而**放宽**判据。
 */
import '@android-css'
import '@/index.css'
import { createRoot } from 'react-dom/client'
import { LanguageProvider } from '@/i18n/LanguageContext'
import { Layout } from '@/components/Layout'
import ProfilePage from '@/pages/Profile'
import { runGate } from './profile-driver'

/* ① 宿主 API 替身：确定性内存实现。
   用 Proxy 兜底未列出的键（返回 async noop）：本页只用到很少几个键，但 `Layout` 与
   共享组件偶发读取其它键时不该把页面打崩 —— 兜底值只会让「读不到数据」，不会让几何变形。 */
const noop = async (): Promise<undefined> => undefined
const known: Record<string, unknown> = {
  loadCredentials: async () => ({ autoLogin: false }),
  checkSession: async () => null,
  onShortcut: () => () => undefined,
  // 本页唯一真正决定内容高度的一条：数据概览（本机库聚合，见 Profile.tsx 的门控注释）
  getUserStats: async () => ({ billCount: 42, categoryCount: 11, totalExpense: 3210.5, totalIncome: 12000 })
}
const api = new Proxy(known, {
  get: (target, key) => (typeof key === 'string' && key in target ? target[key] : noop)
})
;(window as unknown as Record<string, unknown>).electronAPI = api

/* ② 平台类 */
document.documentElement.classList.add('platform-android')
document.body.classList.add('ready')

/* ③ 渲染 */
const rootEl = document.getElementById('root')
const root = createRoot(rootEl as HTMLElement)
root.render(
  <LanguageProvider>
    <Layout onOpenSettings={() => undefined}>
      <ProfilePage />
    </Layout>
  </LanguageProvider>
)

function publish(payload: unknown): void {
  const out = document.getElementById('out')
  if (out) out.textContent = JSON.stringify(payload)
}

runGate()
  .then((report) => publish(report))
  .catch((e) => publish({ fatal: e instanceof Error ? `${e.name}: ${e.message}` : String(e), checks: [] }))
