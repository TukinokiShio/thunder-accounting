# 更新桌面快捷方式 — v1.7.20
# 策略：先删旧 Public 快捷方式（如存在），再在用户桌面创建新的
param(
    [Parameter(Mandatory = $true)]
    [string]$AppDir
)

# 安装目录必须由调用方显式传入，避免指向旧开发机路径。
$targetExe = Join-Path $appDir "雷霆记账.exe"
$iconFile = Join-Path $appDir "icon.ico"
$userDesktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $userDesktop "雷霆记账.lnk"

if (-not (Test-Path $targetExe)) {
    Write-Host "X 未找到 雷霆记账.exe: $targetExe" -ForegroundColor Red
    exit 1
}

# 1. 删除旧的 CommonDesktop 快捷方式（可能因权限失败，忽略）
$oldShortcut = [System.IO.Path]::Combine([Environment]::GetFolderPath("CommonDesktop"), "雷霆记账.lnk")
if (Test-Path $oldShortcut) {
    try { Remove-Item $oldShortcut -Force -ErrorAction Stop; Write-Host "- 已删除旧快捷方式: $oldShortcut" }
    catch { Write-Host "- 无法删除 $oldShortcut (需要管理员权限，可忽略)" -ForegroundColor Yellow }
}

# 2. 创建用户桌面快捷方式
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($shortcutPath)
$Shortcut.TargetPath = $targetExe
$Shortcut.WorkingDirectory = $appDir
$Shortcut.IconLocation = "$iconFile,0"
$Shortcut.Description = "雷霆记账"
$Shortcut.Save()

Write-Host "@ 快捷方式已更新到用户桌面:" -ForegroundColor Green
Write-Host "  $shortcutPath"
Write-Host "  -> $targetExe"
Write-Host "  icon: $iconFile,0"
