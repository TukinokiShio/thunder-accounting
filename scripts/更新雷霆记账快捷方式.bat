@echo off
setlocal
echo.
echo =============================================
echo   雷 霆 记 账 快 捷 方 式 更 新
echo =============================================
echo   此脚本 只 更 新 桌 面 雷 霆 记 账 快 捷 方 式
echo   不 会 删 除 任 何 其 他 文 件
echo =============================================
echo.

set "DIR=E:\Code\BlackHorse\VibeCoding\记账app\release\win-unpacked"
set "EXE_NAME=雷霆记账.exe"
set "TARGET=%DIR%\%EXE_NAME%"
set "DESKTOP=%USERPROFILE%\Desktop"
set "LNK=%DESKTOP%\雷霆记账.lnk"

if not exist "%TARGET%" (
    echo [错误] 未找到最新 EXE
    echo   路径: %TARGET%
    echo   请先执行: npx electron-vite build ^&^& npx electron-builder --win
    pause
    exit /b 1
)

echo [信息] 目标 EXE: %TARGET%
echo [信息] 快捷方式: %LNK%
echo [信息] 最后修改: 
dir "%TARGET%" | findstr /C:"%EXE_NAME%"
echo.

set /p "CONFIRM=确认更新？(Y/N): "
if /i not "%CONFIRM%"=="Y" (
    echo 已取消。
    pause
    exit /b 0
)

echo.
echo 正在更新...

rem Write temp PS1
set "TMPPS=%TEMP%\thunder_update_%RANDOM%.ps1"
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
echo Write-Output 'Shortcut updated.'
) > "%TMPPS%"

powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $output = . '%TMPPS%'; Remove-Item '%TMPPS%'; Write-Host 'PS output:' $output; if (Test-Path '%LNK%') { Write-Host 'Verification: shortcut file exists.' } else { Write-Host '[ERROR] Shortcut NOT created!' } }"

echo.
echo 完成！请双击桌面雷霆记账图标验证。
pause
