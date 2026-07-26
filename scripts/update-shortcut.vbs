Set WshShell = CreateObject("WScript.Shell")
desktopPath = WshShell.SpecialFolders("Desktop")
Set shortcut = WshShell.CreateShortcut(desktopPath & "\雷霆记账.lnk")
shortcut.TargetPath = "E:\Code\BlackHorse\VibeCoding\记账app\release\win-unpacked\雷霆记账.exe"
shortcut.WorkingDirectory = "E:\Code\BlackHorse\VibeCoding\记账app\release\win-unpacked"
shortcut.Description = "雷霆记账 - 个人记账工具"
shortcut.IconLocation = "E:\Code\BlackHorse\VibeCoding\记账app\release\win-unpacked\雷霆记账.exe,0"
shortcut.Save()
WScript.Echo "桌面快捷方式已更新"
