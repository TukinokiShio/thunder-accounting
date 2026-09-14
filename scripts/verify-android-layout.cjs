#!/usr/bin/env node
/**
 * verify-android-layout.cjs —— 安卓端四个板块布局重排的「可执行行为级门禁」。
 *
 * 动机：这一轮重排（首页/账单/统计/分类管理/个人中心）的依据是一批**实测数字**。
 * 数字只留在报告里就会静默回归；本脚本把 8 条数字变成断言，任何一条破了就非 0 退出。
 *
 * 为什么不是 jsdom / vitest：jsdom 没有排版引擎，`scrollHeight`、`getBoundingClientRect`
 * 恒为 0，vitest 恒绿 —— 而这 8 条断言 7 条是几何。所以这里必须用**真实构建 CSS + 真浏览器**。
 *
 * 为什么不是「跑真安卓包」：那要模拟器 + Gradle（分钟级、且本机才有）。这里改为
 * 「真实组件 + 真实构建 CSS + 模拟安卓视口」：在无头 Chromium 里以 412×915 加载一个
 * 探针页，探针用**确定性内存夹具**替换 `window.electronAPI`（AppAPI 契约），渲染真 `src/`。
 * 量测链路与 `mobile/main.tsx` 对齐的三点（少任何一点量到的都是桌面布局）：
 *   ① 先装宿主 API 替身；② 给 <html> 打 `platform-android`；③ android.css 先于 index.css。
 * 这三点的成立有**运行时自检**（见 env.platformAndroid / env.bodyOverscrollY / env.mainPaddingBottom），
 * 一旦不成立直接按「环境未就绪」退出 —— 门禁不允许在桌面布局上量出「安卓布局通过」。
 *
 * 设计约束（沿用 verify-modal-scope.cjs 的踩坑结论）：
 *  - 只依赖 Node 内置模块，不新增依赖。
 *  - **不要改成「同进程 HTTP 服务」**：execFileSync 会同步阻塞事件循环，同进程 http server
 *    永远无法响应，浏览器一直等文档 → 互锁死锁（无报错无超时）。这里用 `file://` +
 *    内联 CSS/JS 的单页（实测整轮 ~12s）。
 *  - `file://` 下 ES module 会被 CORS 拦、`<link crossorigin>` 会加载失败 → 构建产物必须内联。
 *  - 每个外部调用都带 `{ timeout, killSignal: 'SIGKILL' }`，并在调用前打印上下文。
 *  - 不写 pack 产物目录（`app-out/` / `dist-android/`）；中间产物只落 `<root>/out/layout-gate/`
 *    （`out/` 已在 .gitignore 内）。
 *
 * 用法：
 *   node scripts/verify-android-layout.cjs                     # 量测本仓库
 *   node scripts/verify-android-layout.cjs --root ../某目录     # 量测别的检出（用于负对照）
 *   node scripts/verify-android-layout.cjs --json out/report.json
 *
 * 退出码：
 *   0 = 8 条全 PASS
 *   1 = 有断言 FAIL
 *   2 = 环境未就绪（缺 node_modules / 构建失败 / 找不到浏览器 / 安卓视口自检不成立）
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const { execFileSync } = require('node:child_process')

const SCRIPT_DIR = __dirname
const GATE_SRC_DIR = path.join(SCRIPT_DIR, 'android-layout-gate')

/* ── 契约常量（都是重排前后实测出来的数；改这里等于改门禁，必须同步报告） ── */
const VIEWPORT_W = 412
const VIEWPORT_H = 915
const EXPECT = {
  billsFirstScreenRows: 9,
  billNameColWidth: 200,
  statsScrollHeight: 1400,
  chartAnimationDuration: 300,
  /** 已渲染图表数的**下限**：重排前 3 个、重排后 2 个（去重复时合掉了一个环形图），
   *  所以这里只保证「图表确实渲染了」，不钉死个数 —— 钉死 3 会把正确的重排判成失败。 */
  chartCount: 2,
  homeCardUnionHeight: 340
}

function fail(msg, code) {
  console.error(msg)
  process.exit(code)
}

function log(...a) {
  console.log(...a)
}

/* ── 0. 参数与前置检查 ─────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const out = { root: path.resolve(SCRIPT_DIR, '..'), json: null }
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--root') out.root = path.resolve(argv[++i])
    else if (argv[i] === '--json') out.json = argv[++i]
  }
  return out
}

function preflight(root) {
  const need = ['node_modules', 'index.html', 'src', 'src/App.tsx', 'mobile/android.css', 'postcss.config.js']
  const missing = need.filter((p) => !fs.existsSync(path.join(root, p)))
  if (missing.length > 0) {
    fail(
      `VERIFY_ANDROID_LAYOUT: SKIP\n待测目录缺少必要文件：${missing.join(', ')}\n  root = ${root}`,
      2
    )
  }
}

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

/* ── 1. 准备被量测页面（复制探针 + 生成 config/html） ────────────────────────── */

function prepareScratch(root) {
  const scratch = path.join(root, 'out', 'layout-gate')
  fs.rmSync(scratch, { recursive: true, force: true })
  fs.mkdirSync(scratch, { recursive: true })

  for (const f of ['android-layout-probe.tsx', 'android-layout-driver.ts', 'android-layout-fixture.ts']) {
    fs.copyFileSync(path.join(GATE_SRC_DIR, f), path.join(scratch, f))
  }

  const config = `import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'

const ROOT = ${JSON.stringify(root)}
const SCRATCH = ${JSON.stringify(scratch)}

// 与 vite.mobile.config.mjs 同构：同一个 root / 同一个 @ 别名 / 同一个 Tailwind+PostCSS 管线，
// 唯一差异是入口换成探针页（探针自己是「mobile/main.tsx 的等价物」）。
export default {
  root: ROOT,
  base: './',
  publicDir: false,
  plugins: [react()],
  // 阈值注入：让驱动里用的数与本文件顶部 EXPECT 是同一份，杜绝「报告阈值 / 代码阈值」漂移
  define: { __GATE_EXPECT__: ${JSON.stringify(JSON.stringify(EXPECT))} },
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
  let probeHtml = srcHtml.replace('/src/main.tsx', './android-layout-probe.tsx')
  if (probeHtml === srcHtml) {
    fail('VERIFY_ANDROID_LAYOUT: FAIL\n未能把 index.html 的入口脚本替换为探针入口（期望匹配 /src/main.tsx）。', 2)
  }
  probeHtml = probeHtml.replace('</body>', '<pre id="out" style="display:none"></pre>\n</body>')
  fs.writeFileSync(path.join(scratch, 'probe.html'), probeHtml, 'utf8')

  return scratch
}

/* ── 2. 构建 ──────────────────────────────────────────────────────────────── */

function buildProbe(root, scratch, browser) {
  const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
  if (!fs.existsSync(viteBin)) {
    fail(`VERIFY_ANDROID_LAYOUT: SKIP\n未找到 vite：${viteBin}（待测目录需要可用的 node_modules）`, 2)
  }
  const args = [viteBin, 'build', '--config', path.join(scratch, 'vite.config.mjs')]
  log(`  root   : ${root}`)
  log(`  scratch: ${path.relative(root, scratch)}`)
  log(`  browser: ${browser}`)
  log(`  $ node ${path.relative(root, viteBin)} build --config out/layout-gate/vite.config.mjs   (timeout 300000ms)`)
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
    const tail = String(out).trim().split('\n').slice(-6).join('\n    ')
    log(`  build ok (${Date.now() - t0}ms)\n    ${tail}`)
  } catch (e) {
    const detail = `${e.stdout || ''}${e.stderr || ''}`.trim()
    fail(
      `VERIFY_ANDROID_LAYOUT: FAIL\n探针页构建失败（${Date.now() - t0}ms）：${e.message}\n` +
        detail.split('\n').slice(-25).join('\n'),
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
    fail(`VERIFY_ANDROID_LAYOUT: FAIL\n期望恰好 1 个构建 HTML，实际 ${htmls.length} 个：${htmls.join(', ')}`, 2)
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
    fail('VERIFY_ANDROID_LAYOUT: FAIL\n构建 HTML 里没有可内联的入口脚本 —— file:// 下无法加载。', 2)
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'android-layout-gate-'))
  const outPath = path.join(tmpDir, 'probe.html')
  fs.writeFileSync(outPath, html, 'utf8')
  log(`  inlined: script×${inlinedScripts} style×${inlinedStyles} → ${outPath}`)
  return { tmpDir, outPath }
}

/* ── 4. 量测 ─────────────────────────────────────────────────────────────── */

function measure(browser, pagePath, tmpDir) {
  const args = [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    // 已知偏差（对判定方向安全，故不抹平）：安卓 WebView 用叠加式滚动条（宽 0），
    // 可用内容宽是 348px；桌面版 Chromium 的经典滚动条被 `scrollbar-gutter: stable`
    // 预留 6px，实测内容宽 342px。342 < 348，量到的比真机更窄 ⇒ 所有「宽 / 条数」类
    // 断言更保守，不会出现「真机不过、门禁却过」。曾试 `--enable-features=OverlayScrollbar`
    // 抹平，实测无效（内容宽仍 342px），已移除，以免让人误以为 CI 里量到的是 348。
    `--window-size=${VIEWPORT_W},${VIEWPORT_H}`,
    `--user-data-dir=${path.join(tmpDir, 'profile')}`,
    // 探针里有多段 React 渲染 + 等待；虚拟时间预算让 --dump-dom 等到结果写进 <pre>
    '--virtual-time-budget=30000',
    '--dump-dom',
    pathToFileURL(pagePath).href
  ]
  log(`  $ ${path.basename(browser)} --headless --window-size=${VIEWPORT_W},${VIEWPORT_H} --virtual-time-budget=30000 --dump-dom file://.../probe.html   (timeout 120000ms)`)
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
      'VERIFY_ANDROID_LAYOUT: FAIL\n浏览器未产出任何 DOM：' + (execErr ? execErr.message : '未知原因') +
        '\nstderr: ' + ((execErr && execErr.stderr) || '').toString().slice(0, 800),
      2
    )
  }
  const m = dump.match(/<pre id="out"[^>]*>([\s\S]*?)<\/pre>/)
  if (!m) {
    fail(
      'VERIFY_ANDROID_LAYOUT: FAIL\n未能从浏览器 DOM 里读回 <pre id="out"> 量测结果（探针可能在渲染期抛错）。',
      1
    )
  }
  const raw = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  try {
    return JSON.parse(raw)
  } catch (e) {
    fail(`VERIFY_ANDROID_LAYOUT: FAIL\n量测结果 JSON 解析失败：${e.message}\n原文：${raw.slice(0, 600)}`, 1)
  }
}

/* ── 5. 源码级断言（运行时读不到的，用源码断言补齐） ───────────────────────── */

function staticChecks(root) {
  const out = []
  const statsPath = path.join(root, 'src', 'pages', 'Stats.tsx')
  if (!fs.existsSync(statsPath)) {
    out.push({ id: 'A4s', title: 'Stats.tsx 源码：animationDuration={300}', pass: false, actual: '未找到 src/pages/Stats.tsx', threshold: '-' })
    return out
  }
  const src = fs.readFileSync(statsPath, 'utf8')
  const all = src.match(/animationDuration\s*=/g) || []
  // `animationDuration={300}` 与 `animationDuration={CHART_ANIM_DURATION}`（常量=300）都算；
  // 后者是本项目既有的写法（Stats.test.tsx:217-224 也按这个形态设了 vitest 断言）。
  const usages = [...src.matchAll(/animationDuration\s*=\s*\{\s*([A-Za-z_$][\w$]*|\d+)\s*\}/g)].map((m) => m[1])
  const resolved = usages.map((v) => {
    if (/^\d+$/.test(v)) return Number(v)
    const decl = new RegExp(`(?:const|let|var)\\s+${v}\\s*=\\s*(\\d+)`).exec(src)
    return decl ? Number(decl[1]) : NaN
  })
  const wrong = resolved.filter((v) => v !== EXPECT.chartAnimationDuration)
  out.push({
    id: 'A4s',
    title: 'Stats.tsx 源码：每个 animationDuration 都解析为 300（静态佐证）',
    pass: usages.length >= EXPECT.chartCount && wrong.length === 0 && usages.length === all.length,
    actual: `animationDuration 共 ${all.length} 处，解析出取值 ${JSON.stringify(resolved)}（引用变量：${JSON.stringify(usages.filter((v) => !/^\d+$/.test(v)))}）`,
    threshold: `处数 ≥ ${EXPECT.chartCount}、每处都解析为 ${EXPECT.chartAnimationDuration}、且没有解析不到的写法`
  })
  return out
}

/* ── 6. 报告 ─────────────────────────────────────────────────────────────── */

function printReport(report, sourceChecks) {
  const pad = (s, n) => String(s).padEnd(n, ' ')
  const env = report.env || {}

  log('')
  log('── 环境自检（不成立即说明量到的不是安卓布局）──────────────────────')
  log(`  逻辑视口          : ${report.viewport?.w}×${report.viewport?.h}（期望 ${VIEWPORT_W}×${VIEWPORT_H}）`)
  log(`  <html> class      : ${JSON.stringify(env.htmlClass)}`)
  log(`  platform-android  : ${env.platformAndroid}`)
  log(`  body overscroll-y : ${JSON.stringify(env.bodyOverscrollY)}（android.css 命中则为 "none"）`)
  log(`  main padding-bottom: ${env.mainPaddingBottom}（android.css 命中则 ≥ 56px；桌面为 20px）`)
  log(`  内容宽 / 内容带    : ${env.contentWidth}px / ${env.bandHeight}px`)
  log(`  滚动容器          : ${JSON.stringify(env.scrollContainer)}`)
  log(`  底部悬浮层顶       : ${JSON.stringify(env.overlayTops)}`)
  log(`  合成点击自检       : ${env.clickMechanism && env.clickMechanism.ok ? 'ok' : '未通过'} —— ${env.clickMechanism ? env.clickMechanism.detail : '(缺)'}`)
  log('')
  log('── 8 条断言 ──────────────────────────────────────────────────────')
  const all = [...(report.checks || []), ...sourceChecks]
  const order = ['A1', 'A2', 'A3', 'A4', 'A4s', 'A5', 'A6', 'A7', 'A8']
  all.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
  for (const c of all) {
    log(`${c.pass ? 'PASS' : 'FAIL'}  ${pad(c.id, 4)} ${c.title}`)
    log(`        实际: ${c.actual}`)
    log(`        阈值: ${c.threshold}`)
    if (c.detail) log(`        细节: ${c.detail}`)
  }
  log('')
  const failed = all.filter((c) => !c.pass)
  return failed
}

/* ── main ────────────────────────────────────────────────────────────────── */

function main() {
  const { root, json } = parseArgs(process.argv)
  log('VERIFY_ANDROID_LAYOUT —— 安卓端布局行为级门禁')
  preflight(root)

  const browser = findBrowser()
  if (!browser) {
    fail(
      'VERIFY_ANDROID_LAYOUT: SKIP\n未找到可用浏览器。可用方式（按序）：\n' +
        '  1) 环境变量 CHROME_HEADLESS_SHELL 指向 chrome-headless-shell.exe\n' +
        '  2) %LOCALAPPDATA%/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-win64/chrome-headless-shell.exe\n' +
        '  3) %ProgramFiles%/Google/Chrome/Application/chrome.exe\n' +
        '  4) %ProgramFiles(x86)%/Microsoft/Edge/Application/msedge.exe',
      2
    )
  }

  const scratch = prepareScratch(root)
  const builtHtml = buildProbe(root, scratch, browser)
  const { tmpDir, outPath } = inlinePage(builtHtml)

  let report
  try {
    report = measure(browser, outPath, tmpDir)
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* 临时目录清理失败可忽略 */
    }
  }

  if (report && report.fatal) {
    fail(`VERIFY_ANDROID_LAYOUT: FAIL\n探针页执行失败：${report.fatal}`, 1)
  }
  if (!report || !Array.isArray(report.checks) || report.checks.length === 0) {
    fail('VERIFY_ANDROID_LAYOUT: FAIL\n量测结果里没有任何断言条目。', 1)
  }

  // 环境自检：平台类与 android.css 的生效证据必须成立，否则量到的是桌面布局
  const env = report.env || {}
  const viewportOk = report.viewport && report.viewport.w === VIEWPORT_W && report.viewport.h === VIEWPORT_H
  const platformOk = env.platformAndroid === true
  const cssApplied = env.bodyOverscrollY === 'none' || Number(env.mainPaddingBottom) >= 56

  const sourceChecks = staticChecks(root)
  const failed = printReport(report, sourceChecks)
  const total = report.checks.length + sourceChecks.length

  if (json) {
    const p = path.resolve(process.cwd(), json)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify({ root, viewport: { w: VIEWPORT_W, h: VIEWPORT_H }, report, sourceChecks }, null, 2), 'utf8')
    log(`原始量测 JSON：${p}`)
  }

  if (!viewportOk || !platformOk || !cssApplied) {
    fail(
      'VERIFY_ANDROID_LAYOUT: SKIP\n安卓视口/平台类自检不成立 —— 量到的不是安卓布局，门禁结论无效：\n' +
        `  viewport=${JSON.stringify(report.viewport)}（期望 ${VIEWPORT_W}×${VIEWPORT_H}）\n` +
        `  platform-android=${JSON.stringify(env.platformAndroid)}\n` +
        `  body overscroll-y=${JSON.stringify(env.bodyOverscrollY)}  main padding-bottom=${JSON.stringify(env.mainPaddingBottom)}\n` +
        `  html class=${JSON.stringify(env.htmlClass)}`,
      2
    )
  }

  // 机制自检：A6/A7 靠「合成点击 → React 事件」下结论。若点击根本无效，两条断言会假失败。
  if (!env.clickMechanism || env.clickMechanism.ok !== true) {
    fail(
      'VERIFY_ANDROID_LAYOUT: SKIP\n合成点击机制自检未通过 —— A6/A7 的结论不可信：\n' +
        `  ${env.clickMechanism ? env.clickMechanism.detail : '(缺少自检结果)'}`,
      2
    )
  }

  if (failed.length > 0) {
    log(`VERIFY_ANDROID_LAYOUT: FAIL —— ${failed.length}/${total} 条断言未通过（${failed.map((f) => f.id).join(', ')}）`)
    process.exit(1)
  }
  log(`VERIFY_ANDROID_LAYOUT: PASS —— ${total} 条断言全部通过`)
  process.exit(0)
}

main()
