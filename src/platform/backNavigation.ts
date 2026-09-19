/**
 * 安卓系统返回键 / 返回手势的**决策核心**（纯函数：无副作用、不依赖 Capacitor）。
 *
 * ## 为什么必须有这一层（原生侧取证，不是推断）
 *
 * `@capacitor/app@8.x` 的 `AppPlugin.java:46-62`：
 * - `load()` 注册一个 `OnBackPressedCallback(!disableBackButtonHandler)`，本工程
 *   `capacitor.config.ts` 未设置 `disableBackButtonHandler` ⇒ 回调**默认启用**；
 * - `handleOnBackPressed()` 分两支：
 *   - **没有** `backButton` 监听时 → `if (webView.canGoBack()) webView.goBack()`，否则什么都不做；
 *   - **有** `backButton` 监听时 → `notifyListeners('backButton', { canGoBack })`，页面切换权交给 JS。
 * - 本应用是**零 history** 的 SPA（全库无 `pushState`/`popstate`，页面切换全靠 zustand
 *   `activePage`）⇒ `canGoBack()` 恒为 false ⇒ 未注册监听的系统返回**完全没有反应**。
 *
 * ## 为什么抽成纯函数
 *
 * jsdom / 无头 Chromium 都没有 Capacitor 原生桥，`App.addListener('backButton')` 无法被驱动；
 * 决策若写在监听器回调里等于**零覆盖**。抽出来后 5 个分支与它们的优先级都可逐条断言。
 * 这与 `src/platform/index.ts`（薄壳 + 可测核心）是同一个模式；依赖方向仍只允许 mobile → src。
 *
 * ## 首页为什么什么都不做
 *
 * 退出/最小化应用是**独立的产品决策**，本轮明确不做（不调用 `App.exitApp()`）；
 * 且当前首页按返回本来就无反应，所以 `noop` 不是行为回归。
 */

/** 与 store 的 `activePage` 联合类型一致；一旦 store 增删页面，调用点会 tsc 报错 */
export type BackNavigationPage = 'home' | 'bills' | 'stats' | 'recurring' | 'categories' | 'profile'

/** 决策所需的全部输入（结构最小集，便于单测逐个构造） */
export interface BackNavigationState {
  /** 设置弹窗是否打开 */
  settingsOpen: boolean
  /** 「记一笔」弹窗是否打开 */
  isAddDialogOpen: boolean
  activePage: BackNavigationPage
}

/** 一次系统返回应触发的动作；`noop` = 什么都不做 */
export type BackAction =
  | { kind: 'close-settings' }
  | { kind: 'close-add-bill' }
  | { kind: 'goto-profile' }
  | { kind: 'goto-home' }
  | { kind: 'noop' }

/**
 * 按优先级解析系统返回动作。**顺序即语义，不要重排**：
 *
 * 1. 设置打开 → 关设置
 * 2. 记账弹窗开着 → 关弹窗
 * 3. `categories` → 回「我的」（分类管理是「我的」的子页）
 * 4. 其它非首页 → 回首页
 * 5. 已在首页 → `noop`
 *
 * 前两条是「模态优先于页面」：浮层盖在页面上时，返回必须先关掉最上面的浮层，
 * 否则用户会看到弹窗还开着、底下的页面却被换掉了。
 */
export function resolveBackAction(state: BackNavigationState): BackAction {
  if (state.settingsOpen) return { kind: 'close-settings' }
  if (state.isAddDialogOpen) return { kind: 'close-add-bill' }
  if (state.activePage === 'categories') return { kind: 'goto-profile' }
  if (state.activePage !== 'home') return { kind: 'goto-home' }
  return { kind: 'noop' }
}
