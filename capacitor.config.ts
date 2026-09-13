import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor 工程配置（安卓）。
 *
 * `webDir` 必须与 `vite.mobile.config.mjs` 的 `build.outDir` 一致。
 *
 * `android.androidScheme: 'https'` 是**硬要求，绝不可退回 `file://`**：
 * sql.js 的 `.wasm` 通过 `fetch()` 加载，`file://` 下 `fetch` 会被 WebView 的同源策略拒绝
 * （`file://` 源是 opaque origin），表现为 App 启动即「SQL 初始化失败」。
 * 用 `https` 后页面源是 `https://localhost`，wasm 的 fetch 才成立。
 */
const config: CapacitorConfig = {
  appId: 'com.thunder.accounting',
  appName: '雷霆记账',
  webDir: 'dist-android',
  android: {
    androidScheme: 'https'
  }
}

export default config
