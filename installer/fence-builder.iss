; Inno Setup script for FenceBuilder-Setup-<version>.exe
; Build dist\FenceBuilder first (installer\fence-builder.spec), then from the repository root:
;   iscc /DAppVersion=1.2.3 installer\fence-builder.iss
; The installer goes to dist\installer\.
;
; Installs for the current user only (no admin prompt) to %LOCALAPPDATA%\Programs\Fence Builder.
; Jobs, prices and settings are NOT in that folder (they are in %LOCALAPPDATA%\Fence Builder\data),
; so updating, uninstalling or reinstalling never touches them.
;
; The app updates itself by running a newer one of these silently:
;   FenceBuilder-Setup-x.y.z.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /RELAUNCH=1 /PORT=8787
; /RELAUNCH=1 starts the new version when done, on the port given, so the open window reconnects.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#define AppName "Fence Builder"
#define AppExe "FenceBuilder.exe"

[Setup]
; never change AppId: it is how a newer installer finds and replaces the installed app
AppId={{0DB10FAB-6B28-4CB4-BCE4-937ED77D61E5}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Fence Builder
AppPublisherURL=https://github.com/Benbone21/fence-builder
AppSupportURL=https://github.com/Benbone21/fence-builder/issues
AppUpdatesURL=https://github.com/Benbone21/fence-builder/releases
VersionInfoVersion={#AppVersion}
PrivilegesRequired=lowest
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
DisableReadyPage=yes
UsePreviousAppDir=yes
UsePreviousTasks=yes
CloseApplications=yes
RestartApplications=no
SetupIconFile=..\fence.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist\installer
OutputBaseFilename=FenceBuilder-Setup-{#AppVersion}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Put a Fence Builder shortcut on the desktop"; GroupDescription: "Shortcuts:"

[Files]
; ignoreversion: always replace, the files carry no Windows version numbers to compare
Source: "..\dist\FenceBuilder\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; clear out the previous version's bundled files so nothing stale is left behind
Type: filesandordirs; Name: "{app}\_internal"

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; AppUserModelID: "FenceBuilder.App"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; AppUserModelID: "FenceBuilder.App"; Tasks: desktopicon

[Run]
; a normal install: offer to open it at the end
Filename: "{app}\{#AppExe}"; Description: "Open Fence Builder now"; Flags: nowait postinstall skipifsilent
; an in-app update: start the new version again on the same port as before
Filename: "{app}\{#AppExe}"; Parameters: "--updated --port={param:PORT|8787}"; Flags: nowait; Check: Relaunch

[Code]
function Relaunch: Boolean;
begin
  Result := ExpandConstant('{param:RELAUNCH|0}') = '1';
end;
