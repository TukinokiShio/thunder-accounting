/**
 * 安卓端渲染进程入口（Capacitor WebView 的 webDir 入口）。
 *
 * 四步顺序**固定且必须串行 await**，任一步提前都会破坏下列前提：
 * - ① 安装适配器必须在 ④ 之前 —— `src/main.tsx` 渲染首帧时 `src/App.tsx:33/34/58` 立刻读
 *   `window.electronAPI`，适配器缺位即整页崩。
 * - ② 必须**先 `hydrate()` 成功再 `setStoragePort()`**：hydrate 把已有 DB 读进内存副本；
 *   若顺序反了或跳过，`exists()` 会拿到空副本，紧接着的 `saveDb()` 会用空库
 *   **覆盖用户真实数据**（`android-storage.ts` 对此有 fail-loud 保护：未 hydrate 直接抛错）。
 * - ③ 初始化数据库必须在 ④ 之前 —— 首页挂载即调 `getBills` / `getCategories`。
 * - ④ 动态 import 共享 UI 入口：方向只允许 mobile → src（`src/` 不得反向 import `mobile/`，
 *   否则桌面包会被污染）。
 */
import { installAndroidBridge } from './bridge/android-adapter'
import { createAndroidStoragePort } from './bridge/android-storage'
import { setStoragePort } from '../main-process/database/storage'

/** 启动失败时兜底渲染（避免 ②/③ 失败导致纯白屏、错误只留在控制台） */
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

  // ② 安装安卓持久化端口：先异步预热（把已有 DB 读入内存副本），再注册给共享 DB 模块
  const storage = createAndroidStoragePort()
  await storage.hydrate()
  setStoragePort(storage)

  // ③ 初始化数据库
  const { initDatabase } = await import('../main-process/database/index')
  await initDatabase()

  // ④ 动态导入共享 UI 入口
  await import('../src/main')
}

void bootstrap().catch(renderBootstrapError)
