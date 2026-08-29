#!/usr/bin/env node

/**
 * 雷霆记账 — 一键部署脚本
 *
 * 功能：
 * 1. 按指定级别递增 package.json 版本号 (major / minor / patch，默认 patch)
 * 2. 同步版本号到 src/components/Sidebar.tsx
 * 3. 执行 electron-builder 构建打包
 * 4. 将 win-unpacked 复制到输出目录
 * 5. 在输出目录创建快捷方式
 *
 * 用法：
 *   node scripts/deploy.cjs patch --force --allow-dirty
 *   node scripts/deploy.cjs patch --output <隔离输出目录>
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// ─── 配置 ──────────────────────────────────────

const ROOT = path.resolve(__dirname, '..')
const PKG_PATH = path.join(ROOT, 'package.json')
const PACKAGE_LOCK_PATH = path.join(ROOT, 'package-lock.json')
const SETUP_PATH = path.join(ROOT, 'scripts', 'thunder-setup.iss')
const SIDEBAR_PATH = path.join(ROOT, 'src', 'components', 'Sidebar.tsx')
const RELEASE_DIR = path.join(ROOT, 'release', 'win-unpacked')
const DESKTOP_DIR = path.join(require('os').homedir(), 'Desktop')

const args = process.argv.slice(2)
const bumpLevel = args.find((arg) => !arg.startsWith('--')) || 'patch'
const allowDirty = args.includes('--allow-dirty')
const force = args.includes('--force')
const outputArgIndex = args.indexOf('--output')
const OUTPUT_DIR = outputArgIndex >= 0 && args[outputArgIndex + 1]
  ? path.resolve(ROOT, args[outputArgIndex + 1])
  : path.join(ROOT, 'exe')

function assertSafeWorkspace() {
  if (allowDirty) return
  const dirty = execSync('git status --porcelain --untracked-files=all', { cwd: ROOT, encoding: 'utf8' }).trim()
  if (dirty) {
    console.error('❌ 工作树存在未提交改动。为避免覆盖用户文件，请先提交/隔离改动，或显式传入 --allow-dirty。')
    process.exit(1)
  }
}

assertSafeWorkspace()

// ─── 1. 读取并递增版本号 ───────────────────────

const validLevels = ['major', 'minor', 'patch']
if (!validLevels.includes(bumpLevel)) {
  console.error(`❌ 无效的版本级别 "${bumpLevel}"，请使用：major | minor | patch`)
  process.exit(1)
}

const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'))
const [major, minor, patch] = pkg.version.split('.').map(Number)

let newVersion
switch (bumpLevel) {
  case 'major':
    newVersion = `${major + 1}.0.0`
    break
  case 'minor':
    newVersion = `${major}.${minor + 1}.0`
    break
  case 'patch':
  default:
    newVersion = `${major}.${minor}.${patch + 1}`
    break
}

console.log(`📦 版本号：${pkg.version} → ${newVersion} (${bumpLevel})`)

// 更新 package.json
pkg.version = newVersion
fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
console.log('✅ package.json 已更新')

// 同步 package-lock.json 和安装脚本版本号
const packageLock = JSON.parse(fs.readFileSync(PACKAGE_LOCK_PATH, 'utf-8'))
packageLock.version = newVersion
packageLock.packages[''].version = newVersion
fs.writeFileSync(PACKAGE_LOCK_PATH, JSON.stringify(packageLock, null, 2) + '\n', 'utf-8')
console.log('✅ package-lock.json 已更新')

let setupContent = fs.readFileSync(SETUP_PATH, 'utf-8')
setupContent = setupContent.replace(/^(#define\s+AppVersion\s+").*(")$/m, `$1${newVersion}$2`)
fs.writeFileSync(SETUP_PATH, setupContent, 'utf-8')
console.log('✅ thunder-setup.iss 版本号已同步')

// ─── 2. 同步版本号到 Sidebar.tsx ────────────────

let sidebarContent = fs.readFileSync(SIDEBAR_PATH, 'utf-8')
const versionRegex = /(雷霆记账\s+)v\d+\.\d+\.\d+/
sidebarContent = sidebarContent.replace(versionRegex, `$1v${newVersion}`)
fs.writeFileSync(SIDEBAR_PATH, sidebarContent, 'utf-8')
console.log('✅ Sidebar.tsx 版本号已同步')

// ─── 3. 构建 ───────────────────────────────────

console.log('🔨 开始构建...')
if (fs.existsSync(RELEASE_DIR) && fs.readdirSync(RELEASE_DIR).length > 0 && !force) {
  console.error(`❌ 构建输出已存在：${RELEASE_DIR}。为避免覆盖，请显式传入 --force。`)
  process.exit(1)
}
try {
  execSync('npm run dist:win', { cwd: ROOT, stdio: 'inherit' })
  console.log('✅ 构建完成')
} catch (err) {
  console.error('❌ 构建失败：', err.message)
  process.exit(1)
}

// ─── 4. 复制到输出目录 ─────────────────────────

if (!fs.existsSync(RELEASE_DIR)) {
  console.error(`❌ 未找到构建产物：${RELEASE_DIR}`)
  console.log('💡 请确认 electron-builder 配置的 win 目标包含 nsis 并已成功构建。')
  process.exit(1)
}

const destDir = OUTPUT_DIR
// 默认拒绝覆盖既有产物；只有显式 --force 才允许清理目标目录。
if (fs.existsSync(destDir) && !force) {
  console.error(`❌ 输出目录已存在：${destDir}。为避免覆盖，请换用 --output 或显式传入 --force。`)
  process.exit(1)
}
// --force 只允许覆盖同名应用文件；不要递归删除整个 exe，避免误删
// 安装目录中的用户文件、其他应用文件或历史安装证据。
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true })
}

// 复制（使用 robocopy 或 cp -r）
console.log('📋 正在复制到输出目录...')
if (process.platform === 'win32') {
  // Windows: 使用 robocopy
  try {
    execSync(`robocopy "${RELEASE_DIR}" "${destDir}" /E /NFL /NDL /NJH /NJS /nc /ns /np`, { stdio: 'pipe' })
    // robocopy exit code 0-7 are all "success" states
  } catch (err) {
    if (err.status > 7) {
      console.error('❌ 复制失败')
      // fallback to Node.js copy
      copyRecursive(RELEASE_DIR, destDir)
    }
  }
} else {
  copyRecursive(RELEASE_DIR, destDir)
}
console.log('✅ 已复制到输出目录')

// ─── 5. 创建快捷方式 ────────────────────────────

const exePath = path.join(destDir, '雷霆记账.exe')
if (!fs.existsSync(exePath)) {
  console.warn('⚠️ 未找到 雷霆记账.exe，尝试查找其他 exe...')
  // 尝试找到第一个 exe
  const files = fs.readdirSync(destDir)
  const foundExe = files.find(f => f.endsWith('.exe'))
  if (foundExe) {
    console.log(`  找到：${foundExe}`)
  }
}

function createShortcut(shortcutPath) {
  // Prefer standalone .ico to avoid Windows icon cache issues
  const iconSource = require('fs').existsSync(path.join(OUTPUT_DIR, 'icon.ico'))
    ? path.join(OUTPUT_DIR, 'icon.ico')
    : exePath

  // Use explorer.exe as launcher to bypass PCA compatibility tracking.
  // PCA (Program Compatibility Assistant) monitors shortcut targets and may
  // force admin-only execution. By pointing the shortcut to explorer.exe
  // (a trusted Windows binary) and passing the EXE as argument, PCA is bypassed.
  const explorerPath = 'C:\\Windows\\explorer.exe'

  const psScript = `
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')
$Shortcut.TargetPath = '${explorerPath}'
$Shortcut.Arguments = '${exePath.replace(/'/g, "''")}'
$Shortcut.IconLocation = '${iconSource.replace(/'/g, "''")}'
$Shortcut.Description = '雷霆记账 — 轻量级个人日常记账工具'
$Shortcut.Save()
`
  // Write to temp file with BOM so PowerShell reads Chinese correctly
  const tmpFile = path.join(require('os').tmpdir(), 'thunder-shortcut.ps1')
  fs.writeFileSync(tmpFile, '﻿' + psScript, 'utf-8')
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`, { stdio: 'pipe' })
}

// 创建快捷方式：输出目录 + 桌面 + 开始菜单
if (process.platform === 'win32') {
  const outputShortcut = path.join(OUTPUT_DIR, '雷霆记账.exe.lnk')
  const desktopShortcut = path.join(DESKTOP_DIR, '雷霆记账.lnk')
  const startMenuDir = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  const startMenuShortcut = path.join(startMenuDir, '雷霆记账.lnk')

  try {
    createShortcut(outputShortcut)
    console.log('✅ 输出目录快捷方式已创建')
    createShortcut(desktopShortcut)
    console.log('✅ 桌面快捷方式已覆盖')
    createShortcut(startMenuShortcut)
    console.log('✅ 开始菜单快捷方式已覆盖')
  } catch (err) {
    console.warn('⚠️ 快捷方式创建失败，请手动创建：', err.message)
    // 创建 bat 文件作为备选
    const batPath = path.join(OUTPUT_DIR, '启动雷霆记账.bat')
    fs.writeFileSync(batPath, `@echo off\nstart "" "${exePath}"\n`, 'utf-8')
    console.log('  已创建备用的 .bat 启动文件')
  }
} else {
  console.log('⏭️ 非 Windows 环境，跳过快捷方式创建')
}

// ─── 6. 清除 Windows 兼容性标记 ──────────────
// Windows 兼容性助手可能会自动给 EXE 打上"管理员运行"等标记，
// 导致双击快捷方式无反应。每次部署后自动清除。

if (process.platform === 'win32') {
  console.log('🧹 清除兼容性标记...')
  const clearCompatPs = `
$exePath = '${exePath.replace(/'/g, "''")}'
$baseKey = 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags'
$keys = @(
  "\\$baseKey\\Layers",
  "\\$baseKey\\Compatibility Assistant\\Store",
  "\\$baseKey\\Compatibility Assistant\\Persisted",
  "\\$baseKey\\Compatibility Assistant\\Fix"
)
foreach ($key in $keys) {
  if (Test-Path $key) {
    $props = Get-ItemProperty $key -ErrorAction SilentlyContinue
    if ($props) {
      foreach ($prop in $props.PSObject.Properties) {
        if ($prop.Name -like '*雷霆记账*' -or $prop.Name -like '*thunder-accounting*') {
          Remove-ItemProperty -Path $key -Name $prop.Name -Force -ErrorAction SilentlyContinue
          Write-Host "  Removed: $($prop.Name)"
        }
      }
    }
  }
}
`
  const tmpCompatFile = path.join(require('os').tmpdir(), 'thunder-clear-compat.ps1')
  fs.writeFileSync(tmpCompatFile, '﻿' + clearCompatPs, 'utf-8')
  try {
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpCompatFile}"`, { stdio: 'pipe' })
    console.log('✅ 兼容性标记已清除')
  } catch (err) {
    console.warn('⚠️ 清除兼容性标记失败（不影响使用）：', err.message)
  }
}

// ─── 完成 ──────────────────────────────────────

console.log('')
const startMenuDir = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs')
console.log('🎉 部署完成！')
console.log(`   版本：v${newVersion}`)
console.log(`   输出：${OUTPUT_DIR}`)
console.log(`   桌面快捷方式：${path.join(DESKTOP_DIR, '雷霆记账.lnk')}`)
console.log(`   开始菜单快捷方式：${path.join(startMenuDir, '雷霆记账.lnk')}`)

// ─── 辅助函数 ──────────────────────────────────

function copyRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true })
  }
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}
