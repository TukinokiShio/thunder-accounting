$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$env:USERPROFILE\Desktop\Thunder Accounting.lnk")
$Shortcut.TargetPath = 'E:\Code\BlackHorse\VibeCoding\记账app\雷霆记账app_exe\win-unpacked\雷霆记账.exe'
$Shortcut.WorkingDirectory = 'E:\Code\BlackHorse\VibeCoding\记账app\雷霆记账app_exe\win-unpacked'
$Shortcut.IconLocation = 'E:\Code\BlackHorse\VibeCoding\记账app\雷霆记账app_exe\win-unpacked\雷霆记账.exe,0'
$Shortcut.Description = 'Thunder Accounting'
$Shortcut.Save()
Write-Host "Desktop shortcut created"
