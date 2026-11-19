param(
  [Parameter(Mandatory = $true)][string]$Setup
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "package-licenses.ps1")

$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$uninstallKeys = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall"
$entry = "$uninstallKeys\{996E41A5-7F20-415A-BD04-91E365610996}_is1"
$upstreamEntry = "$uninstallKeys\{47A92F18-32B0-4548-A1EF-72C217FE1836}_is1"
$folder = Join-Path $env:LOCALAPPDATA "Programs\Nilla"
$upstreamFolders = @((Join-Path $env:LOCALAPPDATA "Ardia"), (Join-Path $env:APPDATA "Ardia"), (Join-Path $env:LOCALAPPDATA "Programs\Ardia"))
$nillaData = Join-Path $env:LOCALAPPDATA "Nilla"
$shortcutFolders = @((Join-Path $env:APPDATA "Microsoft\Windows\Start Menu"), (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu"), [Environment]::GetFolderPath("Desktop"), [Environment]::GetFolderPath("CommonDesktopDirectory"), (Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch"))
$names = @("Ardia", "Nilla")
$progIds = @("ArdiaHTM", "ArdiaPDF", "NillaHTM", "NillaPDF")
$schemes = @("ardia", "nilla")
$fileTypes = @(".htm", ".html", ".shtml", ".svg", ".webp", ".xht", ".xhtml", ".pdf")
$shipped = @("Nilla.exe", "ArdiaApp.dll", "chrome.dll", "Nilla.ico", "Nilla.build.json", "unins000.exe")
$licenses = [ordered]@{
  "LICENSE" = "LICENSE"
  "LICENSE.Apache-2.0" = "LICENSE.Apache-2.0"
  "NOTICE" = "NOTICE"
  "bangs-LICENSE" = "third_party\bangs\LICENSE"
  "symbols-THIRD_PARTY_NOTICES.txt" = "packages\demo\src\shims\web\symbols\THIRD_PARTY_NOTICES.txt"
}

function Get-Registrations {
  $found = @()
  foreach ($progId in $progIds) { if (Test-Path -LiteralPath "HKCU:\Software\Classes\$progId") { $found += "the ProgID $progId" } }
  foreach ($scheme in $schemes) { if (Test-Path -LiteralPath "HKCU:\Software\Classes\$scheme") { $found += "the $scheme`: URL scheme" } }
  foreach ($name in $names) {
    if (Test-Path -LiteralPath "HKCU:\Software\Clients\StartMenuInternet\$name") { $found += "StartMenuInternet\$name" }
    if ($null -ne (Get-ItemProperty -LiteralPath "HKCU:\Software\RegisteredApplications" -ErrorAction SilentlyContinue).$name) { $found += "RegisteredApplications\$name" }
    if ($null -ne (Get-ItemProperty -LiteralPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -ErrorAction SilentlyContinue).$name) { $found += "the Run value $name" }
    if (Test-Path -LiteralPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\$name.exe") { $found += "App Paths\$name.exe" }
    if (Test-Path -LiteralPath "HKCU:\Software\Classes\Applications\$name.exe") { $found += "Classes\Applications\$name.exe" }
  }
  foreach ($type in $fileTypes) {
    $list = Get-Item -LiteralPath "HKCU:\Software\Classes\$type\OpenWithProgids" -ErrorAction SilentlyContinue
    if ($list) { foreach ($progId in $progIds) { if ($list.GetValueNames() -contains $progId) { $found += "$type OpenWithProgids $progId" } } }
  }
  $classes = Get-ChildItem -LiteralPath "HKCU:\Software\Classes" -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -match '(?i)(^|[^a-z])(ardia|nilla)' }
  foreach ($class in $classes) { $found += "Classes\$($class.PSChildName)" }
  return ,@($found | Sort-Object -Unique)
}

function Get-Shortcuts {
  $shell = New-Object -ComObject WScript.Shell
  $found = @()
  foreach ($place in $shortcutFolders) {
    if (-not $place -or -not (Test-Path -LiteralPath $place -PathType Container)) { continue }
    foreach ($link in Get-ChildItem -LiteralPath $place -Recurse -File -Force -Filter "*.lnk" -ErrorAction SilentlyContinue) {
      $target = $shell.CreateShortcut($link.FullName).TargetPath
      if ($link.BaseName -match '(?i)(^|[^a-z])(ardia|nilla)' -or ($target -and $target.StartsWith("$folder\", [System.StringComparison]::OrdinalIgnoreCase))) { $found += $link.FullName }
    }
  }
  return ,$found
}

function Get-UpstreamFolders {
  return ,@($upstreamFolders | Where-Object { Test-Path -LiteralPath $_ })
}

function Get-RunningFromInstall {
  return ,@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith("$folder\", [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { "$($_.ProcessName) ($($_.Id))" })
}

function Start-StartWatch {
  $id = "installer-check-starts-" + [guid]::NewGuid().ToString("N")
  try {
    Register-CimIndicationEvent -ClassName Win32_ProcessStartTrace -SourceIdentifier $id -ErrorAction Stop | Out-Null
    return [pscustomobject]@{ Id = $id; Kind = "trace" }
  } catch {
    Write-Host "installer-check: no process start trace here ($($_.Exception.Message)), so it polls process creation every 0.2 s and can miss a shorter start"
    Register-CimIndicationEvent -Query "SELECT * FROM __InstanceCreationEvent WITHIN 0.2 WHERE TargetInstance ISA 'Win32_Process'" -SourceIdentifier $id -ErrorAction Stop | Out-Null
    return [pscustomobject]@{ Id = $id; Kind = "poll" }
  }
}

function Stop-StartWatch([object]$Watch) {
  Start-Sleep -Seconds 1
  $started = @()
  foreach ($raised in @(Get-Event -SourceIdentifier $Watch.Id -ErrorAction SilentlyContinue)) {
    $new = $raised.SourceEventArgs.NewEvent
    if ($Watch.Kind -eq "trace") { $name = $new.ProcessName; $id = $new.ProcessID; $path = "" }
    else { $name = $new.TargetInstance.Name; $id = $new.TargetInstance.ProcessId; $path = $new.TargetInstance.ExecutablePath }
    if (($launchers -contains $name) -or ($path -and $path.StartsWith("$folder\", [System.StringComparison]::OrdinalIgnoreCase))) { $started += "$name ($id)" }
  }
  Unregister-Event -SourceIdentifier $Watch.Id -ErrorAction SilentlyContinue
  Get-Event -SourceIdentifier $Watch.Id -ErrorAction SilentlyContinue | Remove-Event
  Write-Host "installer-check: watched every process start ($($Watch.Kind)), $($started.Count) from the install"
  return ,@($started)
}

function Assert-Nothing([object[]]$Found, [string]$What) {
  if ($Found.Count) { throw "$What`: $($Found -join ', ')" }
}

function Invoke-Quietly([string]$program, [string]$what) {
  $run = Start-Process -FilePath $program -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART" -Wait -PassThru
  if ($run.ExitCode -ne 0) { throw "$what exited with $($run.ExitCode)" }
}

if (-not (Test-Path -LiteralPath $Setup -PathType Leaf)) { throw "'$Setup' does not exist" }
if ((Test-Path -LiteralPath $entry) -or (Test-Path -LiteralPath $folder)) { throw "Nilla is already installed for this user: this check installs and removes it, so it only runs where it is not" }
if (Test-Path -LiteralPath $upstreamEntry) { throw "Ardia is installed for this user: this check proves Nilla leaves Ardia alone, so it only runs where Ardia never was" }
Assert-Nothing (Get-UpstreamFolders) "Ardia's folders are already here before the install, so something on this machine used them (a launch without ARDIA_DATA_DIR?)"
Assert-Nothing (Get-Registrations) "a browser registration is already here before the install"
Assert-Nothing (Get-Shortcuts) "a shortcut is already here before the install"
$nillaDataBefore = Test-Path -LiteralPath $nillaData

$launchers = @("Nilla.exe")
$installWatch = Start-StartWatch
Invoke-Quietly (Resolve-Path -LiteralPath $Setup).Path "the installer"
$launchers = @(@("Nilla.exe") + @(Get-ChildItem -LiteralPath $folder -Recurse -File -Filter "*.exe" -ErrorAction SilentlyContinue | Where-Object { $_.Name -ine "unins000.exe" } | ForEach-Object { $_.Name }) | Sort-Object -Unique)
$missing = @($shipped | Where-Object { -not (Test-Path -LiteralPath (Join-Path $folder $_) -PathType Leaf) })
if ($missing.Count) { throw "the install in $folder lacks $($missing -join ', ')" }
if (Get-ChildItem -LiteralPath $folder -Recurse -File -Force -Filter "Ardia.test-build" | Select-Object -First 1) { throw "the install in $folder carries an Ardia.test-build marker: a build people install must ignore test keys" }
foreach ($name in $licenses.Keys) {
  $installedText = Join-Path $folder "Licenses\$name"
  if (-not (Test-Path -LiteralPath $installedText -PathType Leaf)) { throw "the install in $folder lacks Licenses\$name" }
  $want = (Get-FileHash -LiteralPath (Join-Path $repository $licenses[$name]) -Algorithm SHA256).Hash
  $got = (Get-FileHash -LiteralPath $installedText -Algorithm SHA256).Hash
  if ($got -ne $want) { throw "Licenses\$name in $folder is not the repository's $($licenses[$name]) (SHA-256 $got, not $want)" }
}
$packageLicenses = Get-PinnedPackageLicenses $repository
foreach ($name in $packageLicenses.Keys) {
  $pinned = $packageLicenses[$name]
  $installedText = Join-Path $folder "Licenses\$name"
  if (-not (Test-Path -LiteralPath $installedText -PathType Leaf)) { throw "the install in $folder lacks Licenses\$name, $($pinned.package) $($pinned.version)'s $($pinned.license) notice" }
  $want = (Get-FileHash -LiteralPath $pinned.source -Algorithm SHA256).Hash
  $got = (Get-FileHash -LiteralPath $installedText -Algorithm SHA256).Hash
  if ($got -ne $want) { throw "Licenses\$name in $folder is not $($pinned.package) $($pinned.version)'s $($pinned.source) (SHA-256 $got, not $want)" }
}
Write-Host "installer-check: the install carries $($licenses.Count) licence texts, byte for byte the repository's, and $($packageLicenses.Count) pinned package notices ($(@($packageLicenses.Values | ForEach-Object { "$($_.package) $($_.version)" }) -join ', ')), byte for byte the package's"
$installed = Get-ItemProperty -LiteralPath $entry
if ($installed.DisplayName -ne "Nilla") { throw "the uninstall entry is named '$($installed.DisplayName)'" }
$displayIcon = ($installed.DisplayIcon -split ",")[0].Trim('"')
if (-not $displayIcon -or -not (Test-Path -LiteralPath $displayIcon -PathType Leaf)) { throw "the uninstall entry's icon '$($installed.DisplayIcon)' is not a file" }
& (Join-Path $PSScriptRoot "launcher-identity.ps1") -Icon $displayIcon -To (Join-Path $folder "Nilla.exe") -Check
if ($LASTEXITCODE -ne 0) { throw "the installed Nilla.exe does not carry Nilla's icon and name" }
Start-Sleep -Seconds 3
Assert-Nothing (Get-RunningFromInstall) "the installer started the app, which only nilla-dev-run.ps1 may start"
Assert-Nothing (Stop-StartWatch $installWatch) "the installer started the app, even if it has exited since; only nilla-dev-run.ps1 may start it"
Assert-Nothing (Get-Registrations) "the installer registered Nilla with Windows"
Assert-Nothing (Get-Shortcuts) "the installer made a shortcut, which would start the app without ARDIA_DATA_DIR"
Assert-Nothing (Get-UpstreamFolders) "the install made Ardia's folders"
if (Test-Path -LiteralPath $upstreamEntry) { throw "the install wrote Ardia's uninstall entry" }
$count = @(Get-ChildItem -LiteralPath $folder -Recurse -File).Count
Write-Host "installer-check: installed Nilla $($installed.DisplayVersion), $count files in $folder, with no shortcut, no registration and no start"

$uninstallWatch = Start-StartWatch
Invoke-Quietly (Join-Path $folder "unins000.exe") "the uninstaller"
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline -and ((Test-Path -LiteralPath $folder) -or (Test-Path -LiteralPath $entry))) { Start-Sleep -Milliseconds 500 }
Assert-Nothing (Stop-StartWatch $uninstallWatch) "the uninstaller started the app"
if (Test-Path -LiteralPath $folder) { throw "the uninstaller left $(@(Get-ChildItem -LiteralPath $folder -Recurse -File).Count) files in $folder" }
if (Test-Path -LiteralPath $entry) { throw "the uninstaller left its uninstall entry" }
Assert-Nothing (Get-Registrations) "the uninstaller left a browser registration"
Assert-Nothing (Get-Shortcuts) "the uninstaller left a shortcut"
Assert-Nothing (Get-UpstreamFolders) "the install and uninstall made Ardia's folders"
if (-not $nillaDataBefore -and (Test-Path -LiteralPath $nillaData)) { throw "the install or uninstall made Nilla's data folder $nillaData, so something started the app" }
Write-Host "installer-check: uninstalled, nothing left in $folder, and none of Ardia's folders exist"
