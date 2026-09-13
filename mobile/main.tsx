/**
 * 安卓端渲染进程入口（Capacitor WebView 的 webDir 入口）。
 *
 * 三步顺序**固定且必须串行 await**，任一步提前都会破坏下列前提：
 * - ① 安装适配器必须在 ③ 之前 —— `src/main.tsx` 渲染首帧时 `src/App.tsx:33/34/58` 立刻读
 *   `window.electronAPI`，适配器缺位即整页崩。
 * - ② 初始化数据库必须在 ③ 之前 —— 首页挂载即调 `getBills` / `getCategories`。
 * - ③ 动态 import 共享 UI 入口：方向只允许 mobile → src（`src/` 不得反向 import `mobile/`，
 *   否则桌面包会被污染）。
 *
 * ⚠ 已知未闭环项（Phase 3 交付，非本阶段）：② 依赖安卓版 `StoragePort`，而 Capacitor 的
 * Filesystem/Preferences 插件**全是异步 API**，无法满足 `saveDb()` 的同步签名（`main.ts:72-79`
 * 的 `will-quit` 无 flush 时机，不得改异步）。因此安卓端须实现「同步入队 + 异步 flush」的写队列。
 * 该实现未在本阶段交付，故 ② 目前会以明确错误失败（fail-loud，绝不静默丢数据）。
 */
import { installAndroidBridge } from './bridge/android-adapter'

/** 启动失败时兜底渲染（避免 ② 失败导致纯白屏、错误只留在控制台） */
function renderBootstrapError(error: unknown): void {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  console.error('安卓端启动失败:', error)
  const root = document.getElementById('root')
  if (!root) return
  document.body.classList.add('ready')
  root.textContent = ''
  const box = document.createElement('div')
  box.style.cssText = 'padding:20px;font-family:monospace;font-size:14px;color:#b3261e'
  const title = document.createElement('b')
  title.textContent = '启动失败：'
  box.appendChild(title)
  box.appendChild(document.createTextNode(detail))
  root.appendChild(box)
}

async function bootstrap(): Promise<void> {
  // ① 安装适配器到 window.electronAPI（内部用 ??=，不覆盖已存在的宿主）
  installAndroidBridge()

  // ② 初始化数据库（落盘端口须已由平台入口安装，见文件头「已知未闭环项」）
  const { initDatabase } = await import('../main-process/database/index')
  await initDatabase()

  // ③ 动态导入共享 UI 入口
  await import('../src/main')
}

void bootstrap().catch(renderBootstrapError)
