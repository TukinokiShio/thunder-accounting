; 雷霆记账 Inno Setup 安装脚本
; 编译: ISCC.exe thunder-setup.iss
; 静默安装: Setup.exe /VERYSILENT /NOCANCEL

#define AppName "雷霆记账"
#define AppVersion "1.17.3"
#define AppPublisher "TukinokiShio"
#define AppURL "https://github.com/TukinokiShio/thunder-accounting"
#define AppExeName "雷霆记账.exe"
; 可通过 ISCC.exe /DBuildOutputDir="..." 覆盖，便于隔离验证安装包来源
#ifndef BuildOutputDir
#define BuildOutputDir "..\release"
#endif
#ifndef InstallerOutputDir
#define InstallerOutputDir "..\release"
#endif
#ifndef InstallerFileName
#define InstallerFileName "雷霆记账_Inno_v" + AppVersion
#endif

[Setup]
AppId={{ThunderBooks-78A1-4F3C-B2D9-E5F6C7A8B9D0}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
; 默认安装到项目固定验收目录；BuildOutputDir/InstallerOutputDir 仍可通过 ISCC.exe /D 覆盖
DefaultDirName=E:\Code\CodeProduct\thunder-accounting\exe
; Inno Setup uses DisableDirPage=no to show the custom installation directory page.
DisableDirPage=no
; 关键：Inno 默认 UsePreviousAppDir=yes，静默升级会沿用注册表历史安装目录而绕过 DefaultDirName，
; 导致新版本被装到旧目录（如 雷霆记账app\_exe）。这里显式关闭，保证始终落到固定验收目录 exe。
UsePreviousAppDir=no
DisableProgramGroupPage=yes
OutputDir={#InstallerOutputDir}
OutputBaseFilename={#InstallerFileName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\resources\icon.ico
UninstallDisplayIcon={app}\{#AppExeName}
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "chinese"; MessagesFile: "compiler:Default.isl"

[Files]
; Copy icon.ico FIRST so shortcuts can reference it
Source: "..\resources\icon.ico"; DestDir: "{app}"; Flags: ignoreversion
; Then copy the entire app
Source: "{#BuildOutputDir}\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; 桌面快捷方式: 显式指定图标文件，不依赖 EXE 嵌入图标
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\icon.ico"; IconIndex: 0
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\icon.ico"; IconIndex: 0
