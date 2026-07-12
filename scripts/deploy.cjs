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
 *   node scripts/deploy.js           # patch（默认）
 *   node scripts/deploy.js minor     # minor
 *   node scripts/deploy.js major     # major
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// ─── 配置 ──────────────────────────────────────

const ROOT = path.resolve(__dirname, '..')
const PKG_PATH = path.join(ROOT, 'package.json')
const SIDEBAR_PATH = path.join(ROOT, 'src', 'components', 'Sidebar.tsx')
const RELEASE_DIR = path.join(ROOT, 'release', 'win-unpacked')
const OUTPUT_DIR = 'E:/Code/BlackHorse/VibeCoding/记账app/雷霆记账app_exe'
const DESKTOP_DIR = path.join(require('os').homedir(), 'Desktop')

// ─── 1. 读取并递增版本号 ───────────────────────

const bumpLevel = process.argv[2] || 'patch'
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

// ─── 2. 同步版本号到 Sidebar.tsx ────────────────

let sidebarContent = fs.readFileSync(SIDEBAR_PATH, 'utf-8')
const versionRegex = /(雷霆记账\s+)v\d+\.\d+\.\d+/
sidebarContent = sidebarContent.replace(versionRegex, `$1v${newVersion}`)
fs.writeFileSync(SIDEBAR_PATH, sidebarContent, 'utf-8')
console.log('✅ Sidebar.tsx 版本号已同步')

// ─── 3. 构建 ───────────────────────────────────

console.log('🔨 开始构建...')
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

// 确保输出目录存在
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
}

const destDir = path.join(OUTPUT_DIR, 'win-unpacked')
// 清空旧目录
if (fs.existsSync(destDir)) {
  fs.rmSync(destDir, { recursive: true, force: true })
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
  const psScript = `
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')
$Shortcut.TargetPath = '${exePath.replace(/'/g, "''")}'
$Shortcut.WorkingDirectory = '${destDir.replace(/'/g, "''")}'
$Shortcut.IconLocation = '${exePath.replace(/'/g, "''")}'
$Shortcut.Description = '雷霆记账 — 轻量级个人日常记账工具'
$Shortcut.Save()
`
  // Write to temp file with BOM so PowerShell reads Chinese correctly
  const tmpFile = path.join(require('os').tmpdir(), 'thunder-shortcut.ps1')
  fs.writeFileSync(tmpFile, '﻿' + psScript, 'utf-8')
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`, { stdio: 'pipe' })
}

// 创建快捷方式到输出目录和桌面
if (process.platform === 'win32') {
  const outputShortcut = path.join(OUTPUT_DIR, '雷霆记账.exe.lnk')
  const desktopShortcut = path.join(DESKTOP_DIR, '雷霆记账.lnk')

  try {
    createShortcut(outputShortcut)
    console.log('✅ 输出目录快捷方式已创建')
    createShortcut(desktopShortcut)
    console.log('✅ 桌面快捷方式已创建')
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

// ─── 完成 ──────────────────────────────────────

console.log('')
console.log('🎉 部署完成！')
console.log(`   版本：v${newVersion}`)
console.log(`   输出：${OUTPUT_DIR}`)
console.log(`   输出目录快捷方式：${path.join(OUTPUT_DIR, '雷霆记账.exe.lnk')}`)
console.log(`   桌面快捷方式：${path.join(DESKTOP_DIR, '雷霆记账.lnk')}`)

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
