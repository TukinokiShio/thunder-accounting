/**
 * 桌面视口比对门禁 —— 被量测页面（真实组件 + 真实构建 CSS + 1280×900 桌面视口）。
 *
 * 与 `src/main.tsx`（桌面入口）的关系：
 *  - 一致：先装宿主 API 替身（fixture 的副作用），再 `import '@/index.css'`，**不给**
 *    `<html>` 打 `platform-android`（`src/platform/index.ts` 的 `isAndroid()` 只读这个类，
 *    不加 ⇒ 所有 `isAndroid()` 分支都走桌面侧）。
 *  - **故意更强**：额外 `import '@android-css'`，且放在 `index.css` **之后**。
 *    真实桌面产物根本不含 android.css（`mobile/android.css` 头部注释有取证），所以「android.css
 *    对桌面无影响」在真机上是个不会被检验的声明。这里把该文件放进页面、并用**同特指度时后者胜**
 *    的顺序加载 —— 只要它存在任何一条未加 `html.platform-android` 前缀的规则，桌面布局就会被改写，
 *    本门禁立刻红。于是「无影响」从声明变成**可证伪的断言**（自检项见 env.bodyOverscrollY）。
 */
import './fixture'
import '@/index.css'
import '@android-css'
import { createRoot } from 'react-dom/client'
import App from '@/App'
import { runGate } from './desktop-driver'

/**
 * 桌面侧必须先「已登录」才能进到应用外壳：`AuthGuard` 的安卓分支有本地模式旁路
 * （`if (isAndroid()) return <>{children}</>`，见 `src/components/AuthGuard.tsx:30`），
 * **桌面分支没有** —— `if (!user) return <LoginPage />`。而共享夹具故意模拟的是
 * 「本地未登录」环境（`loadCredentials → {autoLogin:false}`、`checkSession → null`），
 * 所以这里在**探针侧**（不动共享夹具，避免改动安卓侧的判定条件）把宿主 API 换成
 * 「已有持久化会话」—— 这正是真实桌面的既定状态（Electron 端始终持有一个云端账号）。
 *
 * 时序要紧：`checkSession` 的返回值会经 App 的 `restoreSession` effect 写回 store，
 * 若只在这一行之前 `setUser(...)` 会被后续 `setUser(null)` 覆盖，所以必须改 API 本身。
 */
const GATE_USER = {
  uid: 'gate-user',
  email: 'gate@example.com',
  emailVerified: true,
  accountId: 'gate-account',
  nickname: 'gate'
}
const gateApi = (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI
gateApi.loadCredentials = async () => ({ autoLogin: true })
gateApi.checkSession = async () => ({ user: GATE_USER })

document.body.classList.add('ready')

/**
 * 统一关闭 CSS 动画与过渡 —— 本门禁量的是**落定帧**，不是「动画的某一帧」。
 *
 * 实测教训（两处，都是「同一棵树自己跟自己比」也能测出的假差异）：
 *  ① `index.html` 的 `#splash` 带 `fadeIn .3s` + 无限 `pulse`/`blink`，`.dots span` 的 opacity
 *     每次都不同（0.305877 vs 0.305859）；
 *  ② 无头 + `--virtual-time-budget` 下，按钮的 `transition-colors` 会长期停在 `running`
 *     （`document.getAnimations()` 实测 7~8 条 `CSSTransition@button.[running]`），
 *     于是翻页切换选中态时会把 `background-color` 的中间值（`--accent-dim` 的半透明过渡态）
 *     写进快照。
 * 这类噪声只能**消除**（加容差 = 把真差异一起放过）。
 *
 * 代价与边界（明确写下来，免得被误用）：本门禁**不覆盖动画本身** —— 动画/过渡相关属性
 * （`animation-*` / `transition-*`）也不在 PROPS 里。它守的是「落定态下的几何/排版/颜色」。
 * 关闭过渡不会掩盖任何落定值差异：过渡只是向目标值插值，目标值由静态声明决定，仍会被逐项比对。
 */
const freezeMotion = document.createElement('style')
freezeMotion.textContent = `
  *, *::before, *::after { animation: none !important; transition: none !important; }
`
document.head.appendChild(freezeMotion)

const rootEl = document.getElementById('root')
const root = createRoot(rootEl as HTMLElement)
root.render(<App />)

function publish(payload: unknown): void {
  const out = document.getElementById('out')
  if (out) out.textContent = JSON.stringify(payload)
}

runGate(publish)
  .then((report) => publish(report))
  .catch((e) => publish({ fatal: e instanceof Error ? `${e.name}: ${e.message}` : String(e), pages: [] }))
