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
 * 本脚本只负责「驱动 + 判定 + 报告」；构建与浏览器量测链路在 `scripts/lib/layout-harness.cjs`
 * （与桌面视口比对门禁 `verify-desktop-parity.cjs` 共用一份，避免环境处理代码漂移）。
 * 被量测的探针与夹具在 `scripts/layout-gate/`：
 *   fixture.ts        确定性内存夹具（**两个门禁共用同一份**，保证两侧内容逐字相同）
 *   android-probe.tsx 入口页（打 platform-android + 装 android.css）
 *   android-driver.ts 断言与量测
 * 本文件顶部的 EXPECT 是阈值的**单一事实源**：经 vite `define` 注入 `__GATE_EXPECT__` 给驱动。
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
const { createHarness } = require('./lib/layout-harness.cjs')

const SCRIPT_DIR = __dirname
const GATE_SRC_DIR = path.join(SCRIPT_DIR, 'layout-gate')
const LABEL = 'VERIFY_ANDROID_LAYOUT'
const harness = createHarness(LABEL)

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
      `${LABEL}: SKIP\n待测目录缺少必要文件：${missing.join(', ')}\n  root = ${root}`,
      2
    )
  }
}

/* ── 源码级断言（运行时读不到的，用源码断言补齐） ───────────────────────── */

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

/* ── 报告 ────────────────────────────────────────────────────────────────── */

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
  return all.filter((c) => !c.pass)
}

/* ── main ────────────────────────────────────────────────────────────────── */

function main() {
  const { root, json } = parseArgs(process.argv)
  log(`${LABEL} —— 安卓端布局行为级门禁`)
  preflight(root)

  const browser = harness.findBrowser()
  if (!browser) fail(harness.missingBrowserHelp(), 2)

  const scratch = harness.prepareScratch(root, {
    srcDir: GATE_SRC_DIR,
    files: ['android-probe.tsx', 'android-driver.ts', 'fixture.ts'],
    probeEntry: './android-probe.tsx',
    scratchDir: 'layout-gate',
    define: { __GATE_EXPECT__: JSON.stringify(EXPECT) }
  })
  const builtHtml = harness.buildProbe(root, scratch, browser)
  const { tmpDir, outPath } = harness.inlinePage(builtHtml)

  let report
  try {
    report = harness.measure(browser, outPath, tmpDir, { w: VIEWPORT_W, h: VIEWPORT_H })
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* 临时目录清理失败可忽略 */
    }
  }

  if (report && report.fatal) {
    fail(`${LABEL}: FAIL\n探针页执行失败：${report.fatal}`, 1)
  }
  if (!report || !Array.isArray(report.checks) || report.checks.length === 0) {
    fail(`${LABEL}: FAIL\n量测结果里没有任何断言条目。`, 1)
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
      `${LABEL}: SKIP\n安卓视口/平台类自检不成立 —— 量到的不是安卓布局，门禁结论无效：\n` +
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
      `${LABEL}: SKIP\n合成点击机制自检未通过 —— A6/A7 的结论不可信：\n` +
        `  ${env.clickMechanism ? env.clickMechanism.detail : '(缺少自检结果)'}`,
      2
    )
  }

  if (failed.length > 0) {
    log(`${LABEL}: FAIL —— ${failed.length}/${total} 条断言未通过（${failed.map((f) => f.id).join(', ')}）`)
    process.exit(1)
  }
  log(`${LABEL}: PASS —— ${total} 条断言全部通过`)
  process.exit(0)
}

main()
