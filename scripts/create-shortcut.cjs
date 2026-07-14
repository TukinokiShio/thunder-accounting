const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const exePath = 'E:\\Code\\BlackHorse\\VibeCoding\\记账app\\雷霆记账app_exe\\win-unpacked\\雷霆记账.exe'
const icoPath = 'E:\\Code\\BlackHorse\\VibeCoding\\记账app\\雷霆记账app_exe\\icon.ico'
const explorerPath = 'C:\\Windows\\explorer.exe'
const shortcutPath = path.join(os.homedir(), 'Desktop', '雷霆记账.lnk')

// Delete old shortcut if exists
try { fs.unlinkSync(shortcutPath) } catch (e) {}
// Also delete the English-named one
try { fs.unlinkSync(path.join(os.homedir(), 'Desktop', 'Thunder Accounting.lnk')) } catch (e) {}

// Prefer standalone .ico to avoid Windows icon cache issues
const iconSource = fs.existsSync(icoPath) ? icoPath : exePath

// Use explorer.exe as launcher to bypass PCA compatibility tracking
const psScript = `
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')
$Shortcut.TargetPath = '${explorerPath}'
$Shortcut.Arguments = '${exePath.replace(/'/g, "''")}'
$Shortcut.IconLocation = '${iconSource.replace(/'/g, "''")}'
$Shortcut.Description = '雷霆记账'
$Shortcut.Save()
Write-Host 'OK'
`

// Write temp file with BOM for proper UTF-8 in PowerShell
const tmpFile = path.join(os.tmpdir(), 'thunder-desk-shortcut.ps1')
fs.writeFileSync(tmpFile, '﻿' + psScript, 'utf-8')
console.log('Creating shortcut...')
execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`, { stdio: 'inherit' })
console.log('Done! Shortcut: ' + shortcutPath)
