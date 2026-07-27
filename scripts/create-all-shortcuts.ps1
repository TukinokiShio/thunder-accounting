$WshShell = New-Object -ComObject WScript.Shell

# 输出目录快捷方式
$sc1 = $WshShell.CreateShortcut("E:\Code\BlackHorse\VibeCoding\记账app\雷霆记账app_exe\雷霆记账.exe.lnk")
$sc1.TargetPath = "C:\Windows\explorer.exe"
$sc1.Arguments = "E:\Code\BlackHorse\VibeCoding\记账app\雷霆记账app_exe\win-unpacked\雷霆记账.exe"
$sc1.IconLocation = "E:\Code\BlackHorse\VibeCoding\记账app\resources\icon.ico"
$sc1.Description = "雷霆记账 — 轻量级个人日常记账工具"
$sc1.Save()
Write-Host "✅ 输出目录快捷方式已创建"

# 桌面快捷方式
$desktop = [Environment]::GetFolderPath("Desktop")
$sc2 = $WshShell.CreateShortcut("$desktop\雷霆记账.lnk")
$sc2.TargetPath = "C:\Windows\explorer.exe"
$sc2.Arguments = "E:\Code\BlackHorse\VibeCoding\记账app\雷霆记账app_exe\win-unpacked\雷霆记账.exe"
$sc2.IconLocation = "E:\Code\BlackHorse\VibeCoding\记账app\resources\icon.ico"
$sc2.Description = "雷霆记账 — 轻量级个人日常记账工具"
$sc2.Save()
Write-Host "✅ 桌面快捷方式已创建"

# 开始菜单快捷方式
$startMenu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
$sc3 = $WshShell.CreateShortcut("$startMenu\雷霆记账.lnk")
$sc3.TargetPath = "C:\Windows\explorer.exe"
$sc3.Arguments = "E:\Code\BlackHorse\VibeCoding\记账app\雷霆记账app_exe\win-unpacked\雷霆记账.exe"
$sc3.IconLocation = "E:\Code\BlackHorse\VibeCoding\记账app\resources\icon.ico"
$sc3.Description = "雷霆记账 — 轻量级个人日常记账工具"
$sc3.Save()
Write-Host "✅ 开始菜单快捷方式已创建"

Write-Host "`n🎉 所有快捷方式已更新"
