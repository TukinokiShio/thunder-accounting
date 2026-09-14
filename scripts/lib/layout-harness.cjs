#!/usr/bin/env node
/**
 * scripts/lib/layout-harness.cjs —— 布局类门禁共用的「构建 + 无头浏览器量测」harness。
 *
 * 为什么抽出来：安卓布局门禁（`verify-android-layout.cjs`）与桌面视口比对门禁
 * （`verify-desktop-parity.cjs`）需要一模一样的这段链路 —— 找浏览器、生成 scratch 探针页、
 * vite 构建、把产物内联成自包含单页、挂无头 Chromium 量测。**这段代码是最容易踩环境坑的部分
 * （见下），抄第二份必然漂移**，所以只留一份。
 *
 * 两侧的差异只有三个参数：探针入口文件名、scratch 目录名、视口尺寸。
 *
 * 踩坑结论（照抄自 verify-modal-scope.cjs，别改）：
 *  - 只依赖 Node 内置模块，不新增依赖。
 *  - **不要改成「同进程 HTTP 服务」**：execFileSync 会同步阻塞事件循环，同进程 http server
 *    永远无法响应，浏览器一直等文档 → 互锁死锁（无报错无超时）。这里用 `file://` +
 *    内联 CSS/JS 的单页（实测整轮 ~8s）。
 *  - `file://` 下 ES module 会被 CORS 拦、`<link crossorigin>` 会加载失败 → 构建产物必须内联。
 *  - 每个外部调用都带 `{ timeout, killSignal: 'SIGKILL' }`，并在调用前打印上下文。
 *  - 不写 pack 产物目录（`app-out/` / `dist-android/`）；中间产物只落 `<root>/out/<scratch>/`
 *    （`out/` 已在 .gitignore 内）。
 *
 * 用法：
 *   const harness = require('./lib/layout-harness.cjs').createHarness('VERIFY_XXX')
 *   harness.prepareScratch(root, { srcDir, files, probeEntry, scratchDir, define })
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const { execFileSync } = require('node:child_process')

/** 造一个绑定到某个门禁标签的 harness；fail() 的消息会自动带上标签。 */
function createHarness(label) {
  const log = (...a) => console.log(...a)

  /**
   * scratch 目录名的**唯一后缀**（pid + 进程启动时刻）。
   *
   * 为什么需要（实测踩到，不是防御性编程）：两道门禁的 scratch 默认名各自固定
   * （桌面 = `desktop-parity`，安卓 = `layout-gate`），而 `prepareScratch` 的第一步是
   * `fs.rmSync(scratch, {recursive:true, force:true})`。两个门禁（或同门禁的两个实例）
   * 并发跑时，后启动的那个会把先启动的那个的中间产物**整个删掉** ⇒ 报出莫名其妙的
   * 构建失败/量到空壳，而屏幕上看起来只是一份正常报告。
   *
   * 为什么不用全局锁：锁会带来死锁与残留锁文件两类新问题，而且要求人来协调运行窗口。
   * 让 scratch 天然不重名更简单，也**不需要任何协调**。
   * 为什么不用随机数：唯一性的来源要**确定**（pid + 启动时刻），报告里会把它打印出来，
   * 出错时能据此定位是哪一次的产物。`--scratch` 仍可显式覆盖。
   */
  const scratchTag = `${process.pid}-${Date.now().toString(36)}`
  function uniqueScratch(base) {
    return `${base}-${scratchTag}`
  }

  /** 门禁的统一失败出口：打印 `<标签>: <消息>` 后按语义退出码结束。 */
  function fail(msg, code) {
    console.error(`${label}: ${msg}`)
    process.exit(code)
  }

  /** 找一个可用的无头浏览器（优先 playwright 的 chrome-headless-shell）。 */
  function findBrowser() {
    const candidates = []
    if (process.env.CHROME_HEADLESS_SHELL && fs.existsSync(process.env.CHROME_HEADLESS_SHELL)) {
      candidates.push(process.env.CHROME_HEADLESS_SHELL)
    }
    const localAppData = process.env.LOCALAPPDATA
    if (localAppData) {
      const pwRoot = path.join(localAppData, 'ms-playwright')
      if (fs.existsSync(pwRoot)) {
        let entries = []
        try {
          entries = fs.readdirSync(pwRoot, { withFileTypes: true })
        } catch {
          entries = []
        }
        const shells = entries
          .filter((e) => e.isDirectory() && e.name.startsWith('chromium_headless_shell-'))
          .map((e) => e.name)
          .sort()
        for (const dir of shells) {
          const exe = path.join(pwRoot, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe')
          if (fs.existsSync(exe)) candidates.push(exe)
          const exeLinux = path.join(pwRoot, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell')
          if (fs.existsSync(exeLinux)) candidates.push(exeLinux)
        }
      }
    }
    const pf = process.env['ProgramFiles']
    const pf86 = process.env['ProgramFiles(x86)']
    if (pf) {
      candidates.push(path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'))
      candidates.push(path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
    }
    if (pf86) {
      candidates.push(path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
      candidates.push(path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    }
    if (localAppData) {
      candidates.push(path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    }
    return candidates.find((p) => {
      try {
        return fs.existsSync(p)
      } catch {
        return false
      }
    })
  }

  function missingBrowserHelp() {
    return (
      `${label}: SKIP\n未找到可用浏览器。可用方式（按序）：\n` +
      '  1) 环境变量 CHROME_HEADLESS_SHELL 指向 chrome-headless-shell.exe\n' +
      '  2) %LOCALAPPDATA%/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-win64/chrome-headless-shell.exe\n' +
      '  3) %ProgramFiles%/Google/Chrome/Application/chrome.exe\n' +
      '  4) %ProgramFiles(x86)%/Microsoft/Edge/Application/msedge.exe'
    )
  }

  /* ── 1. 准备被量测页面（复制探针 + 生成 config/html） ────────────────────── */

  function prepareScratch(root, opts) {
    const { srcDir, files, probeEntry, scratchDir, define } = opts
    const scratch = path.join(root, 'out', scratchDir)
    fs.rmSync(scratch, { recursive: true, force: true })
    fs.mkdirSync(scratch, { recursive: true })

    for (const f of files) {
      fs.copyFileSync(path.join(srcDir, f), path.join(scratch, f))
    }

    const config = `import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'

const ROOT = ${JSON.stringify(root)}
const SCRATCH = ${JSON.stringify(scratch)}

// 与 vite.mobile.config.mjs 同构：同一个 root / 同一个 @ 别名 / 同一个 Tailwind+PostCSS 管线，
// 唯一差异是入口换成探针页（探针自己是「宿主入口的等价物」）。
export default {
  root: ROOT,
  base: './',
  publicDir: false,
  plugins: [react()],
  // 阈值注入：让驱动里用的数与本文件顶部 EXPECT 是同一份，杜绝「报告阈值 / 代码阈值」漂移
  define: ${JSON.stringify(define)},
  resolve: {
    alias: {
      '@': resolve(ROOT, 'src'),
      '@android-css': resolve(ROOT, 'mobile', 'android.css')
    }
  },
  build: {
    outDir: resolve(SCRATCH, 'dist'),
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    minify: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(SCRATCH, 'probe.html'),
      // 必须单块：file:// 下多块 ES module 会互相 import（被 CORS 拦）
      output: { inlineDynamicImports: true, manualChunks: undefined }
    }
  }
}
`
    fs.writeFileSync(path.join(scratch, 'vite.config.mjs'), config, 'utf8')

    // 探针 HTML 直接用仓库自己的 index.html（splash/body 的 inline 样式一并继承，
    // 不复制第二份 HTML —— 复制必然漂移），只替换入口脚本并补一个结果容器。
    const srcHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    let probeHtml = srcHtml.replace('/src/main.tsx', probeEntry)
    if (probeHtml === srcHtml) {
      fail(`FAIL\n未能把 index.html 的入口脚本替换为探针入口（期望匹配 /src/main.tsx）。`, 2)
    }
    probeHtml = probeHtml.replace('</body>', '<pre id="out" style="display:none"></pre>\n</body>')
    fs.writeFileSync(path.join(scratch, 'probe.html'), probeHtml, 'utf8')

    return scratch
  }

  /* ── 2. 构建 ──────────────────────────────────────────────────────────── */

  function buildProbe(root, scratch, browser) {
    const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
    if (!fs.existsSync(viteBin)) {
      fail(`SKIP\n未找到 vite：${viteBin}（待测目录需要可用的 node_modules）`, 2)
    }
    const args = [viteBin, 'build', '--config', path.join(scratch, 'vite.config.mjs')]
    log(`  root   : ${root}`)
    log(`  scratch: ${path.relative(root, scratch)}`)
    log(`  browser: ${browser}`)
    log(`  $ node ${path.relative(root, viteBin)} build --config ${path.relative(root, path.join(scratch, 'vite.config.mjs'))}   (timeout 300000ms)`)
    const t0 = Date.now()
    try {
      const out = execFileSync(process.execPath, args, {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 300000,
        killSignal: 'SIGKILL'
      })
      const tail = String(out).trim().split('\n').slice(-4).join('\n    ')
      log(`  build ok (${Date.now() - t0}ms)\n    ${tail}`)
    } catch (e) {
      const detail = `${e.stdout || ''}${e.stderr || ''}`.trim()
      fail(
        `FAIL\n探针页构建失败（${Date.now() - t0}ms）：${e.message}\n` + detail.split('\n').slice(-25).join('\n'),
        2
      )
    }

    const distDir = path.join(scratch, 'dist')
    const htmls = []
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith('.html')) htmls.push(p)
      }
    }
    walk(distDir)
    if (htmls.length !== 1) {
      fail(`FAIL\n期望恰好 1 个构建 HTML，实际 ${htmls.length} 个：${htmls.join(', ')}`, 2)
    }
    return htmls[0]
  }

  /* ── 3. 内联成自包含单页（file:// 下 ES module / <link crossorigin> 都会被拦） ── */

  function inlinePage(builtHtmlPath) {
    const dir = path.dirname(builtHtmlPath)
    let html = fs.readFileSync(builtHtmlPath, 'utf8')
    let inlinedScripts = 0
    let inlinedStyles = 0

    html = html.replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g, (m, src) => {
      if (/^https?:/.test(src)) return m
      inlinedScripts++
      return `<script type="module">\n${fs.readFileSync(path.resolve(dir, src), 'utf8')}\n</script>`
    })
    html = html.replace(/<link\b[^>]*\brel="stylesheet"[^>]*>/g, (m) => {
      const href = /href="([^"]+)"/.exec(m)
      if (!href || /^https?:/.test(href[1])) return m
      inlinedStyles++
      return `<style>\n${fs.readFileSync(path.resolve(dir, href[1]), 'utf8')}\n</style>`
    })

    if (inlinedScripts === 0) {
      fail('FAIL\n构建 HTML 里没有可内联的入口脚本 —— file:// 下无法加载。', 2)
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-gate-'))
    const outPath = path.join(tmpDir, 'probe.html')
    fs.writeFileSync(outPath, html, 'utf8')
    log(`  inlined: script×${inlinedScripts} style×${inlinedStyles} → ${outPath}`)
    return { tmpDir, outPath }
  }

  /* ── 4. 量测 ──────────────────────────────────────────────────────────── */

  function measure(browser, pagePath, tmpDir, viewport, opts) {
    const { w, h } = viewport
    const extra = (opts && opts.extraArgs) || []
    const args = [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      // 已知偏差（对判定方向安全，故不抹平）：桌面版 Chromium 的经典滚动条被
      // `scrollbar-gutter: stable` 预留 6px，令可用内容宽比真机更窄（安卓侧实测 342px，
      // 真机叠加滚动条 348px）。真机更宽 ⇒ 所有「宽 / 条数」类断言更保守，
      // 不会出现「真机不过、门禁却过」。曾试 `--enable-features=OverlayScrollbar` 抹平，
      // 实测无效（内容宽仍 342px），已移除，以免让人误以为 CI 里量到的是真机值。
      ...extra,
      `--window-size=${w},${h}`,
      `--user-data-dir=${path.join(tmpDir, 'profile')}`,
      // 探针里有多段 React 渲染 + 等待；虚拟时间预算让 --dump-dom 等到结果写进 <pre>
      '--virtual-time-budget=30000',
      '--dump-dom',
      pathToFileURL(pagePath).href
    ]
    log(`  $ ${path.basename(browser)} --headless --window-size=${w},${h} --virtual-time-budget=30000 --dump-dom file://.../probe.html   (timeout 120000ms)`)
    const t0 = Date.now()
    let dump = ''
    let execErr = null
    try {
      dump = execFileSync(browser, args, {
        encoding: 'utf8',
        maxBuffer: 512 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120000,
        killSignal: 'SIGKILL'
      })
    } catch (e) {
      execErr = e
      dump = (e.stdout || '').toString()
    }
    log(`  measured in ${Date.now() - t0}ms（DOM ${dump.length} 字节）`)
    if (!dump) {
      fail(
        'FAIL\n浏览器未产出任何 DOM：' + (execErr ? execErr.message : '未知原因') +
          '\nstderr: ' + ((execErr && execErr.stderr) || '').toString().slice(0, 800),
        2
      )
    }
    const m = dump.match(/<pre id="out"[^>]*>([\s\S]*?)<\/pre>/)
    if (!m) {
      fail('FAIL\n未能从浏览器 DOM 里读回 <pre id="out"> 量测结果（探针可能在渲染期抛错）。', 1)
    }
    const raw = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    try {
      return JSON.parse(raw)
    } catch (e) {
      fail(`FAIL\n量测结果 JSON 解析失败：${e.message}\n原文：${raw.slice(0, 600)}`, 1)
    }
  }

  return { log, fail, findBrowser, missingBrowserHelp, uniqueScratch, prepareScratch, buildProbe, inlinePage, measure }
}

module.exports = { createHarness }
