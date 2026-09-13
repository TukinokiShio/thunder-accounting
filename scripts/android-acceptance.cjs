#!/usr/bin/env node
/**
 * 雷霆记账 安卓端 —— 本机安卓环境（模拟器）自动验收
 *
 * 为什么是 .cjs 而不是 .sh：本机未安装 Git Bash，cmd 里的 `bash` 指向 WSL（未装分发），
 * 所以 `bash xxx.sh` 必然失败；PowerShell 同理。用 Node 写则 **cmd / PowerShell / Git Bash
 * 三处都能直接跑**，只要 `node` 在 PATH（npm 能用就说明它在）。
 *
 * 用法（在**项目根目录**执行）：
 *   npm run android:accept                 # 保留设备上的数据
 *   npm run android:accept -- --pm-clear   # 清数据（等价全新首启，会删该应用全部本地账本）
 *   set OUT=release-android\acc5 && npm run android:accept      (cmd)
 *
 * 环境变量：OUT（产物目录）、AVD（默认 Pixel_8）、ANDROID_HOME、JAVA_HOME
 *
 * ⚠️ 本脚本会启动模拟器与 Gradle：沙箱环境跑不了，请在普通终端执行。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync, spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const ANDROID_HOME = process.env.ANDROID_HOME || 'E:/Code/Android/sdk'
const JAVA_HOME = process.env.JAVA_HOME || 'E:/Code/Android Studio/AS/jbr' // JBR 21；禁用系统 JDK 24
const ADB = path.join(ANDROID_HOME, 'platform-tools', 'adb.exe')
const EMULATOR = path.join(ANDROID_HOME, 'emulator', 'emulator.exe')
const BUILD_TOOLS = path.join(ANDROID_HOME, 'build-tools', '36.0.0')
const AVD = process.env.AVD || 'Pixel_8'
const PKG = 'com.thunder.accounting'
const PM_CLEAR = process.argv.includes('--pm-clear')

const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '')
const OUT = path.resolve(ROOT, process.env.OUT || path.join('release-android', `acc-${stamp}`))
fs.mkdirSync(OUT, { recursive: true })
const LOG = path.join(OUT, 'run.log')
fs.writeFileSync(LOG, '')

function log(...a) {
  const line = a.join(' ')
  console.log(line)
  fs.appendFileSync(LOG, line + '\n')
}
function step(t) { log(''); log(`===== ${t} =====`) }

/** 外部调用统一封装：打印上下文（供挂死时判断）+ 硬超时 SIGKILL —— 项目历史踩坑要求 */
function run(cmd, args, opts = {}) {
  const label = `${path.basename(cmd)} ${args.slice(0, 2).join(' ')}`
  log(`  $ ${label}${opts.timeout ? `   (timeout ${opts.timeout}ms)` : ''}`)
  try {
    const out = execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: opts.timeout || 300000,
      killSignal: 'SIGKILL',
      maxBuffer: opts.maxBuffer || 64 * 1024 * 1024,
      stdio: opts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      cwd: opts.cwd || ROOT,
      env: { ...process.env, ANDROID_HOME, ANDROID_SDK_ROOT: ANDROID_HOME, JAVA_HOME,
             PATH: `${path.join(JAVA_HOME, 'bin')};${path.join(ANDROID_HOME, 'platform-tools')};${path.join(ANDROID_HOME, 'emulator')};${process.env.PATH}` },
    })
    return { ok: true, out: typeof out === 'string' ? out : '' }
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`
    log(`  ! 退出码 ${e.status}${e.signal ? ` (signal ${e.signal})` : ''}`)
    if (out.trim()) log('  ' + out.trim().split('\n').slice(-6).join('\n  '))
    return { ok: false, out, status: e.status }
  }
}
const adb = (args, opts) => run(ADB, args, opts)
const adbSh = (args, opts) => adb(['shell', ...args], opts)

async function main() {
  step('0 环境')
  log(`  JAVA_HOME = ${JAVA_HOME}`)
  log(`  ANDROID_HOME = ${ANDROID_HOME}`)
  log(`  AVD = ${AVD}   OUT = ${OUT}   PM_CLEAR = ${PM_CLEAR}`)
  log(`  node = ${process.version}   cwd = ${process.cwd()}`)
  if (!fs.existsSync(ADB)) { log(`  ✗ 找不到 adb：${ADB}（可用 ANDROID_HOME 覆盖）`); process.exit(1) }
  if (!fs.existsSync(path.join(JAVA_HOME, 'bin', 'java.exe'))) {
    log(`  ⚠️ 找不到 JBR：${JAVA_HOME}`); log('     （安卓构建必须 JBR 21；系统 JDK 24 会报 Unsupported class file major version）')
  }
  if (PM_CLEAR) {
    log('')
    log('  ⚠️ 你指定了 --pm-clear：会删除 ' + PKG + ' 的**全部本地账本数据**（含已录入账单，不可恢复）')
    log('     若该设备上有你要保留的数据，请立刻 Ctrl-C。3 秒后继续…')
    await new Promise(r => setTimeout(r, 3000))
  }

  step('1 构建安卓 web 产物 + APK')
  // 经 npm 运行时复用它自己的 cli（npm_execpath），否则退回 npm.cmd —— 两种环境都能跑
  const npmExec = process.env.npm_execpath && fs.existsSync(process.env.npm_execpath)
    ? [process.execPath, [process.env.npm_execpath]]
    : [process.platform === 'win32' ? 'npm.cmd' : 'npm', []]
  const r1 = run(npmExec[0], [...npmExec[1], 'run', 'build:android'], { timeout: 300000, inherit: true })
  log(`  BUILD_ANDROID_EXIT=${r1.ok ? 0 : r1.status}`)
  const wasm = path.join(ROOT, 'dist-android', 'sql-wasm-browser.wasm')
  if (fs.existsSync(wasm)) log(`  ✓ wasm 在 webDir 根：${fs.statSync(wasm).size} bytes`)
  else log(`  ✗ 未找到 ${wasm}`)

  // Windows 的 .bat 不能用 execFile 直接执行（Node 会报 EINVAL），必须经 cmd.exe /c
  const ANDROID_DIR = path.join(ROOT, 'android')
  const r2 = run('cmd.exe', ['/c', 'gradlew.bat assembleDebug --console=plain'],
    { timeout: 900000, inherit: true, cwd: ANDROID_DIR })
  log(`  ASSEMBLE_EXIT=${r2.ok ? 0 : r2.status}`)
  const APK = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
  if (!fs.existsSync(APK)) { log(`  ✗ 未产出 APK：${APK}`); process.exit(1) }
  log(`  ✓ APK：${APK}（${fs.statSync(APK).size} bytes）`)

  step('2 启动模拟器（本进程内自带生命周期；后台任务会被宿主回收）')
  log(`  $ emulator -avd ${AVD} -no-window -gpu swiftshader_indirect`)
  const emu = spawn(EMULATOR, ['-avd', AVD, '-no-snapshot', '-no-boot-anim', '-no-audio',
    '-no-window', '-gpu', 'swiftshader_indirect'], { detached: true, stdio: 'ignore' })
  emu.unref()
  adb(['wait-for-device'], { timeout: 300000 })
  let booted = false
  for (let i = 1; i <= 75; i++) {
    const b = adbSh(['getprop', 'sys.boot_completed'], { timeout: 30000 }).out.trim()
    if (b === '1') { log(`  ✓ boot_completed=1 @probe#${i}`); booted = true; break }
    await new Promise(r => setTimeout(r, 4000))
  }
  if (!booted) { log('  ✗ 模拟器未在超时内启动完成'); process.exit(1) }
  log('  ' + adb(['devices']).out.trim().split('\n').join('\n  '))

  step('3 安装')
  // 注意：adb.exe 是 Windows 程序，路径必须给 E:/... 形式；给 /e/... 会静默安装失败
  const ins = adb(['install', '-r', '-t', APK], { timeout: 240000 })
  log(`  INSTALL_${ins.ok ? 'OK' : 'FAIL'}：${ins.out.trim().split('\n').slice(-2).join(' | ')}`)
  if (PM_CLEAR) { log('  pm clear（已在步骤 0 声明）：' + adbSh(['pm', 'clear', PKG]).out.trim()) }

  step('4 首次启动')
  adb(['logcat', '-c'])
  adbSh(['am', 'start', '-n', `${PKG}/.MainActivity`])
  // ⚠️ swiftshader 下冷启动约 12s 白屏、20~40s 才渲染完；等待 <20s 会把「慢」误判为「白屏」
  log('  等待 32s（模拟器冷启动很慢，这是已知现象，不是卡死）…')
  await new Promise(r => setTimeout(r, 32000))
  const act = adbSh(['dumpsys', 'activity', 'activities']).out.split('\n').find(l => l.includes('topResumedActivity'))
  log(`  前台：${(act || '（未取到）').trim()}`)
  const ps = adbSh(['ps', '-A']).out.split('\n').filter(l => l.includes(PKG)).join(' | ')
  log(`  进程：${ps || '（未找到）'}`)
  const crash = adb(['logcat', '-b', 'crash', '-d']).out.trim()
  log(`  崩溃日志：${crash ? crash.split('\n').slice(-8).join('\n  ') : '（空 ✓）'}`)
  const lc = adb(['logcat', '-d']).out
  const wasmReq = [...new Set((lc.match(/Handling local request: https:\/\/localhost\/[^ \n]*/g) || []))].sort()
  log('  本地资源请求（应含 sql-wasm-browser.wasm）：'); wasmReq.forEach(x => log('    ' + x))
  log(`  Filesystem 调用：${JSON.stringify(
    (lc.match(/methodName: [A-Za-z]+/g) || []).reduce((a, m) => (a[m.slice(12)] = (a[m.slice(12)] || 0) + 1, a), {}))}`)
  adbSh(['screencap', '-p', '/sdcard/a1.png']); adb(['pull', '/sdcard/a1.png', path.join(OUT, '01-home.png')])

  step('5 滚动后 sticky 顶栏（安全区）')
  adbSh(['input', 'swipe', '540', '1600', '540', '900', '300'])
  await new Promise(r => setTimeout(r, 2000))
  adbSh(['screencap', '-p', '/sdcard/a2.png']); adb(['pull', '/sdcard/a2.png', path.join(OUT, '02-scrolled.png')])

  step('6 杀进程 → 重启读回（持久化闭环）')
  adbSh(['am', 'force-stop', PKG])
  await new Promise(r => setTimeout(r, 2000))
  adb(['logcat', '-c'])
  adbSh(['am', 'start', '-n', `${PKG}/.MainActivity`])
  await new Promise(r => setTimeout(r, 25000))
  const lc2 = adb(['logcat', '-d']).out
  const fs2 = (lc2.match(/methodName: (readFile|readdir|writeFile|deleteFile)/g) || [])
    .reduce((a, m) => (a[m.slice(12)] = (a[m.slice(12)] || 0) + 1, a), {})
  log(`  二次启动 Filesystem 调用：${JSON.stringify(fs2)}`)
  log(`  ${(fs2.readFile || 0) > 0 ? '✓ 出现 readFile —— 旧库被读回（持久化闭环成立）' : '✗ 未出现 readFile'}`)
  adbSh(['screencap', '-p', '/sdcard/a3.png']); adb(['pull', '/sdcard/a3.png', path.join(OUT, '03-restart.png')])

  step('7 拉回设备上的 .db 并校验')
  const found = adbSh(['run-as', PKG, 'find', `/data/data/${PKG}`, '-name', '*.db'], { timeout: 60000 }).out.trim()
  const dba = found.split('\n').filter(Boolean)[0]
  log(`  设备路径：${dba || '（未找到）'}`)
  if (dba) {
    const size = adbSh(['run-as', PKG, 'stat', '-c', '%s', dba], { timeout: 60000 }).out.trim()
    log(`  size=${size}`)
    // exec-out 是二进制安全的；不要用 adb shell ... cp 到 /sdcard（会被拒）
    try {
      const buf = execFileSync(ADB, ['exec-out', 'run-as', PKG, 'cat', dba], { maxBuffer: 64 * 1024 * 1024, timeout: 120000 })
      const local = path.join(OUT, 'pulled.db')
      fs.writeFileSync(local, buf)
      log(`  ✓ 已拉回：${local}（${buf.length} bytes）`)
      log(`  头部：${JSON.stringify(buf.slice(0, 15).toString('latin1'))}`)
      try {
        const initSqlJs = require('sql.js')
        const SQL = await initSqlJs()
        const db = new SQL.Database(new Uint8Array(buf))
        const q = (sql) => { try { return db.exec(sql)[0]?.values ?? [] } catch { return [] } }
        log(`  表：${JSON.stringify(q("select name from sqlite_master where type='table' order by name").flat())}`)
        log(`  索引：${JSON.stringify(q("select name from sqlite_master where type='index' and name not like 'sqlite_%' order by name").flat())}`)
        log(`  预设分类：${JSON.stringify(q('select type, count(*) from categories group by type'))}`)
        log(`  账单数：${JSON.stringify(q('select count(*) from bills').flat())}`)
        log(`  integrity_check：${JSON.stringify(q('pragma integrity_check').flat())}`)
      } catch (e) { log(`  ⚠️ sql.js 校验失败（不影响上面的头部判据）：${e.message}`) }
    } catch (e) { log(`  ✗ 拉回失败：${e.message}`) }
  }

  step('8 收尾')
  log('  ' + adbSh(['dumpsys', 'package', PKG]).out.split('\n').filter(l => l.includes('versionName')).join(' ').trim())
  adb(['emu', 'kill'])
  log('')
  log(`证据目录：${OUT}`)
  log('通过判据：崩溃日志空 · 本地请求含 sql-wasm-browser.wasm · 二次启动出现 readFile')
  log('         · 拉回的库 integrity_check=ok 且预设分类 17（expense 11 / income 6）')
  log('         · 02-scrolled.png 里顶栏完整落在状态栏下方 · versionName=1.0.0')
}

main().catch(e => { log(''); log('未捕获异常：' + (e && e.stack ? e.stack : e)); process.exit(1) })
