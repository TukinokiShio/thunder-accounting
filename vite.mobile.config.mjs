import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'

const require = createRequire(import.meta.url)
const ROOT = process.cwd()

/**
 * 安卓 renderer 构建配置（Capacitor 的 `webDir` 来源）。
 *
 * 与桌面链完全隔离：
 * - 桌面链 = `electron.vite.config.mjs` → `app-out/renderer`（**不改动**）
 * - 安卓链 = 本文件 → `dist-android/`（gitignore）
 *
 * 与桌面链的**唯一**差异是 HTML 入口：桌面用 `src/main.tsx`，安卓用 `mobile/main.tsx`
 * （后者先安装宿主适配器与持久化端口，再动态 import 共享 UI 入口）。
 * 其余（index.html 的 splash 样式、`@` alias、React 插件、Tailwind/PostCSS 管线）全部复用。
 */

/**
 * 复用同一份 `index.html`，只把入口脚本换成安卓入口。
 * 不复制第二份 HTML：splash 样式是 60 行内联 CSS，复制必然漂移。
 */
function androidEntry() {
  return {
    name: 'thunder-android-entry',
    enforce: 'pre',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace('/src/main.tsx', '/mobile/main.tsx')
    }
  }
}

/**
 * 把 sql.js 的 wasm 产物放到 webDir **根**。
 *
 * 为什么必须是根目录：sql.js 浏览器构建用 `self.location.href` 推导 scriptDirectory
 * （`dist/sql-wasm-browser.js` 内的 `ba&&(wa=self.location.href)`），
 * 而 ESM 下 `document.currentScript` 恒为 `null`，于是它请求
 * `<页面目录>/sql-wasm-browser.wasm`；页面目录 = `https://localhost/`（androidScheme=https）。
 *
 * 用 `emitFile` 而不是把 660KB 二进制提交进仓库：产物可复现，仓库不新增二进制。
 * 用 `-browser` 后缀的那个 wasm：Vite 客户端构建走 sql.js `exports["."].browser` 条件，
 * 打包进 bundle 的是 `sql-wasm-browser.js`（其内部引用 `sql-wasm-browser.wasm`）。
 */
function sqlWasmAsset() {
  return {
    name: 'thunder-sqljs-wasm',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'sql-wasm-browser.wasm',
        source: readFileSync(require.resolve('sql.js/dist/sql-wasm-browser.wasm'))
      })
    }
  }
}

export default {
  root: ROOT,
  // 相对路径：Capacitor 以 https://localhost/ 提供 webDir，相对基址对 asset 与 wasm 都安全
  base: './',
  // 不复制仓库根的任何 public 目录（本项目没有，显式关闭以免将来桌面资源被带进 APK）
  publicDir: false,
  plugins: [androidEntry(), sqlWasmAsset(), react()],
  resolve: {
    alias: { '@': resolve(ROOT, 'src') }
  },
  build: {
    outDir: 'dist-android',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      input: resolve(ROOT, 'index.html')
    }
  }
}
