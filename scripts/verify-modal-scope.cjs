#!/usr/bin/env node
/**
 * verify-modal-scope.cjs —— Portal 模态作用域替身的「可执行回归断言」。
 *
 * 动机：v1.17.5 的主报 bug（记一笔面板宽度随内容塌缩）在 jsdom 里没有排版引擎，
 * vitest 恒绿，唯一决定性证据是人工跑的一次量测脚本。本脚本把那套量测固化为
 * 可重复执行的验证步骤：用真实构建 CSS + 真浏览器量测「有/无作用域替身」的
 * 面板几何与配色，并对负对照组断言「问题必须复现」。
 *
 * 设计约束：
 *  - 只依赖 Node 内置模块，不新增任何依赖。
 *  - 不往 app-out/renderer 写任何文件（那是会被打进 app.asar 的打包产物）。
 *    改为在系统临时目录写一个自包含 HTML（真实构建 CSS 内联成 <style>），
 *    再用 file:// 打开量测。**不要改成「同进程 HTTP 服务」**：execFileSync 会同步
 *    阻塞 Node 事件循环，同进程的 http server 永远无法响应请求，浏览器会一直等文档，
 *    造成互锁死锁（v1.17.6 实测卡死 12 分钟以上）；file:// 实测 0.6s 完成。
 *  - 浏览器调用带 90s 硬超时 + SIGKILL，绝不允许把调用方会话挂死。
 *  - 只读量测：app-out/renderer/assets/index-*.css 必须由 `npm run build` 产出。
 *
 * 退出码：
 *  0 = PASS
 *  1 = FAIL（断言不通过）
 *  2 = 环境未就绪（缺构建 CSS / 找不到可用浏览器）
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const ASSETS_DIR = path.join(ROOT, 'app-out', 'renderer', 'assets')

const VIEWPORT_W = 1280
const VIEWPORT_H = 900

function fail(msg, code) {
  console.error(msg)
  process.exit(code)
}

// ── 1. 前置检查：必须已有构建 CSS ────────────────────────────────────────────
function findBuildCss() {
  if (!fs.existsSync(ASSETS_DIR)) return null
  const css = fs
    .readdirSync(ASSETS_DIR)
    .filter((f) => f.endsWith('.css'))
    .sort()
  if (css.length === 0) return null
  // 取最新的那份（index-*.css 通常唯一）
  const sorted = css
    .map((f) => ({ f, m: fs.statSync(path.join(ASSETS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)
  return path.join(ASSETS_DIR, sorted[0].f)
}

// ── 2. 浏览器定位 ───────────────────────────────────────────────────────────
function findBrowser() {
  const candidates = []

  if (process.env.CHROME_HEADLESS_SHELL && fs.existsSync(process.env.CHROME_HEADLESS_SHELL)) {
    candidates.push(process.env.CHROME_HEADLESS_SHELL)
  }

  // Playwright 缓存的 chrome-headless-shell（readdir 通配，不硬编码版本号）
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

// ── 3. 生成被量测页面 ───────────────────────────────────────────────────────
function buildHtml(cssText) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<style>html,body{margin:0;padding:0;height:100%;overflow:hidden}</style>
<style>${cssText}</style>
</head>
<body>
<!-- 应用外壳（模拟 src/components/Layout.tsx:44：dark + data-theme + aurora-shell） -->
<div id="shell" class="dark aurora-shell" data-theme="dark">
  <div style="padding:24px;color:var(--text)">应用外壳（深色主题）</div>
</div>

<pre id="out" style="display:none"></pre>

<script>
(function () {
  var W = document.documentElement.clientWidth
  var H = document.documentElement.clientHeight
  var results = {}

  function makeOverlay(theme, withShim, contentWidth) {
    var root = document.createElement('div')
    root.className =
      (withShim ? 'aurora-shell aurora-portal-root ' : '') +
      (withShim && theme === 'dark' ? 'dark ' : '') +
      'flex items-center justify-center'
    if (withShim) root.setAttribute('data-theme', theme)
    // 与模态组件一致的内联视口几何（见 GEOMETRY 契约）
    root.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:9000'

    var backdrop = document.createElement('div')
    backdrop.className = 'absolute inset-0 bg-black/40'
    root.appendChild(backdrop)

    var panel = document.createElement('div')
    panel.className = 'relative rounded-2xl shadow-xl aurora-dialog add-bill-dialog'
    // 用固定宽内容模拟「分类未选 / 已选」导致的内容宽度变化
    panel.innerHTML =
      '<div class="panel-content" style="width:' + contentWidth + 'px;flex:none">' +
      '<div style="height:36px;border:1px solid #ccc;border-radius:8px"></div></div>'
    root.appendChild(panel)

    document.body.appendChild(root)
    var rect = root.getBoundingClientRect()
    var rootCs = getComputedStyle(root)
    var panelCs = getComputedStyle(panel)
    var out = {
      panelWidth: panel.getBoundingClientRect().width,
      panelBg: panelCs.backgroundColor,
      rootBg: rootCs.backgroundColor,
      overlayRect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)],
      coversViewport: rect.left === 0 && rect.top === 0 &&
        Math.round(rect.width) === W && Math.round(rect.height) === H
    }
    document.body.removeChild(root)
    return out
  }

  ;['dark', 'light'].forEach(function (theme) {
    var shell = document.getElementById('shell')
    shell.className = (theme === 'dark' ? 'dark ' : '') + 'aurora-shell'
    shell.setAttribute('data-theme', theme)

    ;[false, true].forEach(function (shim) {
      var key = (shim ? 'withShim' : 'noShim') + '_' + theme
      results[key] = {
        content248: makeOverlay(theme, shim, 248),
        content306: makeOverlay(theme, shim, 306)
      }
    })
  })

  Object.keys(results).forEach(function (k) {
    var a = results[k].content248.panelWidth
    var b = results[k].content306.panelWidth
    results[k].widthDelta = Math.round(Math.abs(a - b) * 100) / 100
    results[k].widthStable = Math.abs(a - b) < 1
  })

  results.__viewport = [W, H]
  results.__rootFontPx = parseFloat(getComputedStyle(document.documentElement).fontSize)
  document.getElementById('out').textContent = JSON.stringify(results, null, 2)
})()
</script>
</body>
</html>`
}

// ── 4. 主流程 ───────────────────────────────────────────────────────────────
function main() {
  const jsonFlagIdx = process.argv.indexOf('--json')
  const jsonOutPath = jsonFlagIdx >= 0 ? process.argv[jsonFlagIdx + 1] : null

  const cssPath = findBuildCss()
  if (!cssPath) {
    fail(
      'VERIFY_MODAL_SCOPE: SKIP\n' +
        '未找到 app-out/renderer/assets/*.css —— 请先执行 npm run build',
      2
    )
  }

  const browser = findBrowser()
  if (!browser) {
    fail(
      'VERIFY_MODAL_SCOPE: SKIP\n' +
        '未找到可用浏览器。可用方式（按序尝试）：\n' +
        '  1) 设置环境变量 CHROME_HEADLESS_SHELL 指向 chrome-headless-shell.exe\n' +
        '  2) 安装 Playwright 缓存：%LOCALAPPDATA%/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-win64/chrome-headless-shell.exe\n' +
        '  3) %ProgramFiles%/Google/Chrome/Application/chrome.exe\n' +
        '  4) %ProgramFiles(x86)%/Microsoft/Edge/Application/msedge.exe',
      2
    )
  }

  const cssText = fs.readFileSync(cssPath, 'utf8')
  const html = buildHtml(cssText)

  // 自包含单页：CSS 已内联、无外链、无 module 脚本 → file:// 足够且快（实测 0.6s）。
  // 注意不要改成 http server：execFileSync 同步阻塞事件循环会让同进程 server 互锁死锁。
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modal-scope-'))
  const htmlPath = path.join(tmpDir, 'probe.html')
  fs.writeFileSync(htmlPath, html, 'utf8')

  console.log(`  CSS   : ${path.relative(ROOT, cssPath)}`)
  console.log(`  浏览器: ${browser}`)
  console.log(`  视口  : ${VIEWPORT_W}x${VIEWPORT_H}`)
  console.log('  量测中（90s 硬超时）...')

  let dump = ''
  let execErr = null

  try {
    dump = execFileSync(
      browser,
      [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--no-first-run',
        '--no-default-browser-check',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        `--window-size=${VIEWPORT_W},${VIEWPORT_H}`,
        `--user-data-dir=${path.join(tmpDir, 'profile')}`,
        '--dump-dom',
        pathToFileURL(htmlPath).href
      ],
      {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 90000,
        killSignal: 'SIGKILL'
      }
    )
  } catch (e) {
    execErr = e
    dump = (e.stdout || '').toString()
  }

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    /* 临时目录清理失败可忽略 */
  }

    if (execErr && !dump) {
      fail(
        'VERIFY_MODAL_SCOPE: FAIL\n浏览器执行失败：' + (execErr.message || String(execErr)) +
          '\nstderr: ' + ((execErr.stderr || '').toString() || '(空)'),
        1
      )
    }

    // 注意：`` 序列化后会带上属性（如 style="display:none"），正则必须容忍属性，不能精确匹配 <pre id="out">
    const m = dump.match(/<pre id="out"[^>]*>([\s\S]*?)<\/pre>/)
    if (!m) {
      fail('VERIFY_MODAL_SCOPE: FAIL\n未能从浏览器 DOM 中读回 <pre id="out"> 量测结果。', 1)
    }

    let results
    try {
      results = JSON.parse(m[1])
    } catch (e) {
      fail('VERIFY_MODAL_SCOPE: FAIL\n量测结果 JSON 解析失败：' + e.message + '\n原文：' + m[1].slice(0, 500), 1)
    }

    const failures = []
    const M = (v) => Math.round(v * 100) / 100

    // 视口必须够宽，才能命中 @media (min-width:640px) 的 28rem 版式
    const [vw, vh] = results.__viewport
    if (vw < 640) {
      fail(`VERIFY_MODAL_SCOPE: FAIL\n量测视口过窄（${vw}px < 640px），无法验证 28rem 版式。`, 1)
    }
    const remPx = results.__rootFontPx || 16
    const expected = 28 * remPx

    const need = ['noShim_dark', 'noShim_light', 'withShim_dark', 'withShim_light']
    for (const k of need) {
      if (!results[k]) fail(`VERIFY_MODAL_SCOPE: FAIL\n缺少量测组：${k}`, 1)
    }

    // A. 修复有效：withShim 下宽度稳定且等于 28rem
    for (const k of ['withShim_dark', 'withShim_light']) {
      const g = results[k]
      if (!g.widthStable || g.widthDelta !== 0) {
        failures.push(`[A] ${k} 面板宽度不稳定：极差=${g.widthDelta}px（期望 0）`)
      }
      for (const c of ['content248', 'content306']) {
        const w = g[c].panelWidth
        if (Math.abs(w - expected) > 1) {
          failures.push(`[A] ${k}.${c} 面板宽度=${M(w)}px，期望 28rem=${M(expected)}px（容差 ±1px）`)
        }
      }
    }

    // B. 深色/浅色有效
    const darkBg = results.withShim_dark.content248.panelBg
    const lightBg = results.withShim_light.content248.panelBg
    if (darkBg !== 'rgb(32, 34, 36)') {
      failures.push(`[B] withShim_dark 面板底色=${darkBg}，期望 rgb(32, 34, 36)`)
    }
    if (lightBg !== 'rgb(255, 250, 242)') {
      failures.push(`[B] withShim_light 面板底色=${lightBg}，期望 rgb(255, 250, 242)`)
    }

    // C. 遮罩未回退：四组都覆盖视口
    for (const k of need) {
      for (const c of ['content248', 'content306']) {
        if (!results[k][c].coversViewport) {
          failures.push(`[C] ${k}.${c} 遮罩未铺满视口：rect=${JSON.stringify(results[k][c].overlayRect)} viewport=${JSON.stringify(results.__viewport)}`)
        }
      }
    }

    // D. 替身根不得带底色
    for (const k of ['withShim_dark', 'withShim_light']) {
      const bg = results[k].content248.rootBg
      if (bg !== 'rgba(0, 0, 0, 0)') {
        failures.push(`[D] ${k} 替身根底色=${bg}，期望透明 rgba(0, 0, 0, 0)`)
      }
    }

    // E. 负对照：无替身必须复现「宽度随内容塌缩」
    for (const k of ['noShim_dark', 'noShim_light']) {
      if (results[k].widthStable) {
        failures.push(`[E] 负对照失效：${k} 宽度竟然稳定（极差=${results[k].widthDelta}px）——验证器已成橡皮图章`)
      }
    }

    // ── 输出对照表 ──
    const pad = (s, n) => String(s).padEnd(n, ' ')
    const rows = ['mode', 'w248', 'w306', 'range', 'panelBg', 'coversViewport']
    console.log('')
    console.log(pad('mode', 16) + pad('w248', 10) + pad('w306', 10) + pad('range', 8) + pad('panelBg', 20) + 'coversViewport')
    console.log('-'.repeat(72))
    for (const k of need) {
      const g = results[k]
      console.log(
        pad(k, 16) +
          pad(M(g.content248.panelWidth), 10) +
          pad(M(g.content306.panelWidth), 10) +
          pad(M(g.widthDelta), 8) +
          pad(g.content248.panelBg, 20) +
          (g.content248.coversViewport && g.content306.coversViewport ? 'true' : 'false')
      )
    }
    console.log('')
    console.log(`viewport=${vw}x${vh}  rootFont=${remPx}px  28rem=${M(expected)}px`)
    console.log(`buildCss=${path.relative(ROOT, cssPath)}`)
    console.log(`browser=${browser}`)
    console.log('')

    if (jsonOutPath) {
      fs.mkdirSync(path.dirname(path.resolve(jsonOutPath)), { recursive: true })
      fs.writeFileSync(path.resolve(jsonOutPath), JSON.stringify(results, null, 2), 'utf8')
      console.log(`已写出原始量测 JSON：${jsonOutPath}`)
    }

    if (failures.length > 0) {
      console.error('VERIFY_MODAL_SCOPE: FAIL')
      for (const f of failures) console.error('  - ' + f)
      process.exit(1)
    }

    console.log('VERIFY_MODAL_SCOPE: PASS')
    process.exit(0)
}

main()
