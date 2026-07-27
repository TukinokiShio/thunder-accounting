@echo off
setlocal
echo ============================================
echo    雷霆记账快捷方式更新工具
echo ============================================
echo   只更新 1 个 lnk: 雷霆记账.lnk
echo ============================================
echo.

set "DIR=E:\Code\BlackHorse\VibeCoding\记账app\release\win-unpacked"
set "EXE=雷霆记账.exe"
set "TARGET=%DIR%\%EXE%"
set "DESKTOP=%USERPROFILE%\Desktop"
set "LNK=%DESKTOP%\雷霆记账.lnk"

if not exist "%TARGET%" (
    echo [错误] 找不到 EXE: %TARGET%
    pause
    exit /b 1
)

echo 目标: %TARGET%
echo 快捷方式: %LNK%
echo.
echo 按任意键更新...
pause >nul
echo 正在更新...

set "TMPPS=%TEMP%\tb_update_%RANDOM%.ps1"
(
echo $d = [Environment]::GetFolderPath^('Desktop'^)
echo $lnk = Join-Path $d '雷霆记账.lnk'
echo $t = '%TARGET%'
echo $w = '%DIR%'
echo $wsh = New-Object -ComObject WScript.Shell
echo $sc = $wsh.CreateShortcut^($lnk^)
echo $sc.TargetPath = $t
echo $sc.WorkingDirectory = $w
echo $sc.Description = '雷霆记账 - 个人记账工具'
echo $sc.IconLocation = $t + ',0'
echo $sc.Save^(^)
echo Write-Output 'Shortcut created.'
) > "%TMPPS%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%TMPPS%"
set "RC=%errorlevel%"

if exist "%TMPPS%" del "%TMPPS%" 2>nul

if %RC% neq 0 (
    echo 失败! (code %RC%)
) else (
    echo 成功! 快捷方式已创建在桌面。
)
pause
