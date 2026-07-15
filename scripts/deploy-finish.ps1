$src = 'E:\Code\BlackHorse\VibeCoding\记账app\release\win-unpacked'
$dest = 'E:\Code\BlackHorse\VibeCoding\记账app\雷霆记账app_exe\win-unpacked'

# Remove old
if (Test-Path $dest) {
    Remove-Item $dest -Recurse -Force
}

# Copy
Copy-Item $src $dest -Recurse
Write-Host "Copied build output"

# Create desktop shortcut
$exe = "$dest\雷霆记账.exe"
$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut("$env:USERPROFILE\Desktop\雷霆记账.lnk")
$sc.TargetPath = $exe
$sc.WorkingDirectory = $dest
$sc.IconLocation = "$exe,0"
$sc.Save()
Write-Host "Desktop shortcut created"
