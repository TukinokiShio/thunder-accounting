#!/usr/bin/env node
/**
 * verify-desktop-parity.cjs —— A9：**桌面视口比对门禁**（基线 vs 主树，逐项 computed style 精确相等）。
 *
 * 要守的不变量：这一轮安卓端重排（首页/账单/统计/分类管理/个人中心）**对桌面零变化**。
 *
 * 为什么需要它：现有两类证据都不够 ——
 *  ① `mobile/android.css` 前缀检查只管 CSS 文件，管不到 TSX 里的 Tailwind 类；
 *  ② 源码级断言只能枚举**已知**坏模式（如 `sm:leading-*`），枚举不完，也表达不了 Tailwind 层叠。
 * 而这一轮已实测出 4 处「以为复位了、其实没复位」（`sm:leading-normal` 改值、无条件 `truncate`、
 * 无条件 `shrink-0`、`min-w-0` 加在 flex 容器上是 no-op），其中 3 处不在任何人给的证据里
 * —— 说明「逐条检查 class」这类方法本身有盲区。
 *
 * 所以这里换一类证据：不求证源码怎么写，只求**渲染出来是什么**。做法是把同一份确定性夹具
 * （`scripts/layout-gate/fixture.ts`，与安卓门禁共用，保证两侧内容逐字相同）在两棵树上分别
 * 渲染进真排版引擎，在 **1280×900 桌面路径**下把每个节点的 computed style 量成快照，然后
 * **逐项精确相等**地比。任何差异都是发现，不是噪声 —— 本脚本不会放宽阈值、也不会加容差。
 *
 * 环境自检是**反向**的（与安卓门禁相反）：必须证明「这不是安卓布局」——
 *   · `<html>` 上没有 `platform-android` 类；· android.css **没生效**（`body` overscroll-y 仍为 auto）；
 *   · 桌面外壳在（侧栏可见、没有底部 TabBar）；· 视口确实是 1280×900；
 *   · 且 android.css **确实在这张页面里**（否则「未生效」是句空话 —— 见 desktop-probe.tsx 的说明）。
 * 任一条不成立 ⇒ 退出码 2（环境未就绪），不允许在安卓布局上量出「桌面一致」。
 *
 * 用法：
 *   node scripts/verify-desktop-parity.cjs                          # 基线默认 ../ta-gate-baseline
 *   node scripts/verify-desktop-parity.cjs --baseline <dir> --current <dir>
 *   node scripts/verify-desktop-parity.cjs --json out/desktop-parity.json
 *
 * 退出码：
 *   0 = 两侧逐项相等（且环境自检全部成立）
 *   1 = 存在差异（DOM 结构、节点数、computed style 或探针文本）
 *   2 = 环境未就绪（缺文件 / 构建失败 / 找不到浏览器 / 反向自检不成立 / 比对被截断）
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createHarness } = require('./lib/layout-harness.cjs')

const SCRIPT_DIR = __dirname
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')
const GATE_SRC_DIR = path.join(SCRIPT_DIR, 'layout-gate')
const LABEL = 'VERIFY_DESKTOP_PARITY'
const harness = createHarness(LABEL)

const VIEWPORT_W = 1280
const VIEWPORT_H = 900
const PAGES = ['home', 'bills', 'stats', 'profile', 'categories']

/** 反向自检的期望值（来自 `src/index.css` / `src/platform` 的既有事实，不是猜的）。 */
const DESKTOP_EXPECT = {
  platformAndroid: false,
  bodyOverscrollY: 'auto',
  androidTabbarPresent: false
}

/** 两侧都要比的 env 字段（其余 env 字段只做自检，不做跨侧比对）。 */
const ENV_COMPARE = ['platformAndroid', 'bodyOverscrollY', 'mainPaddingBottom', 'sidebarDisplay', 'androidTabbarPresent']

/**
 * 桌面量测的额外浏览器参数。
 * `--force-prefers-reduced-motion` 让页面命中 `src/index.css:551` 那条**应用自带的**
 * `@media (prefers-reduced-motion: reduce)` 规则（`animation/transition-duration: .01ms !important`、
 * `animation-iteration-count: 1 !important`），于是入场动画/过渡立刻落到**终态**：
 *  · 不加它时实测：两侧各有几个节点在动画途中被采样，`opacity` 在第 5~6 位小数上不同
 *    （0.600817 vs 0.600760）—— 那是采样时刻的抖动，会变成 flaky 假红；
 *  · 更要紧的是无限循环动画（`animate-spin` 之类）在普通模式下**永不结束**，
 *    驱动里的「等动画落定」会一直等不到，门禁将永久退出码 2。
 * 用**应用自己的降级路径**（而不是自己注入一份 CSS）避免改动层叠，也让两侧条件完全一致。
 */
const MEASURE_OPTS = { extraArgs: ['--force-prefers-reduced-motion'] }

const MAX_REPORT_LINES = 40

function fail(msg, code) {
  console.error(`${LABEL}: ${msg}`)
  process.exit(code)
}

function log(...a) {
  console.log(...a)
}

/* ── 参数 ───────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const out = {
    current: REPO_ROOT,
    baseline: path.resolve(REPO_ROOT, '..', 'ta-gate-baseline'),
    json: null
  }
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--baseline') out.baseline = path.resolve(argv[++i])
    else if (argv[i] === '--current') out.current = path.resolve(argv[++i])
    else if (argv[i] === '--json') out.json = argv[++i]
  }
  return out
}

function preflight(root, which) {
  const need = ['node_modules', 'index.html', 'src', 'src/App.tsx', 'mobile/android.css', 'postcss.config.js']
  const missing = need.filter((p) => !fs.existsSync(path.join(root, p)))
  if (missing.length > 0) {
    fail(`${which} 侧目录缺少必要文件：${missing.join(', ')}\n  root = ${root}`, 2)
  }
}

/* ── 采集一侧 ───────────────────────────────────────────────────────────── */

function capture(root, which, browser) {
  log('')
  log(`──── 采集 ${which} 侧 ────────────────────────────────────────────────`)
  const scratch = harness.prepareScratch(root, {
    srcDir: GATE_SRC_DIR,
    files: ['desktop-probe.tsx', 'desktop-driver.ts', 'fixture.ts'],
    probeEntry: './desktop-probe.tsx',
    scratchDir: 'desktop-parity',
    define: {}
  })
  const builtHtml = harness.buildProbe(root, scratch, browser)
  const { tmpDir, outPath } = harness.inlinePage(builtHtml)

  let dump
  let androidCssInPage = false
  try {
    dump = harness.measure(browser, outPath, tmpDir, { w: VIEWPORT_W, h: VIEWPORT_H }, MEASURE_OPTS)
    // 证明 android.css 真的在这张页面里（只看 <style> 内容 —— 类名字面量也出现在 JS 里，
    // 搜整页 HTML 会误判）。「未生效」只有在「在场」成立时才有意义。
    const pageHtml = fs.readFileSync(outPath, 'utf8')
    const cssText = [...pageHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
    androidCssInPage = cssText.indexOf('platform-android') >= 0
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* 临时目录清理失败可忽略 */
    }
  }

  if (dump && dump.partial) {
    fail(
      `${which} 侧探针**没跑完**就出结果了（stage=${dump.stage}，${dump.donePages}/${dump.totalPages} 页）——\n` +
        `虚拟时间预算被耗尽（通常是等待/动画没落定，或某页数据一直没到）。env=${JSON.stringify(dump.env)}`,
      2
    )
  }
  if (dump && dump.fatal) {
    fail(`${which} 侧探针页执行失败：${dump.fatal}`, 2)
  }
  if (!dump || !Array.isArray(dump.pages) || dump.pages.length === 0) {
    fail(
      `${which} 侧没有产出任何页面快照。env=${JSON.stringify(dump && dump.env)}\n` +
        `（pages=${JSON.stringify(dump && dump.pages)}；若不是 [] 说明探针在挂载前就退出了）`,
      2
    )
  }
  return { root, which, dump, androidCssInPage }
}

/* ── 反向环境自检 ───────────────────────────────────────────────────────── */

function selfCheck(side) {
  const { dump, androidCssInPage, which } = side
  const env = dump.env || {}
  const vp = dump.viewport || {}
  const checks = [
    { name: '逻辑视口 = 1280×900', pass: vp.w === VIEWPORT_W && vp.h === VIEWPORT_H, actual: `${vp.w}×${vp.h}` },
    {
      name: 'android.css 确实在页面里（否则「未生效」是空话）',
      pass: androidCssInPage === true,
      actual: String(androidCssInPage)
    },
    {
      name: '<html> 无 platform-android 类（这就是「桌面侧」的定义）',
      pass: env.platformAndroid === DESKTOP_EXPECT.platformAndroid,
      actual: `${JSON.stringify(env.platformAndroid)}  class=${JSON.stringify(env.htmlClass)}`
    },
    {
      name: `android.css 未生效：body overscroll-y = ${DESKTOP_EXPECT.bodyOverscrollY}`,
      pass: env.bodyOverscrollY === DESKTOP_EXPECT.bodyOverscrollY,
      actual: JSON.stringify(env.bodyOverscrollY)
    },
    {
      // 只断言「非零 + 两侧相同」：值为 0 说明整份 index.css 压根没进页面（探针失效）；
      // 具体是多少不是本门禁要守的不变量（那是两侧一致性的事，见 ENV_COMPARE）。
      name: 'index.css 已生效：main 有非零 padding-bottom',
      pass: !!env.mainPaddingBottom && env.mainPaddingBottom !== '0px',
      actual: JSON.stringify(env.mainPaddingBottom)
    },
    {
      // 「快照里没混进动画中间帧 / 异步竞态」的**直接**证据：驱动对每页连采两次，逐字相同才算稳定。
      // 不用 WAAPI playState 当门（headless 下 .01ms 过渡会永远停在 running，那是代理指标）。
      name: '每页快照都稳定（同页连采两次逐字相同）',
      pass: dump.pages.every((p) => p.stable === true),
      actual: dump.pages.map((p) => `${p.page}${p.stable ? '✓' : `✗(${JSON.stringify(p.unstablePaths.slice(0, 2))})`}`).join(' ')
    },
    {
      name: '走的是桌面外壳（无底部 TabBar、侧栏可见）',
      pass: env.androidTabbarPresent === DESKTOP_EXPECT.androidTabbarPresent && env.sidebarDisplay !== 'none',
      actual: `tabbar=${JSON.stringify(env.androidTabbarPresent)} sidebarDisplay=${JSON.stringify(env.sidebarDisplay)}`
    },
    {
      name: `页面快照完整且稳定（5 页、无截断、逐页连采两次相同）`,
      pass:
        dump.pages.length === PAGES.length &&
        PAGES.every((p) => dump.pages.some((x) => x.page === p)) &&
        dump.pages.every((p) => p.truncated === false) &&
        dump.pages.every((p) => p.stable === true),
      actual:
        `${dump.pages.length} 页：${dump.pages.map((p) => `${p.page}(${p.nodeCount}${p.truncated ? ',截断' : ''}${p.stable === false ? `,不稳定:${p.unstablePaths.join('|')}` : ''})`).join(' ')}`
    }
  ]
  const failed = checks.filter((c) => !c.pass)
  log(`  反向自检（${which}）：`)
  for (const c of checks) log(`    ${c.pass ? 'ok  ' : 'FAIL'} ${c.name}  → 实际 ${c.actual}`)
  return failed
}

/* ── 比对 ───────────────────────────────────────────────────────────────── */

function compare(base, cur) {
  const diffs = []
  const pages = []

  for (const page of PAGES) {
    const b = base.dump.pages.find((p) => p.page === page)
    const c = cur.dump.pages.find((p) => p.page === page)
    if (!b || !c) {
      diffs.push({ where: `${page}`, kind: '页面缺失', detail: `基线=${b ? '有' : '无'} 当前=${c ? '有' : '无'}` })
      pages.push({ page, nodeCount: [b && b.nodeCount, c && c.nodeCount], onlyBase: [], onlyCur: [], changed: [], diffPairs: 0 })
      continue
    }
    const bMap = new Map(b.nodes.map((n) => [n.path, n.s]))
    const cMap = new Map(c.nodes.map((n) => [n.path, n.s]))
    const onlyBase = []
    const onlyCur = []
    for (const p of bMap.keys()) if (!cMap.has(p)) onlyBase.push(p)
    for (const p of cMap.keys()) if (!bMap.has(p)) onlyCur.push(p)
    const changed = []
    let diffPairs = 0
    for (const [p, bs] of bMap) {
      const cs = cMap.get(p)
      if (!cs) continue
      const props = []
      for (const k of Object.keys(bs)) {
        if (bs[k] !== cs[k]) {
          props.push([k, bs[k], cs[k]])
          diffPairs++
        }
      }
      if (props.length > 0) changed.push({ path: p, props })
    }
    pages.push({ page, nodeCount: [b.nodeCount, c.nodeCount], onlyBase, onlyCur, changed, diffPairs })
    if (b.nodeCount !== c.nodeCount) {
      diffs.push({ where: page, kind: '节点数不同', detail: `基线 ${b.nodeCount} / 当前 ${c.nodeCount}（${c.nodeCount - b.nodeCount >= 0 ? '+' : ''}${c.nodeCount - b.nodeCount}）` })
    }
    if (b.captured !== c.captured) {
      diffs.push({ where: page, kind: '快照节点数不同', detail: `基线 ${b.captured} / 当前 ${c.captured}` })
    }
    if (onlyBase.length > 0) diffs.push({ where: page, kind: '仅基线有的节点', detail: `${onlyBase.length} 个，例：${onlyBase.slice(0, 3).join(' , ')}` })
    if (onlyCur.length > 0) diffs.push({ where: page, kind: '仅当前有的节点', detail: `${onlyCur.length} 个，例：${onlyCur.slice(0, 3).join(' , ')}` })
    if (changed.length > 0) {
      const sample = changed
        .slice(0, 3)
        .map((x) => `${x.path} [${x.props.slice(0, 3).map(([k, bv, cv]) => `${k}: ${bv} → ${cv}`).join(' ; ')}]`)
        .join('\n        ')
      diffs.push({ where: page, kind: 'computed style 不同', detail: `${changed.length} 个节点 / ${diffPairs} 个属性对\n        ${sample}` })
    }
  }

  /* 命名探针：逐项比对 */
  const probeNames = Array.from(new Set([...Object.keys(base.dump.probes), ...Object.keys(cur.dump.probes)]))
  const probes = []
  for (const name of probeNames) {
    const b = base.dump.probes[name]
    const c = cur.dump.probes[name]
    if (!b || !c) {
      diffs.push({ where: name, kind: '探针缺失', detail: `基线=${b ? '有' : '无'} 当前=${c ? '有' : '无'}` })
      continue
    }
    if (!b.found && !c.found) {
      // 两侧都没找到 ⇒ 这个探针已经失效，比对是**空过**，必须判失败（否则门禁会静默失明）
      probes.push({ name, found: [false, false], keys: [], text: [b.text, c.text], vacuous: true })
      diffs.push({ where: name, kind: '探针失效（两侧都未找到该元素）', detail: '该探针已空过，必须修正探针本身' })
      continue
    }
    if (b.found !== c.found) {
      probes.push({ name, found: [b.found, c.found], keys: [], text: [b.text, c.text], vacuous: false })
      diffs.push({ where: name, kind: '探针命中情况不同', detail: `基线 found=${b.found} / 当前 found=${c.found}` })
      continue
    }
    if ((b.text || '') !== (c.text || '')) {
      diffs.push({ where: name, kind: '命中的元素文本不同（可能量到了不同元素）', detail: `基线 "${b.text}" / 当前 "${c.text}"` })
    }
    const keys = []
    for (const k of Object.keys(b.s)) {
      const equal = b.s[k] === c.s[k]
      keys.push({ key: k, baseline: b.s[k], current: c.s[k], equal })
      if (!equal) diffs.push({ where: name, kind: 'computed style 不同', detail: `${k}: 基线 ${b.s[k]} → 当前 ${c.s[k]}` })
    }
    probes.push({ name, found: [true, true], keys, text: [b.text, c.text], vacuous: false })
  }

  /* 结构计数 */
  const counts = []
  const countKeys = Array.from(new Set([...Object.keys(base.dump.counts), ...Object.keys(cur.dump.counts)]))
  for (const page of countKeys) {
    const b = base.dump.counts[page] || {}
    const c = cur.dump.counts[page] || {}
    const sels = Array.from(new Set([...Object.keys(b), ...Object.keys(c)]))
    for (const sel of sels) {
      const bv = b[sel]
      const cv = c[sel]
      counts.push({ page, sel, baseline: bv, current: cv, equal: bv === cv })
      if (bv !== cv) diffs.push({ where: `${page} ${sel}`, kind: '元素计数不同', detail: `基线 ${bv} / 当前 ${cv}` })
    }
  }

  /* env 跨侧比对 */
  for (const f of ENV_COMPARE) {
    const bv = base.dump.env[f]
    const cv = cur.dump.env[f]
    if (bv !== cv) diffs.push({ where: `env.${f}`, kind: '环境量不同', detail: `基线 ${JSON.stringify(bv)} / 当前 ${JSON.stringify(cv)}` })
  }

  return { pages, probes, counts, diffs }
}

/* ── 报告 ───────────────────────────────────────────────────────────────── */

function printReport(base, cur, cmp) {
  log('')
  log('── 反向环境自检（任一条不成立即「环境未就绪」，退出码 2）────────────')
  const envFail = [...base.envFailed.map((c) => ({ ...c, side: base.which })), ...cur.envFailed.map((c) => ({ ...c, side: cur.which }))]

  log('')
  log('── 页面指纹（逐节点 × 全部 computed style 属性）─────────────────────')
  for (const p of cmp.pages) {
    const same = p.nodeCount[0] === p.nodeCount[1]
    const ok = same && p.onlyBase.length === 0 && p.onlyCur.length === 0 && p.changed.length === 0
    const stable = [base.dump.pages, cur.dump.pages]
      .map((list) => list.find((x) => x.page === p.page))
      .map((x) => (x && x.stable === true ? '稳' : '不稳'))
      .join('/')
    log(
      `${ok ? 'PASS' : 'FAIL'}  ${String(p.page).padEnd(11)} 节点 ${p.nodeCount[0]} ${same ? '==' : '!='} ${p.nodeCount[1]}；` +
        `属性差异 ${p.changed.length} 节点 / ${p.diffPairs} 属性对；仅基线 ${p.onlyBase.length} 个；仅当前 ${p.onlyCur.length} 个；快照稳定性 ${stable}`
    )
  }

  log('')
  log('── 关键元素逐项比对（基线 → 当前）───────────────────────────────────')
  for (const p of cmp.probes) {
    if (p.vacuous) {
      log(`FAIL  ${p.name}  —— 探针失效：两侧都未找到该元素（比对空过）`)
      continue
    }
    const bad = p.keys.filter((k) => !k.equal)
    log(`${bad.length === 0 ? 'PASS' : 'FAIL'}  ${p.name}`)
    if (p.text && p.text[0] !== undefined) log(`        命中文本: "${p.text[0]}"${p.text[0] === p.text[1] ? '' : `  [当前: "${p.text[1]}"]`}`)
    for (const k of p.keys) {
      log(`        ${k.equal ? '=' : '≠'} ${k.key}: ${k.baseline}${k.equal ? '' : `  →  ${k.current}`}`)
    }
  }

  log('')
  log('── 结构计数 ──────────────────────────────────────────────────────────')
  const badCounts = cmp.counts.filter((c) => !c.equal)
  if (badCounts.length === 0) {
    log(`全部 ${cmp.counts.length} 项相等`)
  } else {
    for (const c of badCounts) log(`FAIL  ${c.page} ${c.sel}: 基线 ${c.baseline} → 当前 ${c.current}`)
  }

  log('')
  log('── 差异汇总 ──────────────────────────────────────────────────────────')
  if (cmp.diffs.length === 0) {
    log('无差异：两侧逐项精确相等。')
  } else {
    log(`共 ${cmp.diffs.length} 项差异（最多列 ${MAX_REPORT_LINES} 项）：`)
    for (const d of cmp.diffs.slice(0, MAX_REPORT_LINES)) {
      log(`  [${d.kind}] ${d.where}`)
      log(`      ${d.detail}`)
    }
    if (cmp.diffs.length > MAX_REPORT_LINES) log(`  ...另有 ${cmp.diffs.length - MAX_REPORT_LINES} 项未列出（见 --json 产物）`)
  }
  return envFail
}

/* ── main ───────────────────────────────────────────────────────────────── */

function main() {
  const args = parseArgs(process.argv)
  log(`${LABEL} —— 桌面视口比对门禁（基线 == 主树，逐项 computed style 精确相等）`)
  log(`  current : ${args.current}`)
  log(`  baseline: ${args.baseline}`)
  log(`  viewport: ${VIEWPORT_W}×${VIEWPORT_H}（桌面路径；探针页**不含** platform-android）`)

  preflight(args.baseline, '基线')
  preflight(args.current, '当前')

  const browser = harness.findBrowser()
  if (!browser) fail(harness.missingBrowserHelp(), 2)

  const base = capture(args.baseline, '基线', browser)
  const cur = capture(args.current, '当前', browser)
  base.envFailed = selfCheck(base)
  cur.envFailed = selfCheck(cur)

  const cmp = compare(base, cur)
  const envFail = printReport(base, cur, cmp)

  const outDir = (p) => {
    const d = path.resolve(process.cwd(), p)
    fs.mkdirSync(path.dirname(d), { recursive: true })
    return d
  }

  if (args.json) {
    const p = outDir(args.json)
    fs.writeFileSync(
      p,
      JSON.stringify(
        {
          viewport: { w: VIEWPORT_W, h: VIEWPORT_H },
          baseline: { root: base.root, androidCssInPage: base.androidCssInPage, dump: base.dump },
          current: { root: cur.root, androidCssInPage: cur.androidCssInPage, dump: cur.dump },
          compare: { pages: cmp.pages, probes: cmp.probes, counts: cmp.counts, diffs: cmp.diffs }
        },
        null,
        2
      ),
      'utf8'
    )
    log(``)
    log(`原始量测 JSON：${p}`)
  }

  if (envFail.length > 0) {
    fail(
      `SKIP —— 反向自检未通过，说明量到的不是桌面布局，比对结论无效（${envFail.length} 条）：\n` +
        envFail.map((c) => `  [${c.side}] ${c.name} → 实际 ${c.actual}`).join('\n'),
      2
    )
  }
  if (cmp.diffs.length > 0) {
    log('')
    log(`${LABEL}: FAIL —— 两侧存在 ${cmp.diffs.length} 项差异（门禁不放宽阈值，差异交 team-lead 裁决）`)
    process.exit(1)
  }
  log('')
  log(`${LABEL}: PASS —— 桌面路径下基线 == 主树（${PAGES.length} 页逐节点 × computed style 全部相等）`)
  process.exit(0)
}

main()
