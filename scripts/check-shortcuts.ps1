# List all desktop shortcuts
$desktop = [Environment]::GetFolderPath('Desktop')
Write-Host "=== Desktop Shortcuts ===" -ForegroundColor Cyan
Get-ChildItem $desktop -Filter '*.lnk' | ForEach-Object {
    $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($_.FullName)
    if ($sc.TargetPath) {
        Write-Host ""
        Write-Host "Name: $($_.Name)"
        Write-Host "  Target: $($sc.TargetPath)"
        Write-Host "  WorkDir: $($sc.WorkingDirectory)"
        Write-Host "  Icon: $($sc.IconLocation)"
    }
}
