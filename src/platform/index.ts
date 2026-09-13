/**
 * 平台探测（纯运行时，无构建期分支）。
 *
 * 为什么这样设计：
 * - `src/` 生产文件**不得** import `mobile/`（`mobile/bridge/contract.test.ts:90-96` 是源级门禁），
 *   所以平台信息由入口侧**单向**写入 DOM：`mobile/main.tsx` 在动态 import 共享 UI 之前给
 *   `<html>` 加 `platform-android` 类；这里只做**只读**探测。
 * - 门禁要求「禁止构建期平台分支」（task_plan 不变量 3）：桌面 renderer 入口与安卓入口
 *   共用同一份 `src/`，任何 `import.meta.env` / define 注入都会污染 `app-out/renderer`。
 * - 这个类名是**新引入**的：既有 CSS 规则**零命中**它（对比把 `dark` 提到 `<html>` 会唤醒
 *   一批从未生效的历史规则），因此桌面样式不可能被它改写。
 *
 * 不在模块级缓存结果：测试需要在同一进程内切换真假（见 `src/platform/index.test.ts`），
 * 且 `classList.contains` 的代价可以忽略。
 */
export const ANDROID_PLATFORM_CLASS = 'platform-android'

/** 当前运行环境是否为安卓端（Capacitor WebView）。桌面（Electron）恒为 false。 */
export function isAndroid(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.classList.contains(ANDROID_PLATFORM_CLASS)
}
