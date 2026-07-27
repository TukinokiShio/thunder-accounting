/** React 渲染进程入口。挂载根组件到 DOM，初始化全局样式。 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('No #root element')

// 全局错误捕获
window.addEventListener('error', (e) => {
  document.body.classList.add('ready')
  rootEl.innerHTML = `<div style="padding:20px;color:red;font-family:monospace;font-size:14px"><b>JS Error:</b><br>${e.message}<br>at ${e.filename}:${e.lineno}</div>`
})
window.addEventListener('unhandledrejection', (e) => {
  document.body.classList.add('ready')
  rootEl.innerHTML = `<div style="padding:20px;color:red;font-family:monospace;font-size:14px"><b>Promise Rejection:</b><br>${String(e.reason)}</div>`
})

// 渲染 React
const r = ReactDOM.createRoot(rootEl)
r.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// React 挂载完成后，标记 body 为 ready，CSS 会隐藏 splash 并显示 #root
document.body.classList.add('ready')
