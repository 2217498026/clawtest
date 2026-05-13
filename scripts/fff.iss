; Inno Setup 最终脚本 - 集成 Node.js + OpenClaw（使用 PowerShell 安装脚本）
#define MyAppName "My Program"
#define MyAppVersion "1.5"
#define MyAppPublisher "My Company, Inc."
#define MyAppExeName "OpenClaw_0.0.1_x64-setup.exe"
#define MyAppAssocName MyAppName + " File"
#define MyAppAssocExt ".myp"
#define MyAppAssocKey StringChange(MyAppAssocName, " ", "") + MyAppAssocExt

[Setup]
AppId={{CBFCBA02-B778-4EF3-B326-B6FC9736E3F1}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\opclaw
UninstallDisplayIcon={app}\{#MyAppExeName}
ChangesAssociations=yes
DisableProgramGroupPage=yes

; 管理员权限（安装 Node.js 必需）
PrivilegesRequired=admin

; 强制 64 位模式，解决 Program Files (x86) 路径错误
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64compatible

OutputBaseFilename=mysetup
SolidCompression=yes
WizardStyle=modern dynamic

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked




[Files]
; 主程序安装包
Source: "..\src-tauri\target\release\bundle\nsis\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion

; Node.js 安装包（放临时目录，安装后自动删除）
Source: "node-v24.15.0-x64.msi"; DestDir: "{tmp}"; Flags: ignoreversion deleteafterinstall

; Git 安装包（放临时目录，安装后自动删除）
Source: "Git-2.54.0-64-bit.exe"; DestDir: "{tmp}"; Flags: ignoreversion deleteafterinstall

; PowerShell 安装脚本（放临时目录，安装后自动删除）
Source: "install-openclaw.ps1"; DestDir: "{tmp}"; Flags: ignoreversion deleteafterinstall

[Registry]


Root: HKA; Subkey: "Software\Classes\{#MyAppAssocExt}\OpenWithProgids"; ValueType: string; ValueName: "{#MyAppAssocKey}"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\{#MyAppAssocKey}"; ValueType: string; ValueName: ""; ValueData: "{#MyAppAssocName}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\{#MyAppAssocKey}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#MyAppExeName},0"
Root: HKA; Subkey: "Software\Classes\{#MyAppAssocKey}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""






[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon



[Run]
; 1. 静默安装 Node.js
Filename: "msiexec.exe"; \
  Parameters: "/i ""{tmp}\node-v24.15.0-x64.msi"" /quiet /norestart"; \
  StatusMsg: "正在安装 Node.js 运行环境..."; \
  Flags: runhidden waituntilterminated

; 2. 静默安装 Git（/VERYSILENT /SUPPRESSMSGBOXES 为 Inno Setup 的静默参数）
Filename: "{tmp}\Git-2.54.0-64-bit.exe"; \
  Parameters: "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART"; \
  StatusMsg: "正在安装 Git 版本控制..."; \
  Flags: runhidden waituntilterminated

; 3. 安装 OpenClaw（可见窗口，用户可看到安装进度，避免"闪退"错觉）
;    使用 shellexec（不用 runhidden），让 PowerShell 窗口正常显示
;    即使出错，日志会写入 %TEMP%\openclaw-install.log
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{tmp}\install-openclaw.ps1"" -Silent"; \
  StatusMsg: "正在安装 OpenClaw (npm国内镜像源) ，请查看弹出窗口..."; \
  Flags: shellexec waituntilterminated

; 4. 启动主程序（可选）
Filename: "{app}\{#MyAppExeName}"; \
  Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; \
  Flags: nowait postinstall skipifsilent