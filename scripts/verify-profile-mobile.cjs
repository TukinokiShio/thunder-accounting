#!/usr/bin/env node
/**
 * verify-profile-mobile.cjs —— 「我的」页（安卓本机账本）的三条真机反馈的**几何**门禁。
 *
 * 为什么单独一道、为什么必须是真浏览器：
 *   真机反馈里两条是纯几何量（语言入口被裁在屏幕外 / 页面约 70% 空白），而 jsdom 没有排版引擎
 *   —— `scrollWidth`、`clientWidth`、`getBoundingClientRect()` 恒为 0，在 vitest 里写这类断言是
 *   **不可能失败的空断言**。所以这里用「真组件 + 真构建 CSS + 412×915 无头 Chromium」量。
 *   （结构侧的断言在 `src/pages/Profile.local-mode.test.tsx`，两层互补、不重复。）
 *
 * 本脚本只负责「驱动 + 判定 + 报告」；构建与浏览器量测链路复用
 * `scripts/lib/layout-harness.cjs`（与另两道门禁共用一份，避免环境处理代码漂移）。
 * 被量测页面与判据在 `scripts/profile-gate/`：
 *   profile-probe.tsx   入口页（装 API 替身 + 打 platform-android + 装 android.css）
 *   profile-driver.ts   6 条几何/行为断言与量测
 * 本文件顶部的 EXPECT 是阈值的**单一事实源**：经 vite `define` 注入 `__PROFILE_GATE_EXPECT__`。
 * 另有 1 条源码级佐证（P0s，运行时量不到「规则不存在」）。
 *
 * 用法：
 *   node scripts/verify-profile-mobile.cjs                    # 量测本仓库
 *   node scripts/verify-profile-mobile.cjs --json out/p.json  # 落盘原始量测
 *
 * 退出码：
 *   0 = 7 条全 PASS
 *   1 = 有断言 FAIL
 *   2 = 环境未就绪（缺 node_modules / 构建失败 / 找不到浏览器 / 安卓视口自检不成立）
 *
 * ⚠ 为什么没有接进 `package.json` 的 npm scripts：`package.json` 正被另一位 worker 改
 * （typecheck scripts 接线），并发写同一个文件会把对方的改动覆盖掉。这里的定位是
 * 「可独立执行的验证脚本」，接线由团队统一决定（`node scripts/verify-profile-mobile.cjs`）。
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createHarness } = require('./lib/layout-harness.cjs')

const SCRIPT_DIR = __dirname
const GATE_SRC_DIR = path.join(SCRIPT_DIR, 'profile-gate')
const LABEL = 'VERIFY_PROFILE_MOBILE'
const harness = createHarness(LABEL)

/** 与 `scripts/verify-android-layout.cjs` 同一台参考设备（Pixel 8 竖屏逻辑视口） */
const VIEWPORT_W = 412
const VIEWPORT_H = 915

/** 阈值（**单一事实源**；改这里等于改门禁，必须同步报告） */
const EXPECT = {
  /**
   * 内容高度下限（占可用内容带的比例）。真机反馈是「页面约 70% 空白」：旧版单个 Tab 面板
   * 只有约 200px 内容 / 约 795px 内容带 ≈ 25%。60% 是「首屏基本被真实内容填满」的门槛，
   * 当前实现实测约 130%（见报告 actual），余量足够但不宽松到失去约束力。
   */
  contentRatio: 0.6
}

const CHECK_ORDER = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']

function fail(msg, code) {
  console.error(`${LABEL}: ${msg}`)
  process.exit(code)
}

const log = (...a) => console.log(...a)

function canonDir(p) {
  const r = path.resolve(p)
  try {
    return fs.realpathSync.native(r)
  } catch {
    return r
  }
}

function parseArgs(argv) {
  const out = { root: canonDir(path.resolve(SCRIPT_DIR, '..')), json: null }
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--root') out.root = canonDir(argv[++i])
    else if (argv[i] === '--json') out.json = argv[++i]
  }
  return out
}

function preflight(root) {
  const need = ['node_modules', 'index.html', 'src', 'src/App.tsx', 'mobile/android.css', 'postcss.config.js']
  const missing = need.filter((p) => !fs.existsSync(path.join(root, p)))
  if (missing.length > 0) {
    fail(`SKIP\n待测目录缺少必要文件：${missing.join(', ')}\n  root = ${root}`, 2)
  }
}

/**
 * 源码级佐证：`mobile/android.css` 里不得再有 `.profile-nav` 规则。
 *
 * 覆盖不到的部分交给运行时：`Profile.tsx` 里**桌面**分支仍合法地使用 `.profile-nav`
 * （桌面 5 Tab 版式逐位不变，不许删），所以「该 class 是否出现」在源码层不是一个有效判据。
 * 真正要钉的是**运行时安卓页面上它不存在** —— 那是 P6 的判据（`.profile-nav 数=0` +
 * 面板内 nav 数=0）。这里只钉「那条横向滚动的窄屏规则已经从源码消失」。
 */
function staticChecks(root) {
  const out = []
  // 剥注释：这次的修法本身要在注释里解释来龙去脉，注释里必然出现 `.profile-nav` 字样。
  // 若把注释也算进判据，就会得到「解释修法 ⇒ 门禁判失败」的荒谬结论（实测踩到）。
  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  const cssPath = path.join(root, 'mobile', 'android.css')
  const rawCss = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : ''
  const css = stripComments(rawCss)
  out.push({
    id: 'P0s',
    title: '源码：`mobile/android.css` 不再含 .profile-nav 规则（横向滚动那条窄屏规则已从源码消失）',
    pass: !css.includes('.profile-nav'),
    actual: `android.css（已剥注释）含 .profile-nav = ${css.includes('.profile-nav')}`,
    threshold: '.profile-nav 出现在**规则**里 = false（只允许出现在注释里）',
    detail: `剥注释是否真的生效的对照：原文里含 .profile-nav = ${rawCss.includes('.profile-nav')}（为 true 说明该字样确实只在注释里）`
  })
  return out
}

function printReport(report, sourceChecks) {
  const pad = (s, n) => String(s).padEnd(n, ' ')
  const env = report.env || {}
  const band = env.band || {}

  log('')
  log('── 环境自检（不成立即说明量到的不是安卓布局）──────────────────────')
  log(`  逻辑视口          : ${report.viewport?.w}×${report.viewport?.h}（期望 ${VIEWPORT_W}×${VIEWPORT_H}）`)
  log(`  <html> class      : ${JSON.stringify(env.htmlClass)}`)
  log(`  platform-android  : ${env.platformAndroid}`)
  log(`  body overscroll-y : ${JSON.stringify(env.bodyOverscrollY)}（android.css 命中则为 "none"）`)
  log(`  main padding-bottom: ${env.mainPaddingBottom}（android.css 命中则 ≥ 56px；桌面为 20px）`)
  log(`  可用内容带        : [${band.top}, ${band.bottom}] 高 ${band.height}px（口径：${band.label}）`)
  log(`  语言切换器 rect   : ${JSON.stringify(env.switcherRect)}`)
  log(`  本机面板存在      : ${env.hasLocalProfilePanel}`)
  log('')
  log(`── ${CHECK_ORDER.length + sourceChecks.length} 条断言 ─────────────────────────────────────────`)
  const all = [...(report.checks || []), ...sourceChecks]
  all.sort((a, b) => {
    const ai = a.id === 'P0s' ? -1 : CHECK_ORDER.indexOf(a.id)
    const bi = b.id === 'P0s' ? -1 : CHECK_ORDER.indexOf(b.id)
    return ai - bi
  })
  for (const c of all) {
    log(`${c.pass ? 'PASS' : 'FAIL'}  ${pad(c.id, 4)} ${c.title}`)
    log(`        实际: ${c.actual}`)
    log(`        阈值: ${c.threshold}`)
    if (c.detail) log(`        细节: ${c.detail}`)
  }
  log('')
  return all.filter((c) => !c.pass)
}

function main() {
  const { root, json } = parseArgs(process.argv)
  log(`${LABEL} —— 「我的」页（安卓本机账本）几何门禁`)
  preflight(root)

  const browser = harness.findBrowser()
  if (!browser) fail(harness.missingBrowserHelp(), 2)

  const scratch = harness.prepareScratch(root, {
    srcDir: GATE_SRC_DIR,
    files: ['profile-probe.tsx', 'profile-driver.ts'],
    probeEntry: './profile-probe.tsx',
    scratchDir: harness.uniqueScratch('profile-gate'),
    define: { __PROFILE_GATE_EXPECT__: JSON.stringify(EXPECT) }
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

  const sourceChecks = staticChecks(root)
  const failed = printReport(report, sourceChecks)
  const total = report.checks.length + sourceChecks.length

  if (json) {
    const p = path.resolve(process.cwd(), json)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify({ root, viewport: { w: VIEWPORT_W, h: VIEWPORT_H }, report, sourceChecks }, null, 2), 'utf8')
    log(`原始量测 JSON：${p}`)
  }

  // 环境自检：平台类与 android.css 的生效证据必须成立，否则量到的是桌面布局
  const env = report.env || {}
  const viewportOk = report.viewport && report.viewport.w === VIEWPORT_W && report.viewport.h === VIEWPORT_H
  const platformOk = env.platformAndroid === true
  const cssApplied = env.bodyOverscrollY === 'none' || Number(env.mainPaddingBottom) >= 56
  const panelOk = env.hasLocalProfilePanel === true
  if (!viewportOk || !platformOk || !cssApplied || !panelOk) {
    fail(
      `${LABEL}: SKIP\n安卓视口/平台类/本机面板自检不成立 —— 量到的不是本次要验的布局，结论无效：\n` +
        `  viewport=${JSON.stringify(report.viewport)}（期望 ${VIEWPORT_W}×${VIEWPORT_H}）\n` +
        `  platform-android=${JSON.stringify(env.platformAndroid)}\n` +
        `  body overscroll-y=${JSON.stringify(env.bodyOverscrollY)}  main padding-bottom=${JSON.stringify(env.mainPaddingBottom)}\n` +
        `  本机面板 [data-testid="local-profile"] 存在=${JSON.stringify(env.hasLocalProfilePanel)}\n` +
        `  文本抽样=${JSON.stringify(env.textSample)}`,
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
