/**
 * 安卓布局门禁 —— 被量测页面（真实组件 + 真实构建 CSS + 模拟安卓视口）。
 *
 * 与 `mobile/main.tsx` 的三点对齐（顺序不可换）：
 * ① 先装宿主 API 替身（fixture 的副作用）—— `src/App.tsx` 挂载即读 `window.electronAPI`；
 * ② 给 `<html>` 打 `platform-android` —— 否则 `mobile/android.css` 全部规则不生效，
 *    量到的是桌面布局（这正是本门禁最容易自我欺骗的地方）；
 * ③ CSS 顺序与安卓链一致：`mobile/android.css` 先于 `src/index.css`
 *    （`mobile/main.tsx` 静态 import android.css，再动态 import 共享入口里的 index.css）。
 */
import './android-layout-fixture'
import '@android-css'
import '@/index.css'
import { createRoot } from 'react-dom/client'
import App from '@/App'
import { runGate } from './android-layout-driver'

document.documentElement.classList.add('platform-android')
document.body.classList.add('ready')

const rootEl = document.getElementById('root')
const root = createRoot(rootEl as HTMLElement)
root.render(<App />)

function publish(payload: unknown): void {
  const out = document.getElementById('out')
  if (out) out.textContent = JSON.stringify(payload)
}

runGate()
  .then((report) => publish(report))
  .catch((e) => publish({ fatal: e instanceof Error ? `${e.name}: ${e.message}` : String(e), checks: [] }))
