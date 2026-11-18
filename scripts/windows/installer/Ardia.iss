[Setup]
AppId={{996E41A5-7F20-415A-BD04-91E365610996}
AppName=Nilla
AppVersion={#Version}
AppVerName=Nilla {#Version}
AppPublisher=Nilla
AppPublisherURL=https://github.com/NoorChasib/nilla
AppSupportURL=https://github.com/NoorChasib/nilla/issues
DefaultDirName={localappdata}\Programs\Nilla
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
PrivilegesRequired=lowest
OutputDir={#Out}
OutputBaseFilename=Nilla-Setup-{#Cpu}
LicenseFile=..\..\..\LICENSE
Compression=lzma2/max
SolidCompression=yes
LZMAUseSeparateProcess=yes
ArchitecturesAllowed={#Allowed}
ArchitecturesInstallIn64BitMode={#Allowed}
SetupIconFile={#Icon}
UninstallDisplayIcon={app}\Ardia.ico
UninstallDisplayName=Nilla
WizardStyle=modern
CloseApplications=yes
RestartApplications=no

[Files]
Source: "{#Source}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#Icon}"; DestDir: "{app}"; DestName: "Ardia.ico"; Flags: ignoreversion

[UninstallDelete]
Type: files; Name: "{app}\debug.log"
Type: dirifempty; Name: "{app}"

[Code]
function CreateFile(Name: String; Access, Share, Security, Disposition, Flags, Template: Cardinal): Cardinal;
  external 'CreateFileW@kernel32.dll stdcall';
function CloseHandle(Handle: Cardinal): Boolean;
  external 'CloseHandle@kernel32.dll stdcall';

function RelaunchAsked: Boolean;
begin
  Result := ExpandConstant('{param:relaunch|0}') = '1';
end;

function InUse(Path: String): Boolean;
var
  Handle: Cardinal;
begin
  Result := False;
  if not FileExists(Path) then Exit;
  Handle := CreateFile(Path, $40000000, 0, 0, 3, $80, 0);
  if Handle = $FFFFFFFF then
    Result := True
  else
    CloseHandle(Handle);
end;

function AppInUse: Boolean;
begin
  Result := InUse(ExpandConstant('{app}\Ardia.exe')) or InUse(ExpandConstant('{app}\chrome.dll')) or InUse(ExpandConstant('{app}\ArdiaApp.dll'));
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Waited: Integer;
begin
  Result := '';
  if not RelaunchAsked then Exit;
  Waited := 0;
  while AppInUse and (Waited < 30000) do
  begin
    Sleep(250);
    Waited := Waited + 250;
  end;
end;
