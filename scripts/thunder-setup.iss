; 雷霆记账 Inno Setup 安装脚本
; 编译: ISCC.exe thunder-setup.iss
; 静默安装: Setup.exe /VERYSILENT /NOCANCEL

#define AppName "雷霆记账"
#define AppVersion "1.10.2"
#define AppPublisher "TukinokiShio"
#define AppURL "https://github.com/TukinokiShio/thunder-accounting"
#define AppExeName "雷霆记账.exe"
; 项目根目录（默认安装到此位置，方便开发期热更新）
#define ProjectRoot "E:\Code\BlackHorse\VibeCoding\记账app"

[Setup]
AppId={{ThunderBooks-78A1-4F3C-B2D9-E5F6C7A8B9D0}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
; 默认安装到项目目录下的"雷霆记账"子目录（便于覆盖旧版本）
DefaultDirName={#ProjectRoot}\{#AppName}
DisableProgramGroupPage=yes
OutputDir=..\release
OutputBaseFilename=雷霆记账_Inno_v{#AppVersion}
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
Source: "..\release\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; 桌面快捷方式: 显式指定图标文件，不依赖 EXE 嵌入图标
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\icon.ico"; IconIndex: 0
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\icon.ico"; IconIndex: 0