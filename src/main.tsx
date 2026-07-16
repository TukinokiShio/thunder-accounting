/** React 渲染进程入口。挂载根组件到 DOM，初始化全局样式。 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('No #root element')

// 全局错误捕获
window.addEventListener('error', (e) => {
  rootEl.innerHTML = `<div style="padding:20px;color:red;font-family:monospace;font-size:14px"><b>JS Error:</b><br>${e.message}<br>at ${e.filename}:${e.lineno}</div>`
})
window.addEventListener('unhandledrejection', (e) => {
  rootEl.innerHTML = `<div style="padding:20px;color:red;font-family:monospace;font-size:14px"><b>Promise Rejection:</b><br>${String(e.reason)}</div>`
})

// 在 React 渲染前打标记
rootEl.innerHTML = '<div style="padding:20px;font-family:monospace;font-size:14px">Loading React...</div>'

// 延迟一帧确保标记可见
setTimeout(() => {
  const r = ReactDOM.createRoot(rootEl)
  r.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}, 100)
