#!/usr/bin/env node
/**
 * verify-recurring-dialog.cjs —— 周期支出 / 记一笔 弹窗版式门禁。
 *
 * 动机（2026-09-19 用户截图）：三类缺陷此前都是**肉眼发现**的，且其中两条属于
 * 「全局样式命中组件」的回归族（§25 同族）：`.aurora-shell input{width:100%;min-height:42px}`
 * 命中 checkbox ⇒ 巨型复选框 + 标签竖排；`.recurring-form-dialog` 缺 width 规则 ⇒ 弹窗塌缩；
 * Chromium 自动填充把输入框刷成浅蓝块。**这类缺陷源码级断言看不见，jsdom 也测不出几何**，
 * 因此必须用「真实组件 + 真实构建 CSS + 真浏览器」量测，并把判据固化成断言。
 *
 * 断言（细节见 scripts/layout-gate/recurring-driver.ts）：
 *   R1 周期规则弹窗宽度 = 30rem 骨架（不塌缩）
 *   R2 定投复选框尺寸正常（不被全局 input 规则撑大）
 *   R3 记一笔 → 周期模块：复选框正常 + 标签未被挤成竖排
 *   R4 支付平台可自由输入
 *   R5 资金账户：≥5 个快选芯片且点击可填入
 *   R6 记一笔（周期模块）内容区无横向溢出
 *   R7 周期规则弹窗内容区无横向溢出
 *   R8 负对照：禁掉宽度规则必须复现塌缩（否则 R1 是不可能失败的假断言）
 *
 * 用法：
 *   node scripts/verify-recurring-dialog.cjs
 *   node scripts/verify-recurring-dialog.cjs --json out/recurring-dialog-report.json
 *
 * 退出码：0 = 全 PASS；1 = 有 FAIL；2 = 环境未就绪 / 自检不成立
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createHarness } = require('./lib/layout-harness.cjs')

const SCRIPT_DIR = __dirname
const GATE_SRC_DIR = path.join(SCRIPT_DIR, 'layout-gate')
const LABEL = 'VERIFY_RECURRING_DIALOG'
const harness = createHarness(LABEL)

/* ── 契约常量（阈值的单一事实源；改这里等于改门禁，必须同步报告） ── */
const VIEWPORT_W = 1280
const VIEWPORT_H = 900
const EXPECT = {
  /** 30rem @ rootFont 16px = 480（与 index.css 的 .recurring-form-dialog 规则一致） */
  dialogWidth: 480,
  /** 塌缩判据：低于此值即视为「跟着内容走」（实测塌缩时约 270~330px） */
  minDialogWidth: 440,
  maxCheckboxPx: 24,
  minChips: 5
}

function fail(msg, code) {
  console.error(msg)
  process.exit(code)
}

function log(...a) {
  console.log(...a)
}

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
  const need = ['node_modules', 'index.html', 'src', 'src/index.css', 'src/App.tsx', 'postcss.config.js']
  const missing = need.filter((p) => !fs.existsSync(path.join(root, p)))
  if (missing.length > 0) {
    fail(`${LABEL}: SKIP\n待测目录缺少必要文件：${missing.join(', ')}\n  root = ${root}`, 2)
  }
}

/** 源码级佐证：宽度规则与 checkbox 排除规则必须在 index.css 里真实存在 */
function staticChecks(root) {
  const out = []
  const cssPath = path.join(root, 'src', 'index.css')
  const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : ''
  out.push({
    id: 'R1s',
    title: 'index.css 源码：.recurring-form-dialog 有显式宽度规则',
    pass: /\.aurora-shell\s+\.recurring-form-dialog\s*\{[^}]*width:\s*min\(/.test(css),
    actual: /\.aurora-shell\s+\.recurring-form-dialog\s*\{[^}]*width:\s*min\(/.test(css) ? '命中' : '未命中',
    threshold: '存在 `.aurora-shell .recurring-form-dialog { … width: min(…) }`'
  })
  const hasCheckboxExclusion = /\.aurora-shell\s+input:not\(\[type='checkbox'\]\)/.test(css)
  out.push({
    id: 'R2s',
    title: 'index.css 源码：全局 input 规则排除了 checkbox/radio',
    pass: hasCheckboxExclusion,
    actual: hasCheckboxExclusion ? '命中' : '未命中',
    threshold: "存在 `.aurora-shell input:not([type='checkbox']):not([type='radio'])`"
  })
  return out
}

function printReport(report, sourceChecks) {
  const pad = (s, n) => String(s).padEnd(n, ' ')
  log('')
  log('── 环境自检 ──────────────────────────────────────────────────────')
  log(`  视口              : ${report.viewport?.w}×${report.viewport?.h}（期望 ${VIEWPORT_W}×${VIEWPORT_H}）`)
  log(`  rootFont          : ${JSON.stringify(report.env?.rootFontPx)}`)
  log(`  html/body class   : ${JSON.stringify(report.env?.htmlClass)} / ${JSON.stringify(report.env?.bodyClass)}`)
  log('')
  log('── 断言 ─────────────────────────────────────────────────────────')
  const all = [...report.checks, ...sourceChecks]
  const order = ['R1', 'R1s', 'R2', 'R2s', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']
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

function main() {
  const { root, json } = parseArgs(process.argv)
  log(`${LABEL} —— 周期支出/记一笔 弹窗版式门禁`)
  preflight(root)

  const browser = harness.findBrowser()
  if (!browser) fail(harness.missingBrowserHelp(), 2)

  const scratch = harness.prepareScratch(root, {
    srcDir: GATE_SRC_DIR,
    files: ['recurring-probe.tsx', 'recurring-driver.ts', 'recurring-utils.ts', 'fixture.ts'],
    probeEntry: './recurring-probe.tsx',
    scratchDir: harness.uniqueScratch('recurring-gate'),
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

  const viewportOk = report.viewport && report.viewport.w === VIEWPORT_W && report.viewport.h === VIEWPORT_H
  const sourceChecks = staticChecks(root)
  const failed = printReport(report, sourceChecks)
  const total = report.checks.length + sourceChecks.length

  if (json) {
    const p = path.resolve(process.cwd(), json)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(
      p,
      JSON.stringify({ root, viewport: { w: VIEWPORT_W, h: VIEWPORT_H }, report, sourceChecks }, null, 2),
      'utf8'
    )
    log(`原始量测 JSON：${p}`)
  }

  if (!viewportOk) {
    fail(`${LABEL}: SKIP\n视口自检不成立 —— 量到的不是桌面 1280×900，结论无效：${JSON.stringify(report.viewport)}`, 2)
  }

  if (failed.length > 0) {
    log(`${LABEL}: FAIL —— ${failed.length}/${total} 条断言未通过（${failed.map((f) => f.id).join(', ')}）`)
    process.exit(1)
  }
  log(`${LABEL}: PASS —— ${total} 条断言全部通过`)
  process.exit(0)
}

main()
