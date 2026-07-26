// Create desktop shortcut for 雷霆记账
// Target: release/win-unpacked/雷霆记账.exe
const fs = require('fs')
const path = require('path')

const desktopPath = path.join(require('os').homedir(), 'Desktop')
const targetExe = 'E:\\Code\\BlackHorse\\VibeCoding\\记账app\\release\\win-unpacked\\雷霆记账.exe'

// Write a PowerShell script that creates the shortcut
const psScript = `
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("${desktopPath}\\雷霆记账.lnk")
$Shortcut.TargetPath = "${targetExe}"
$Shortcut.WorkingDirectory = "${path.dirname(targetExe)}"
$Shortcut.Description = "雷霆记账 - 个人记账工具"
$Shortcut.IconLocation = "${targetExe},0"
$Shortcut.Save()
Write-Output "Shortcut updated: ${desktopPath}\\雷霆记账.lnk -> ${targetExe}"
`

const psPath = path.join(__dirname, 'update-shortcut.ps1')
fs.writeFileSync(psPath, psScript, 'utf-8')
console.log('PowerShell script written to:', psPath)
console.log('Please run this script outside the sandbox:')
console.log(`  powershell -ExecutionPolicy Bypass -File "${psPath}"`)
