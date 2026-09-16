#!/usr/bin/env node
/**
 * 工作区实验产物清理器（thunder-accounting）
 *
 * 背景：AGENTS.md 要求「每次更新后必须整理工作区」，但该要求长期只是**文本**，
 * 没有可执行的挂载点 —— 产物目录又被 .gitignore 全量忽略，git status 恒为空，
 * 导致「没清理」没有任何可见信号。本脚本把该要求落成**判据确定**的动作。
 *
 * 用法：
 *   node scripts/cleanup-worktree.cjs                    # 只报告（默认，零删除）
 *   node scripts/cleanup-worktree.cjs --apply            # 删除 SAFE 级别
 *   node scripts/cleanup-worktree.cjs --apply --include-risky   # 连 CONFIRM 级别一起删
 *   node scripts/cleanup-worktree.cjs --json <path>      # 报告落盘（stdout 不可靠时的对照通道）
 *   node scripts/cleanup-worktree.cjs --archive-prune            # 归档区**分层**报告（零删除）
 *   node scripts/cleanup-worktree.cjs --archive-prune --apply    # 删归档可重建层，留证据层
 *
 * 三级判据（客观可判定，不依赖临场判断）：
 *   SAFE    —— 可由构建/门禁重新生成，且不被任何已发布产物引用
 *   CONFIRM —— 有回滚或审计价值（旧安装包、打包日志、归档状态），需显式开关
 *   KEEP    —— 审计证据 / 用户数据 / AGENTS.md 指定保留，**永不自动删**，只列出
 *
 * ⚠️ 归档区例外：`--include-risky` **不再**整体删除 `*-archive`（那会连带丢掉
 *    难以复现的历史视觉基线）。归档一律走 `--archive-prune`，按**正向前缀白名单**
 *    只删可重建层，其余默认保留。
 *
 * 设计约束：
 *   - 默认不删除任何东西；删除必须显式 --apply。
 *   - 本脚本**永远以 0 退出**（除自身异常），以便安全地挂到打包链路下游。
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
/**
 * 项目父目录。实验产物同样漏在这里 —— 冻结 worktree、SAE 归档区、早期隔离区。
 * 它们不在 ROOT 下，所以「只扫项目内」的清理器**结构上永远看不见它们**。
 */
const PARENT = path.dirname(ROOT)
const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const INCLUDE_RISKY = argv.includes('--include-risky')
/** 归档区**分层**清理开关（独立于 SAFE/CONFIRM 分级，有自己的一套白名单判据） */
const ARCHIVE_PRUNE = argv.includes('--archive-prune')
const JSON_OUT = (() => {
  const i = argv.indexOf('--json')
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null
})()

/** release/ 中保留的最近版本数（用户 2026-09-13 定：两个家族各保留 3 个） */
const KEEP_VERSIONS = 3

const SAFE = []
const CONFIRM = []
const KEEP = []

// ── 工具 ────────────────────────────────────────────────────────────

function du(p) {
  let total = 0
  const stack = [p]
  while (stack.length) {
    const cur = stack.pop()
    let st
    try {
      st = fs.lstatSync(cur)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      let entries = []
      try {
        entries = fs.readdirSync(cur)
      } catch {
        continue
      }
      for (const e of entries) stack.push(path.join(cur, e))
    } else {
      total += st.size
    }
  }
  return total
}

function entry(level, p, reason, extra = {}) {
  const abs = path.join(ROOT, p)
  if (!fs.existsSync(abs)) return null
  const rec = {
    path: p,
    bytes: du(abs),
    reason,
    ...extra,
  }
  ;(level === 'SAFE' ? SAFE : level === 'CONFIRM' ? CONFIRM : KEEP).push(rec)
  return rec
}

function human(n) {
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + ' GB'
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + ' MB'
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB'
  return n + ' B'
}

function listDir(p) {
  try {
    return fs.readdirSync(path.join(ROOT, p))
  } catch {
    return []
  }
}

// ── 1. 可重建构建产物 ───────────────────────────────────────────────

entry('SAFE', 'out', 'electron-vite / tsc 构建产物 + 门禁临时目录，可完全重建')
entry('SAFE', 'app-out', 'electron-vite 构建产物，可完全重建')
entry('SAFE', 'dist-android', 'Capacitor webDir 产物，npm run build:android 可重建')
entry('SAFE', 'release163', '旧版本解压产物（含 win-unpacked），安装包已另有留存')
entry('SAFE', 'release/win-unpacked', 'electron-builder 解压目录（约 385MB），可重建')
entry('SAFE', '__missing_android_project__', '空壳目录（仅含空的 artifacts 子目录）')
entry('SAFE', 'out/tsconfig.app.tsbuildinfo', 'TypeScript 增量缓存')
entry('SAFE', 'out/tsconfig.node.tsbuildinfo', 'TypeScript 增量缓存')

// ── 2. 需确认项：旧安装包 / blockmap / 归档状态 ─────────────────────

function versionedIn(dir, pattern) {
  const out = []
  for (const f of listDir(dir)) {
    const m = f.match(pattern)
    if (!m) continue
    const abs = path.join(ROOT, dir, f)
    let st
    try {
      st = fs.statSync(abs)
    } catch {
      continue
    }
    if (!st.isFile()) continue
    out.push({ file: f, version: m[1], mtime: st.mtimeMs, bytes: st.size })
  }
  return out
}

/** 按版本排序，返回超出保留数的旧版本条目 */
function staleVersions(items) {
  const seen = new Map()
  for (const it of items) seen.set(it.version, it)
  const sorted = [...seen.values()].sort(
    (a, b) => b.mtime - a.mtime
  )
  return sorted.slice(KEEP_VERSIONS)
}

const FAMILIES = [
  {
    label: 'electron-builder 安装包',
    re: /^雷霆记账 Setup (\d+\.\d+\.\d+)\.exe$/,
  },
  {
    label: 'Inno Setup 安装包',
    re: /^雷霆记账_Inno_v(\d+\.\d+\.\d+)\.exe$/,
  },
]

for (const fam of FAMILIES) {
  const all = versionedIn('release', fam.re)
  const stale = staleVersions(all)
  if (stale.length) {
    const total = stale.reduce((s, x) => s + x.bytes, 0)
    CONFIRM.push({
      path: `release/${fam.label}: ${stale.map((x) => x.version).join(', ')}`,
      bytes: total,
      reason: `超出「保留最近 ${KEEP_VERSIONS} 个版本」的旧安装包（删除后不可直接回滚至该版本）`,
      detail: stale.map((x) => x.file),
    })
    // 对应 blockmap：latest.yml 可能仍引用，一并列为需确认
    const staleMap = stale.map(
      (x) => `雷霆记账 Setup ${x.version}.exe.blockmap`
    )
    const bm = staleMap.filter((f) => listDir('release').includes(f))
    if (bm.length) {
      CONFIRM.push({
        path: `release/*.blockmap（对应上述旧版本）: ${bm.length} 个`,
        bytes: bm.reduce(
          (s, f) => s + fs.statSync(path.join(ROOT, 'release', f)).size,
          0
        ),
        reason: 'electron-updater 差分更新清单，可能仍被 latest.yml 引用 —— 需人工确认后删',
        detail: bm,
      })
    }
  } else {
    KEEP.push({
      path: `release/${fam.label}`,
      bytes: 0,
      reason: `当前共 ${all.length} 个版本，未超出保留数 ${KEEP_VERSIONS}（合规）`,
      detail: all.map((x) => x.version),
    })
  }
}

// release/exe 中的打包日志
const relLogs = listDir('release').filter((f) => f.endsWith('.log'))
if (relLogs.length) {
  CONFIRM.push({
    path: `release/*.log: ${relLogs.length} 个`,
    bytes: relLogs.reduce(
      (s, f) => s + fs.statSync(path.join(ROOT, 'release', f)).size,
      0
    ),
    reason: '历史打包日志；可能含审计信息，删除前请确认无复查需求',
    detail: relLogs,
  })
}

// 安卓 APK：保留最近 KEEP_VERSIONS 个
const apks = listDir('release-android').filter((f) => f.endsWith('.apk'))
if (apks.length > KEEP_VERSIONS) {
  const sorted = apks
    .map((f) => {
      const st = fs.statSync(path.join(ROOT, 'release-android', f))
      return { file: f, mtime: st.mtimeMs, bytes: st.size }
    })
    .sort((a, b) => b.mtime - a.mtime)
  const stale = sorted.slice(KEEP_VERSIONS)
  CONFIRM.push({
    path: `release-android/*.apk: ${stale.length} 个超出保留数`,
    bytes: stale.reduce((s, x) => s + x.bytes, 0),
    reason: `APK 产物共 ${apks.length} 个，超出保留数 ${KEEP_VERSIONS}`,
    detail: stale.map((x) => x.file),
  })
}

// 根目录归档状态文件
for (const f of listDir('.')) {
  if (/^progress\.state\..*-archive-.*$/.test(f)) {
    entry('CONFIRM', f, '旧版本归档的状态快照，当前状态已另存于 progress.state')
  }
}

// exe/ 中的旧安装包（AGENTS.md：exe 只保留静默安装后的可运行程序）
const exeInstallers = versionedIn('exe', /^雷霆记账 Setup (\d+\.\d+\.\d+)\.exe$/)
if (exeInstallers.length) {
  CONFIRM.push({
    path: `exe/*安装包: ${exeInstallers.length} 个`,
    bytes: exeInstallers.reduce((s, x) => s + x.bytes, 0),
    reason: 'AGENTS.md 规定 exe/ 只保留可运行程序；安装包应只存在于 release/',
    detail: exeInstallers.map((x) => x.file),
  })
}

// ── 3. 项目外同源产物（冻结 worktree / 归档区 / 隔离区） ─────────────
//
// 为什么需要单独一段：「移出」动作只定义了**入口**，没定义**出口**——
//   建冻结 worktree 的纪律有（量测需在 detach 树上做），拆掉的纪律没有；
//   归档动作有授权、有 report、failed=0，但归档目的地没有保留期限规则。
// 结果 = 把堆积从 A 搬到 B，B 无人过问，而「只扫项目内」的清理器看不见 B。
//
// 安全判据（白名单式，绝不按名字模糊匹配兄弟目录）：
//   worktree  —— 只认 `git worktree list` 里**本仓库登记在册**的条目（权威来源）
//   archive / quarantine —— 只认 `thunder-accounting-` 前缀
//   其余兄弟目录一律列为 OUT OF SCOPE，不统计、不删除。

function git(cwd, args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      timeout: 15000,
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return ''
  }
}

function listRegisteredWorktrees() {
  const out = git(ROOT, ['worktree', 'list', '--porcelain'])
  if (!out) return []
  const items = []
  let cur = null
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (cur) items.push(cur)
      cur = { path: line.slice(9).trim(), head: '', detached: false }
    } else if (line.startsWith('HEAD ') && cur) {
      cur.head = line.slice(5, 12)
    } else if (line.trim() === 'detached' && cur) {
      cur.detached = true
    }
  }
  if (cur) items.push(cur)
  return items.filter((w) => path.resolve(w.path) !== ROOT)
}

const SIBLING_KEEP = []

const registered = listRegisteredWorktrees()
for (const w of registered) {
  if (!fs.existsSync(w.path)) {
    SIBLING_KEEP.push({
      path: path.relative(PARENT, w.path),
      bytes: 0,
      reason: 'git 登记了该 worktree，但目录已不存在 —— 元数据悬空，可 `git worktree prune` 清理',
    })
    continue
  }
  const dirty = git(w.path, ['status', '--short'])
    .split(/\r?\n/)
    .filter(Boolean)
  const bytes = du(w.path)
  if (dirty.length) {
    CONFIRM.push({
      path: path.relative(PARENT, w.path),
      bytes,
      reason: `冻结 worktree（detached ${w.head}）含 ${dirty.length} 处**未提交改动** —— 摘除前先导出 diff；脚本永不自动删脏 worktree`,
      detail: dirty.slice(0, 6),
      abs: w.path,
      isWorktree: true,
      dirty: true,
    })
  } else {
    SAFE.push({
      path: path.relative(PARENT, w.path),
      bytes,
      reason: `冻结 worktree（detached ${w.head}，工作区干净）—— 量测已完成，可用 git worktree remove 摘除`,
      abs: w.path,
      isWorktree: true,
    })
  }
}

// 本项目的归档区 / 早期隔离区：均带 `thunder-accounting-` 前缀，白名单式识别
const archRoots = new Set()
/** 归档区绝对路径（与隔离区分开收集 —— 归档走分层清理，隔离区可整体删） */
const archiveRootsAbs = []
if (fs.existsSync(PARENT)) {
  for (const name of fs.readdirSync(PARENT)) {
    const abs = path.join(PARENT, name)
    let isDir = false
    try {
      isDir = fs.statSync(abs).isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue
    if (/^thunder-accounting-cleanup-quarantine/.test(name)) {
      archRoots.add(name)
      CONFIRM.push({
        path: name,
        bytes: du(abs),
        reason:
          '早期清理的**隔离区** —— 隔离的设计意图是「缓冲待确认」，但没有到期机制：08-29 建，至今 18 天未确认删除',
        abs,
      })
    } else if (/^thunder-accounting-archive/.test(name)) {
      archRoots.add(name)
      archiveRootsAbs.push(abs)
      CONFIRM.push({
        path: name,
        bytes: du(abs),
        reason:
          'SAE 自改进流程的**归档区**（2026-09-15 23:52 依用户问答授权把项目内 36 个目录移出）—— 归档动作本身合规，但目的地没有保留期限规则。**改由 `--archive-prune` 分层处理**（删可重建层、留证据层）；本条目已加门闩，不随 `--include-risky` 整体删除',
        abs,
        archiveRoot: true,
      })
    }
  }
}

// 明确列出「未触碰」的兄弟目录，证明扫描是白名单式的
const foreign = []
if (fs.existsSync(PARENT)) {
  for (const name of fs.readdirSync(PARENT)) {
    const abs = path.join(PARENT, name)
    if (path.resolve(abs) === ROOT) continue
    if (archRoots.has(name)) continue
    if (registered.some((w) => path.resolve(w.path) === path.resolve(abs))) continue
    let isDir = false
    try {
      isDir = fs.statSync(abs).isDirectory()
    } catch {
      continue
    }
    if (isDir) foreign.push(name)
  }
}

// ── 3b. 归档区**分层**清理（--archive-prune） ────────────────────────
//
// 为什么分层：归档区里约 99% 是同一份源码产出的构建/安装副本（`build-v1.16.0` 与
// `build-v1.16.0-final` 实质是同版本两次拷贝），全部早于 release/ 保留的版本，
// 重建 = 跑一次打包；但 `visual-v1.16.4/` 这类**历史视觉基线难以复现**，必须留。
//
// 判据：**正向前缀白名单** —— 白名单内才删，白名单外一律保留。
// 「默认保留」是有意选择：判据必须确定，宁可少删不可误删。

const ARCHIVE_REBUILDABLE_PREFIXES = [
  'build-', // electron-builder win-unpacked 副本
  'custom-install-', // 定制安装版副本
  'installed-', // 已安装目录快照
  'inspect-', // 解包检查副本
  'verify-app-asar-', // asar 校验副本
  'inno-v', // Inno 安装包副本
  'inno-syntax-check-', // Inno 语法检查临时目录
]

const archivePlan = { delete: [], keep: [] }

/**
 * 归档区两级扫描：
 *   depth 0 = 归档根本身（子项：索引文件 + 各 release 目录）
 *   depth 1 = 各 release 目录（子项：可重建副本 + 证据目录）
 * depth ≥ 1 的非命中目录一律**整体保留**，不再下降（否则会把 visual-* 里
 * 1046 个文件逐个列出来，既吵又慢）。
 */
function walkArchive(dirAbs, relPrefix, depth) {
  if (depth > 1) return
  let entries = []
  try {
    entries = fs.readdirSync(dirAbs)
  } catch {
    return
  }
  for (const e of entries) {
    const abs = path.join(dirAbs, e)
    let st
    try {
      st = fs.statSync(abs)
    } catch {
      continue
    }
    const rel = relPrefix ? `${relPrefix}/${e}` : e
    if (!st.isDirectory()) {
      archivePlan.keep.push({
        path: rel,
        bytes: st.size,
        reason: depth === 0 ? '根级索引 / 脚本文件 —— 永不进入删除候选' : '散落文件 —— 默认保留',
      })
      continue
    }
    const hit = ARCHIVE_REBUILDABLE_PREFIXES.find((p) => e.startsWith(p))
    if (hit) {
      archivePlan.delete.push({
        path: rel,
        bytes: du(abs),
        reason: `可重建构建/安装副本（前缀 ${hit}）`,
        abs,
      })
      continue // 命中即整体删，不再下降
    }
    if (depth === 0) {
      // 非命中的一级目录 = release 容器，下降一层继续找可重建子目录
      walkArchive(abs, rel, depth + 1)
    } else {
      archivePlan.keep.push({
        path: rel,
        bytes: du(abs),
        reason: '证据层（不在可重建白名单内）→ 默认保留',
        abs,
      })
    }
  }
}

for (const rootAbs of archiveRootsAbs) {
  walkArchive(rootAbs, path.basename(rootAbs), 0)
}

// ── 4. 永不自动删（只列出，供人工判断） ────────────────────────────

entry('KEEP', 'artifacts', '审计证据（sae-audit-* / wiki-entry-* / 门禁 manifest 与回执）')
entry('KEEP', 'exe', 'AGENTS.md 指定的固定安装验收目录')
for (const f of ['latest.yml', 'builder-debug.yml']) {
  entry('KEEP', `release/${f}`, 'electron-updater / electron-builder 元数据，被分发链路引用')
}
for (const f of ['PRD.md', 'task_plan.md', 'findings.md', 'progress.md', 'progress.state']) {
  entry('KEEP', f, '项目文档 / 计划 / 研究记录，需人工判断是否归档')
}

// ── 5. 输出 ────────────────────────────────────────────────────────

const sum = (arr) => arr.reduce((s, x) => s + (x.bytes || 0), 0)
const report = {
  generated_at: new Date().toISOString(),
  root: ROOT,
  parent: PARENT,
  mode: ARCHIVE_PRUNE
    ? APPLY
      ? 'apply-archive-prune'
      : 'report-archive-prune'
    : APPLY
      ? INCLUDE_RISKY
        ? 'apply-include-risky'
        : 'apply-safe'
      : 'report',
  keep_versions: KEEP_VERSIONS,
  totals: {
    SAFE: { count: SAFE.length, bytes: sum(SAFE) },
    CONFIRM: { count: CONFIRM.length, bytes: sum(CONFIRM) },
    KEEP: { count: KEEP.length, bytes: sum(KEEP) },
  },
  SAFE,
  CONFIRM,
  KEEP,
  sibling_keep: SIBLING_KEEP,
  out_of_scope: foreign,
  archive_prune: ARCHIVE_PRUNE
    ? { delete: archivePlan.delete, keep: archivePlan.keep }
    : null,
}

function section(title, arr) {
  console.log(`\n${title}`)
  if (!arr.length) {
    console.log('  （无）')
    return
  }
  for (const it of arr) {
    console.log(`  ${human(it.bytes).padStart(9)}  ${it.path}`)
    console.log(`             └─ ${it.reason}`)
    if (it.detail && it.detail.length) {
      console.log(`             └─ ${it.detail.slice(0, 8).join(' | ')}${it.detail.length > 8 ? ` …(共 ${it.detail.length})` : ''}`)
    }
  }
  console.log(`  ── 小计 ${arr.length} 项，${human(sum(arr))}`)
}

console.log('═'.repeat(72))
console.log(' 工作区实验产物清理报告 — thunder-accounting')
console.log(` 生成时间 ${report.generated_at}   模式 ${report.mode}`)
console.log('═'.repeat(72))

section('【SAFE】可重建产物（--apply 即删除）', SAFE)
section('【CONFIRM】有回滚/审计价值（需 --apply --include-risky）', CONFIRM)
section('【KEEP】永不自动删（仅列出）', KEEP)

if (SIBLING_KEEP.length) section('【悬空登记】git 有记录但目录已不存在', SIBLING_KEEP)

if (foreign.length) {
  console.log('\n【OUT OF SCOPE】父目录下未识别为本项目产物的目录（不统计、不删除）')
  console.log('  ' + foreign.join('  ·  '))
}

if (ARCHIVE_PRUNE) {
  section('【ARCHIVE-PRUNE · 删除】可重建构建/安装副本', archivePlan.delete)
  section('【ARCHIVE-PRUNE · 保留】证据层 + 根级索引', archivePlan.keep)
}

console.log('\n' + '─'.repeat(72))
if (ARCHIVE_PRUNE) {
  console.log(
    ` 归档分层：可回收 ${human(sum(archivePlan.delete))}（${archivePlan.delete.length} 项）` +
      `   保留 ${human(sum(archivePlan.keep))}（${archivePlan.keep.length} 项）`
  )
} else {
  console.log(
    ` 可立即回收：${human(sum(SAFE))}（${SAFE.length} 项）` +
      `   需确认后回收：${human(sum(CONFIRM))}（${CONFIRM.length} 项）`
  )
}
console.log('─'.repeat(72))

if (JSON_OUT) {
  const abs = path.isAbsolute(JSON_OUT) ? JSON_OUT : path.join(ROOT, JSON_OUT)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, JSON.stringify(report, null, 2), 'utf8')
  console.log(` 报告已落盘：${abs}`)
}

// ── 6. 执行删除 ────────────────────────────────────────────────────

if (!APPLY) {
  console.log(
    ARCHIVE_PRUNE
      ? '\n [report 模式] 未删除任何内容。加 --apply 执行归档分层清理。\n'
      : '\n [report 模式] 未删除任何内容。加 --apply 执行 SAFE 级别清理。\n'
  )
  process.exit(0)
}

// ── 归档分层清理（独立路径：有自己的白名单判据，不走 SAFE/CONFIRM 分级） ──
if (ARCHIVE_PRUNE) {
  let aRemoved = 0
  const aFailed = []
  for (const t of archivePlan.delete) {
    try {
      if (fs.existsSync(t.abs)) {
        fs.rmSync(t.abs, { recursive: true, force: true })
        aRemoved++
        console.log(`  [归档-删除] ${t.path}  (${human(t.bytes)})`)
      }
    } catch (e) {
      aFailed.push(`${t.path}: ${e.message}`)
    }
  }
  console.log(
    `\n 归档分层完成：删除 ${aRemoved} 项（${human(sum(archivePlan.delete))}），失败 ${aFailed.length} 项`
  )
  console.log(` 保留 ${archivePlan.keep.length} 项（${human(sum(archivePlan.keep))}）未触碰`)
  if (aFailed.length) {
    console.log(' 失败明细（常见原因：文件被占用 / 只读）：')
    for (const f of aFailed) console.log(`   - ${f}`)
  }
  console.log('')
  process.exit(0)
}

// 脏 worktree 永不自动删（未提交改动需人工先导出），即使开了 --include-risky
const targets = [
  ...SAFE,
  // archiveRoot 走 --archive-prune 分层，绝不随 --include-risky 整体删除（门闩）
  ...(INCLUDE_RISKY ? CONFIRM.filter((t) => !t.dirty && !t.archiveRoot) : []),
]
const skippedDirty = CONFIRM.filter((t) => t.dirty)

let removed = 0
let failed = 0
const failures = []

for (const t of targets) {
  // worktree 不能用 rm —— 必须走 git，否则 .git/worktrees/ 会留悬空元数据
  if (t.isWorktree) {
    try {
      execFileSync('git', ['-C', ROOT, 'worktree', 'remove', t.abs], {
        timeout: 60000,
        killSignal: 'SIGKILL',
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      removed++
      console.log(`  [摘除 worktree] ${t.path}`)
    } catch (e) {
      failed++
      failures.push(`${t.path}: ${String(e.message).split('\n')[0]}`)
    }
    continue
  }

  if (t.detail && t.detail.length) {
    // 带 detail 的条目 = 逐文件删除（安装包 / blockmap / apk）
    const dir =
      t.path.startsWith('release-android')
        ? 'release-android'
        : t.path.startsWith('exe')
          ? 'exe'
          : 'release'
    for (const f of t.detail) {
      const abs = path.join(ROOT, dir, f)
      try {
        if (fs.existsSync(abs)) {
          fs.rmSync(abs, { force: true })
          removed++
          console.log(`  [删除] ${path.relative(ROOT, abs)}`)
        }
      } catch (e) {
        failed++
        failures.push(`${path.relative(ROOT, abs)}: ${e.message}`)
      }
    }
    continue
  }

  const abs = t.abs || path.join(ROOT, t.path)
  try {
    if (fs.existsSync(abs)) {
      fs.rmSync(abs, { recursive: true, force: true })
      removed++
      console.log(`  [删除] ${t.path}  (${human(t.bytes)})`)
    }
  } catch (e) {
    failed++
    failures.push(`${t.path}: ${e.message}`)
  }
}

console.log(`\n 清理完成：成功 ${removed} 项，失败 ${failed} 项`)
if (skippedDirty.length) {
  console.log(` 跳过脏 worktree ${skippedDirty.length} 项（含未提交改动，需人工处理）：`)
  for (const t of skippedDirty) console.log(`   - ${t.path}`)
}
if (failures.length) {
  console.log(' 失败明细（常见原因：文件被占用 / 只读）：')
  for (const f of failures) console.log(`   - ${f}`)
}
console.log('')

process.exit(0)
