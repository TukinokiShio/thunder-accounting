# 雷霆记账 — 图标缓存清理 & 快捷方式重建
#
# 用法：右键 → Run with PowerShell，或在终端中：
#   powershell -ExecutionPolicy Bypass -File "scripts\refresh-icons.ps1"

$exePath = 'E:\Code\BlackHorse\VibeCoding\记账app\雷霆记账app_exe\win-unpacked\雷霆记账.exe'
$outputDir = 'E:\Code\BlackHorse\VibeCoding\记账app\雷霆记账app_exe'
$desktopDir = [Environment]::GetFolderPath('Desktop')
$startMenuDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
$pngPath = 'E:\Code\BlackHorse\VibeCoding\记账app\resources\icon.png'
$icoPath = 'E:\Code\BlackHorse\VibeCoding\记账app\雷霆记账app_exe\icon.ico'

Write-Host "╔═══════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  雷霆记账 — Icon Refresh          ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════╝" -ForegroundColor Cyan

# ═══════════════════════════════════════════
# Step 1: Convert PNG → ICO (using .NET)
# ═══════════════════════════════════════════
Write-Host "`n[1/5] Converting PNG to ICO..." -ForegroundColor Yellow

Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue

if ([System.AppDomain]::CurrentDomain.GetAssemblies() | Where-Object { $_.GetName().Name -eq 'System.Drawing' }) {
    try {
        $bitmap = New-Object System.Drawing.Bitmap($pngPath)
        # Create a multi-resolution ICO (256, 128, 64, 48, 32, 16)
        $sizes = @(256, 128, 64, 48, 32, 16)
        $memStream = New-Object System.IO.MemoryStream
        $writer = New-Object System.IO.BinaryWriter($memStream)

        # ICO header: reserved=0, type=1 (ICO), count
        $writer.Write([uint16]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]$sizes.Count)

        # Calculate offset for image data
        $imageDataOffset = 6 + ($sizes.Count * 16)
        $imageDataList = @()

        foreach ($size in $sizes) {
            $bmp = New-Object System.Drawing.Bitmap($bitmap, $size, $size)
            $imgStream = New-Object System.IO.MemoryStream
            $bmp.Save($imgStream, [System.Drawing.Imaging.ImageFormat]::Png)
            $imgBytes = $imgStream.ToArray()
            $imageDataList += $imgBytes
            $imgStream.Close()
            $bmp.Dispose()

            # ICO directory entry
            $w = if ($size -ge 256) { 0 } else { $size }
            $h = if ($size -ge 256) { 0 } else { $size }
            $writer.Write([byte]$w)
            $writer.Write([byte]$h)
            $writer.Write([byte]0)       # palette
            $writer.Write([byte]0)       # reserved
            $writer.Write([uint16]0)     # color planes (0 for PNG)
            $writer.Write([uint16]32)    # bpp
            $writer.Write([uint32]$imgBytes.Length)
            $writer.Write([uint32]$imageDataOffset)
            $imageDataOffset += $imgBytes.Length
        }

        # Write image data
        foreach ($data in $imageDataList) {
            $writer.Write($data)
        }

        $writer.Flush()
        [System.IO.File]::WriteAllBytes($icoPath, $memStream.ToArray())
        $writer.Close()
        $memStream.Close()
        $bitmap.Dispose()

        Write-Host "  ✓ ICO created: $icoPath" -ForegroundColor Green
    } catch {
        Write-Host "  ✗ PNG→ICO failed: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "  → Will use EXE embedded icon instead" -ForegroundColor DarkYellow
    }
} else {
    Write-Host "  ✗ System.Drawing not available" -ForegroundColor Red
    Write-Host "  → Will use EXE embedded icon instead" -ForegroundColor DarkYellow
}

# ═══════════════════════════════════════════
# Step 2: Stop Explorer (unlock cache files)
# ═══════════════════════════════════════════
Write-Host "`n[2/5] Stopping Explorer to unlock cache..." -ForegroundColor Yellow
$explorerKilled = $false
if (Get-Process -Name explorer -ErrorAction SilentlyContinue) {
    Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    $explorerKilled = $true
    Write-Host "  ✓ Explorer stopped" -ForegroundColor Green
} else {
    Write-Host "  Explorer not running, skipping" -ForegroundColor Gray
}

# ═══════════════════════════════════════════
# Step 3: Clear icon cache
# ═══════════════════════════════════════════
Write-Host "`n[3/5] Clearing icon cache..." -ForegroundColor Yellow

$cachePaths = @(
    "$env:LOCALAPPDATA\Microsoft\Windows\Explorer\iconcache*",
    "$env:LOCALAPPDATA\Microsoft\Windows\Explorer\thumbcache*",
    "$env:LOCALAPPDATA\IconCache.db",
    "$env:LOCALAPPDATA\IconCache.db-journal"
)

$deleted = 0
foreach ($pattern in $cachePaths) {
    Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            Remove-Item $_.FullName -Force -Recurse -ErrorAction SilentlyContinue
            Write-Host "  Deleted: $($_.Name)" -ForegroundColor Gray
            $deleted++
        } catch {
            Write-Host "  Skip (locked): $($_.Name)" -ForegroundColor DarkGray
        }
    }
}

if ($deleted -gt 0) {
    Write-Host "  ✓ $deleted cache file(s) deleted" -ForegroundColor Green
} else {
    Write-Host "  (no cache files found — might be using Win11 thumbnail handler)" -ForegroundColor Gray
}

# ═══════════════════════════════════════════
# Step 4: Rebuild shortcuts with correct icon
# ═══════════════════════════════════════════
Write-Host "`n[4/5] Rebuilding shortcuts..." -ForegroundColor Yellow

# Determine icon source: prefer standalone .ico if created
$iconSource = if (Test-Path $icoPath) { $icoPath } else { "$exePath,0" }
Write-Host "  Icon source: $iconSource" -ForegroundColor Gray

function New-ThunderShortcut($lnkPath, $label) {
    try {
        # Remove old shortcut
        Remove-Item $lnkPath -Force -ErrorAction SilentlyContinue

        $ws = New-Object -ComObject WScript.Shell
        $sc = $ws.CreateShortcut($lnkPath)
        $sc.TargetPath = $exePath
        $sc.WorkingDirectory = Split-Path $exePath -Parent
        $sc.IconLocation = $iconSource
        $sc.Description = '雷霆记账 — 轻量级个人日常记账工具'
        $sc.Save()
        Write-Host "  ✓ $label" -ForegroundColor Green
    } catch {
        Write-Host "  ✗ $label failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Output dir
New-ThunderShortcut "$outputDir\雷霆记账.exe.lnk" "Output dir shortcut"

# Desktop
New-ThunderShortcut "$desktopDir\雷霆记账.lnk" "Desktop shortcut"

# Start Menu
New-ThunderShortcut "$startMenuDir\雷霆记账.lnk" "Start Menu shortcut"

# ═══════════════════════════════════════════
# Step 5: Rebuild icon cache & restart Explorer
# ═══════════════════════════════════════════
Write-Host "`n[5/5] Rebuilding icon cache..." -ForegroundColor Yellow
ie4uinit.exe -ClearIconCache
ie4uinit.exe -show

if ($explorerKilled) {
    Write-Host "  Restarting Explorer..." -ForegroundColor Gray
    Start-Process explorer.exe
    Start-Sleep -Seconds 3
}

Write-Host "`n╔═══════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  ✓ Icon refresh complete!         ║" -ForegroundColor Green
Write-Host "╚═══════════════════════════════════╝" -ForegroundColor Green
Write-Host "`nIf the icon still shows old, right-click desktop → Refresh, or reboot." -ForegroundColor Gray
