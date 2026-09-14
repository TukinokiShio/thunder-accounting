/**
 * 安卓端渲染进程入口（Capacitor WebView 的 webDir 入口）。
 *
 * 六个步骤（其中 ② 含三个**不可拆分、不可换序**的子步）**固定且必须串行 await**，
 * 任一步提前都会破坏下列前提：
 * - ⓪ 给 `<html>` 打上 `platform-android` 类：必须在 ④ 之前 —— `src/platform.isAndroid()`
 *   靠它做运行时平台判定（`src/` 不得 import `mobile/`，平台信息只能由入口侧单向写入 DOM）。
 * - ① 安装适配器到 `window.electronAPI`，必须在 ④ 之前 —— `src/main.tsx` 渲染首帧时
 *   `src/App.tsx:33/34/58` 立刻读 `window.electronAPI`，适配器缺位即整页崩。
 * - ② 安装安卓持久化端口，三个子步 **必须按 ②ⓐ → ②ⓑ → ②ⓒ 顺序**：
 *   ②ⓐ `createAndroidStoragePort()` → ②ⓑ `await storage.hydrate()` → ②ⓒ `setStoragePort(storage)`。
 *   必须**先 `hydrate()` 成功再 `setStoragePort()`**：hydrate 把已有 DB 读进内存副本；
 *   若顺序反了或跳过，`exists()` 会拿到空副本，紧接着的 `saveDb()` 会用空库
 *   **覆盖用户真实数据**（`android-storage.ts` 对此有 fail-loud 保护：未 hydrate 直接抛错）。
 * - ③ 初始化数据库必须在 ④ 之前 —— 首页挂载即调 `getBills` / `getCategories`。
 * - ④ 动态 import 共享 UI 入口：方向只允许 mobile → src（`src/` 不得反向 import `mobile/`，
 *   否则桌面包会被污染）。
 * - ⑤ 注册系统返回键 / 返回手势，**必须在 ④ 之后** —— 它读 `src/store` 的 `activePage`
 *   与弹窗开关，而 store 由 ④ 的共享 UI 载入；提前注册只会读到未就绪的状态。
 *   与 ⓪~④ 的区别：前五步决定「能不能启动」，⑤ 只决定「返回键有没有反应」，
 *   所以它自身失败不抛给 `renderBootstrapError`，只降级为「屏幕上的返回按钮仍可用」。
 */
import './android.css'
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { installAndroidBridge } from './bridge/android-adapter'
import { createAndroidStoragePort } from './bridge/android-storage'
import { setStoragePort } from '../main-process/database/storage'
import { T } from '../src/i18n/translations'
import { loadSettings } from '../src/utils/settings'
import { resolveBackAction } from '../src/platform/backNavigation'

/**
 * 启动阶段的轻量翻译：与 `LanguageContext` 同一契约（zh 原样返回 key）。
 * 首屏渲染前没有 React 上下文，此处直接读持久化的语言偏好。
 */
function t(key: string): string {
  try {
    return loadSettings().language === 'zh' ? key : T[key] ?? key
  } catch {
    return key
  }
}

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
  title.textContent = t('启动失败：')
  box.appendChild(title)
  box.appendChild(document.createTextNode(detail))
  root.appendChild(box)
}

/**
 * 已注册的 `backButton` 监听句柄。**幂等守卫**：`bootstrap()` 正常只跑一次，
 * 但开发态 HMR / 异常重启可能重复进入；重复 `addListener` 会让一次返回触发多次决策
 * （例如连跳两级页面），所以这里只允许注册一次。
 */
let backButtonHandle: PluginListenerHandle | null = null

/**
 * 系统返回键 / 返回手势的处理：**只做映射**，决策在 `src/platform/backNavigation.ts`
 * 的纯函数里（jsdom 驱动不了原生监听器，决策放在那里才可覆盖）。
 *
 * 为什么必须有这段监听（原生侧取证）：`@capacitor/app` 的 `AppPlugin.java:46-62` 在
 * **没有** `backButton` 监听时只执行 `if (webView.canGoBack()) goBack()`；本应用是零 history
 * 的 SPA（无 pushState/popstate）⇒ `canGoBack()` 恒为 false ⇒ 系统返回完全无反应。
 */
async function handleSystemBack(): Promise<void> {
  const { useStore } = await import('../src/store')
  const store = useStore.getState()
  const action = resolveBackAction({
    activePage: store.activePage,
    settingsOpen: store.settingsOpen,
    isAddDialogOpen: store.isAddDialogOpen
  })
  switch (action.kind) {
    case 'close-settings':
      store.closeSettings()
      return
    case 'close-add-bill':
      store.closeAddDialog()
      return
    case 'goto-profile':
      store.setActivePage('profile')
      return
    case 'goto-home':
      store.setActivePage('home')
      return
    case 'noop':
      // 已在首页：明确**不**退出应用（退出是独立的产品决策，本轮不做）
      return
    default: {
      // 穷尽性守卫：BackAction 新增 kind 时这里编译失败，避免悄悄退化成 no-op
      const unreachable: never = action
      void unreachable
      return
    }
  }
}

/**
 * ⑤ 注册系统返回键 / 返回手势（必须在 ④ 之后：它读 `src/store`，而 store 由 ④ 载入）。
 *
 * - **特性检测**：非原生平台（例如直接在浏览器里预览 `dist-android`）没有原生桥，
 *   `addListener` 无意义且可能抛错 → 直接跳过（与 `android-storage.ts` 的
 *   `defaultRegisterBackgroundFlush` 同一写法）。
 * - 注册失败只降级（屏幕上的返回按钮仍可用），**不阻断启动** —— 所以它不抛给
 *   `renderBootstrapError`。
 */
async function registerBackButton(): Promise<void> {
  if (backButtonHandle) return
  if (!Capacitor.isNativePlatform()) return
  try {
    backButtonHandle = await App.addListener('backButton', () => {
      void handleSystemBack()
    })
  } catch (error) {
    console.warn('系统返回键注册失败，仅屏幕返回可用:', error)
  }
}

async function bootstrap(): Promise<void> {
  // ⓪ 标记平台：必须在动态 import 共享 UI 之前完成，否则首帧 `isAndroid()` 会读到 false。
  //    这是**新类名**，既有 CSS 规则零命中它 → 桌面样式不可能被改写。
  document.documentElement.classList.add('platform-android')

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

  // ⑤ 注册系统返回键 / 返回手势
  await registerBackButton()
}

void bootstrap().catch(renderBootstrapError)
