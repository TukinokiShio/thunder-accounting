/** React 渲染进程入口。挂载根组件到 DOM，初始化全局样式。 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('No #root element')

// 全局错误捕获（使用 textContent 避免 XSS 注入）
function showError(title: string, detail: string): void {
  document.body.classList.add('ready')
  rootEl.textContent = ''
  const div = document.createElement('div')
  div.style.cssText = 'padding:20px;color:red;font-family:monospace;font-size:14px'
  const b = document.createElement('b')
  b.textContent = title
  div.appendChild(b)
  div.appendChild(document.createElement('br'))
  div.appendChild(document.createTextNode(detail))
  rootEl.appendChild(div)
}
window.addEventListener('error', (e) => {
  showError('JS Error:', `${e.message}\nat ${e.filename}:${e.lineno}`)
})
window.addEventListener('unhandledrejection', (e) => {
  showError('Promise Rejection:', String(e.reason))
})

// 渲染 React。开发模式启用 StrictMode 检测副作用；生产构建关闭，避免 Effect 双重调用。
const r = ReactDOM.createRoot(rootEl)
const isDev = typeof process !== 'undefined' && process.env?.NODE_ENV === 'development'
r.render(
  isDev ? (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  ) : <App />
)

// React 挂载完成后，标记 body 为 ready，CSS 会隐藏 splash 并显示 #root
document.body.classList.add('ready')
