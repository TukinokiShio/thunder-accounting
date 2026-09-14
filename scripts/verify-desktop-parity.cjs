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
 *   node scripts/verify-desktop-parity.cjs --gate-src <dir> --scratch <name>   # 并发运行时用冻结仪器 + 独立 scratch
 *
 * 目录参数一律经 `canonDir()` 规范化（Windows 盘符大小写不一致会让构建直接失败，见下）。
 *
 * 退出码：
 *   0 = 两侧逐项相等（且环境自检全部成立）
 *   1 = 存在差异（DOM 结构、节点数、computed style 或探针文本）
 *   2 = 环境未就绪（缺文件 / 构建失败 / 找不到浏览器 / 反向自检不成立 / 比对被截断）
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
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

/**
 * 规范化待测目录：统一成**文件系统上的规范大小写**。
 *
 * 为什么必须做（实测踩到，不是防御性编程）：Windows 下 `e:\...` 与 `E:\...` 指向同一个目录，
 * 但 vite 的 `html-inline-proxy` 是**按路径字符串**匹配模块 id 的 —— 它内部走 realpath 拿到
 * `E:\Code\...\probe.html?html-proxy&inline-css&index=0.css`，而地图键是用调用方给的
 * `e:\Code\...` 建的，两边字符串不等 ⇒ 构建直接失败：
 *   `[vite:html-inline-proxy] Could not load ...?html-proxy&inline-css&index=0.css ... No matching HTML proxy module found`
 * 触发条件：`parseArgs` 的默认值来自 `__dirname`（盘符为 `E:`），而 `--baseline ../x` /
 * `--current ../x` 是相对路径、经 `path.resolve(process.cwd(), ...)` 解析（盘符为 `e:`）——
 * 于是**只要用户显式传一次目录参数，门禁就整条不可用**（默认路径反而正常，最难发现的那种）。
 * 安卓门禁不受影响：它只有一个 root（`REPO_ROOT`），两侧同源不可能大小写不一致。
 */
function canonDir(p) {
  const r = path.resolve(p)
  try {
    return fs.realpathSync.native(r)
  } catch {
    return r
  }
}

function parseArgs(argv) {
  const out = {
    current: canonDir(REPO_ROOT),
    baseline: canonDir(path.resolve(REPO_ROOT, '..', 'ta-gate-baseline')),
    // 探针/驱动/夹具的**来源目录**（默认就是仓库里的那份）。可指向一份冻结副本 ——
    // 当有多个人/多个 agent 同时在同一工作树里跑门禁时，共享的探针文件会被别人改到，
    // 于是「基线侧按桌面渲染、当前侧按安卓渲染」这种**单侧污染**会静默发生（实测踩到）。
    // 冻结一份副本再用 --gate-src 指过去，两侧读的就是同一份不会变的仪器。
    gateSrc: GATE_SRC_DIR,
    // scratch 目录名：默认与安卓门禁及其它运行**分开**，避免两次并发运行互相 rm -rf 对方中间产物。
    scratch: 'desktop-parity',
    json: null
  }
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--baseline') out.baseline = canonDir(argv[++i])
    else if (argv[i] === '--current') out.current = canonDir(argv[++i])
    else if (argv[i] === '--gate-src') out.gateSrc = canonDir(argv[++i])
    else if (argv[i] === '--scratch') out.scratch = argv[++i]
    else if (argv[i] === '--json') out.json = argv[++i]
  }
  return out
}

/**
 * 仪器指纹：探针 / 驱动 / 夹具 / harness 自身的内容摘要。
 *
 * 为什么需要：门禁的**两侧共用同一份仪器**（探针由 srcDir 复制进各自的 scratch）。
 * 如果这份仪器在「采基线」与「采当前」之间被改动，两次量测就不是同一个尺子 —— 而结果
 * 看上去仍然是一份正常的报告（静默污染）。实测发生过：另一进程在两次采集之间把
 * `desktop-probe.tsx` 加上 `platform-android`，于是基线侧量成桌面、当前侧量成安卓，
 * 报出天量「差异」却看不出原因。把指纹算出来并在两侧之间断言相等，这类污染就从
 * 「看不出来」变成「硬拒绝」（退出码 2）。
 */
function instrumentFingerprint(dir) {
  const h = crypto.createHash('sha256')
  for (const f of ['desktop-probe.tsx', 'desktop-driver.ts', 'fixture.ts']) {
    h.update(f)
    h.update(fs.readFileSync(path.join(dir, f)))
  }
  h.update('layout-harness.cjs')
  h.update(fs.readFileSync(path.join(SCRIPT_DIR, 'lib', 'layout-harness.cjs')))
  return h.digest('hex').slice(0, 16)
}

function preflight(root, which) {
  const need = ['node_modules', 'index.html', 'src', 'src/App.tsx', 'mobile/android.css', 'postcss.config.js']
  const missing = need.filter((p) => !fs.existsSync(path.join(root, p)))
  if (missing.length > 0) {
    fail(`${which} 侧目录缺少必要文件：${missing.join(', ')}\n  root = ${root}`, 2)
  }
}

/* ── 采集一侧 ───────────────────────────────────────────────────────────── */

function capture(root, which, browser, args) {
  log('')
  log(`──── 采集 ${which} 侧 ────────────────────────────────────────────────`)
  const scratch = harness.prepareScratch(root, {
    srcDir: args.gateSrc,
    files: ['desktop-probe.tsx', 'desktop-driver.ts', 'fixture.ts'],
    probeEntry: './desktop-probe.tsx',
    scratchDir: args.scratch,
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
    // 每个探针在报告里必须**自己说清自己为什么 PASS/FAIL**。
    // 曾经的写法只按 `keys` 判 PASS/FAIL，于是「命中元素不同」「命中文本不同」「探针缺失」
    // 这三类已经有差异的探针会在报告里打印成 PASS（差异只落在下面的差异汇总里）——
    // 汇总与逐项两处结论打架，读的人会以为探针层是绿的。改成由 reasons 驱动。
    if (!b || !c) {
      const reason = `探针缺失：基线=${b ? '有' : '无'} / 当前=${c ? '有' : '无'}`
      diffs.push({ where: name, kind: '探针缺失', detail: `基线=${b ? '有' : '无'} 当前=${c ? '有' : '无'}` })
      probes.push({ name, keys: [], reasons: [reason] })
      continue
    }
    if (!b.found && !c.found) {
      // 两侧都没找到 ⇒ 这个探针已经失效，比对是**空过**，必须判失败（否则门禁会静默失明）
      const reason = '探针失效：两侧都未找到该元素（比对空过，必须修正探针本身）'
      probes.push({ name, found: [false, false], keys: [], text: [b.text, c.text], vacuous: true, reasons: [reason] })
      diffs.push({ where: name, kind: '探针失效（两侧都未找到该元素）', detail: '该探针已空过，必须修正探针本身' })
      continue
    }
    if (b.found !== c.found) {
      const reason = `命中情况不同：基线 found=${b.found} / 当前 found=${c.found}`
      probes.push({ name, found: [b.found, c.found], keys: [], text: [b.text, c.text], vacuous: false, reasons: [reason] })
      diffs.push({ where: name, kind: '探针命中情况不同', detail: `基线 found=${b.found} / 当前 found=${c.found}` })
      continue
    }
    const reasons = []
    if ((b.text || '') !== (c.text || '')) {
      reasons.push('命中的元素文本不同（可能量到了不同元素）')
      diffs.push({ where: name, kind: '命中的元素文本不同（可能量到了不同元素）', detail: `基线 "${b.text}" / 当前 "${c.text}"` })
    }
    const keys = []
    for (const k of Object.keys(b.s)) {
      const equal = b.s[k] === c.s[k]
      keys.push({ key: k, baseline: b.s[k], current: c.s[k], equal })
      if (!equal) {
        reasons.push(`computed style 不同：${k}`)
        diffs.push({ where: name, kind: 'computed style 不同', detail: `${k}: 基线 ${b.s[k]} → 当前 ${c.s[k]}` })
      }
    }
    probes.push({ name, found: [true, true], keys, text: [b.text, c.text], vacuous: false, reasons })
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
    const reasons = p.reasons && p.reasons.length ? p.reasons : p.vacuous ? ['探针失效：两侧都未找到该元素（比对空过）'] : []
    log(`${reasons.length === 0 ? 'PASS' : 'FAIL'}  ${p.name}`)
    for (const r of reasons) log(`        ! ${r}`)
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
  log(`  gate-src: ${args.gateSrc}`)
  log(`  scratch : out/${args.scratch}`)

  const instrumentBefore = instrumentFingerprint(args.gateSrc)
  log(`  仪器指纹: ${instrumentBefore}（探针/驱动/夹具/harness 的内容摘要）`)

  preflight(args.baseline, '基线')
  preflight(args.current, '当前')
  for (const f of ['desktop-probe.tsx', 'desktop-driver.ts', 'fixture.ts']) {
    if (!fs.existsSync(path.join(args.gateSrc, f))) fail(`--gate-src 里缺少 ${f}：${args.gateSrc}`, 2)
  }

  const browser = harness.findBrowser()
  if (!browser) fail(harness.missingBrowserHelp(), 2)

  const base = capture(args.baseline, '基线', browser, args)
  const cur = capture(args.current, '当前', browser, args)

  // 两侧必须用**同一把尺子**。仪器在两次采集之间被动过 ⇒ 报告无效，直接拒绝（不是加容差）。
  const instrumentAfter = instrumentFingerprint(args.gateSrc)
  if (instrumentBefore !== instrumentAfter) {
    fail(
      `SKIP —— 门禁的仪器文件在两次采集之间被改动（${instrumentBefore} → ${instrumentAfter}）。\n` +
        `  两侧量的不是同一把尺子，本次报告无效。请确认没有另一个进程/agent 正在编辑\n` +
        `  ${args.gateSrc}（或改用 --gate-src 指向一份冻结副本）。`,
      2
    )
  }

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
          instrument: { src: args.gateSrc, fingerprint: instrumentAfter, scratch: args.scratch },
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
