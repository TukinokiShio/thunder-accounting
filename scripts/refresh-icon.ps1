$signature = @'
[DllImport("shell32.dll")]
public static extern int SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);
'@

$type = Add-Type -MemberDefinition $signature -Name "WinShell" -Namespace "IconRefresh" -PassThru
$type::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)

# Also clear IE icon cache
ie4uinit.exe -ClearIconCache

# Refresh the specific shortcut
$shortcutPath = "$env:USERPROFILE\Desktop\雷霆记账.lnk"
if (Test-Path $shortcutPath) {
    $wsh = New-Object -ComObject WScript.Shell
    $sc = $wsh.CreateShortcut($shortcutPath)
    $sc.TargetPath = "E:\Code\BlackHorse\VibeCoding\记账app\雷霆记账app_exe\win-unpacked\雷霆记账.exe"
    $sc.WorkingDirectory = "E:\Code\BlackHorse\VibeCoding\记账app\雷霆记账app_exe\win-unpacked"
    $sc.IconLocation = "E:\Code\BlackHorse\VibeCoding\记账app\雷霆记账app_exe\win-unpacked\雷霆记账.exe,0"
    $sc.Save()
    Write-Host "Desktop shortcut refreshed with explicit icon index"
}

Write-Host "Done. Please press F5 on desktop to see changes."
