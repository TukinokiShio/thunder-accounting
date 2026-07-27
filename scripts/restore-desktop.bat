@echo off
chcp 65001 >nul
setlocal
echo ============================================
echo    [94m桌面快捷方式恢复工具[0m
echo    (扫描已知路径，重建丢失的快捷方式)
echo ============================================
echo.

set "DESKTOP=%USERPROFILE%\Desktop"
set "COUNT=0"
set "FAILED=0"

rem ====== 已知路径映射 ======
call :restore "360安全云盘.lnk" "C:\Program Files\360\360 Cloud Station\360CloudStation.exe"
call :restore "Blender 4.1.lnk" "C:\Program Files\Blender Foundation\Blender 4.1\blender.exe"
call :restore "Git Bash.lnk" "C:\Program Files\Git\git-bash.exe"
call :restore "Visual Studio Code.lnk" "C:\Users\d8502\AppData\Local\Programs\Microsoft VS Code\Code.exe"
call :restore "Typora.lnk" "C:\Program Files\Typora\Typora.exe"
call :restore "剪映专业版.lnk" "C:\Program Files\CapCut\CapCut.exe"
call :restore "米哈游启动器.lnk" "C:\Program Files\miHoYo Launcher\miHoYo Launcher.exe"
call :restore "迅雷.lnk" "C:\Program Files\Thunder Network\Thunder\Program\Thunder.exe"
call :restore "阿里云盘.lnk" "C:\Program Files\Alibaba\AliPan\AliPan.exe"
call :restore "UU远程.lnk" "C:\Program Files\UU远程\UU远程.exe"
call :restore "小黑盒加速器.lnk" "C:\Program Files\小黑盒加速器\XiaoHeiHe.exe"
call :restore "CC Switch.lnk" "C:\Program Files\CCleaner\CCleaner64.exe"
call :restore "Wand (WeMod).lnk" "C:\Program Files\WeMod\WeMod.exe"
call :restore "Paradox Launcher v2.lnk" "C:\Program Files\Paradox Interactive\launcher\Paradox Launcher.exe"
call :restore "Rockstar Games Launcher.lnk" "C:\Program Files\Rockstar Games\Launcher\Launcher.exe"
call :restore "Ubisoft Connect.lnk" "C:\Program Files\Ubisoft\Ubisoft Connect\UbisoftConnect.exe"
call :restore "OpenHuman.lnk" "C:\Program Files\OpenHuman\OpenHuman.exe"
call :restore "Reasonix.lnk" "C:\Program Files\Reasonix\Reasonix.exe"
call :restore "ima.lnk" "C:\Program Files\ima\ima.exe"

rem 雷霆记账（总在最后，使用最新路径）
set "TB_EXE=E:\Code\BlackHorse\VibeCoding\记账app\release\win-unpacked\雷霆记账.exe"
if exist "%TB_EXE%" (
    call :restore "雷霆记账.lnk" "%TB_EXE%"
) else (
    echo  [警告] 雷霆记账 EXE 未找到: %TB_EXE%
)

rem 完成
echo.
echo ============================================
echo    恢复完成: 成功 %COUNT% / 失败 %FAILED%
echo ============================================
echo.
echo 以" - 快捷方式"结尾的文件需要手动恢复（安装程序不在预期路径）。
pause
goto :eof

:restore
set "NAME=%~1"
set "TARGET=%~2"
set "FULL=%DESKTOP%\\%NAME%"

if not exist "%TARGET%" (
    echo  [跳过] %NAME% ^(目标不存在: %TARGET%^)
    set /a FAILED+=1
    goto :eof
)

echo  [恢复] %NAME%
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$w=New-Object -ComObject WScript.Shell;" ^
    "$s=$w.CreateShortcut('%FULL%');" ^
    "$s.TargetPath='%TARGET%';" ^
    "$s.WorkingDirectory='%TARGET:\' + $s.TargetPath.Substring($s.TargetPath.LastIndexOf('\')+1) + '=';$s.WorkingDirectory=(Split-Path '%TARGET%');" ^
    "$s.Save()"
set /a COUNT+=1
goto :eof
