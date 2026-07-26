$ErrorActionPreference = 'Stop'

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop '雷霆记账.lnk'
$target = 'E:\Code\BlackHorse\VibeCoding\记账app\release\win-unpacked\雷霆记账.exe'
$workingDir = 'E:\Code\BlackHorse\VibeCoding\记账app\release\win-unpacked'

# 确保目标 EXE 存在
if (-not (Test-Path $target)) {
    Write-Host "错误: 找不到 $target"
    Read-Host '按回车键关闭'
    exit 1
}

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $workingDir
$shortcut.Description = '雷霆记账 - 个人记账工具'
$shortcut.IconLocation = "$target,0"
$shortcut.Save()

Write-Host '桌面快捷方式已更新:'
Write-Host "  $shortcutPath"
Write-Host "  -> $target"
Read-Host '按回车键关闭'