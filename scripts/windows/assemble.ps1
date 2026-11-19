param(
  [Parameter(Mandatory = $true)][string]$App,
  [Parameter(Mandatory = $true)][string]$Engine,
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Version = "",
  [int]$Build = 0,
  [string]$VcRedist = ""
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "vc-runtime.ps1")
. (Join-Path $PSScriptRoot "package-licenses.ps1")

$notShipped = @(".pdb", ".lib", ".exp", ".ilk", ".iobj", ".ipdb", ".winmd")
$launcher = "Nilla.exe"
$engineLauncher = "chrome.exe"
$library = "ArdiaApp.dll"
$engineNotes = "RUN.txt"
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$appIcon = Join-Path $repository "apps\browser\windows\Ardia\Ardia.ico"
$licenses = [ordered]@{
  "LICENSE" = "LICENSE"
  "LICENSE.Apache-2.0" = "LICENSE.Apache-2.0"
  "NOTICE" = "NOTICE"
  "bangs-LICENSE" = "third_party\bangs\LICENSE"
  "symbols-THIRD_PARTY_NOTICES.txt" = "packages\demo\src\shims\web\symbols\THIRD_PARTY_NOTICES.txt"
}

function Resolve-Folder([string]$path, [string]$what, [string]$marker) {
  if (-not (Test-Path -LiteralPath $path -PathType Container)) { throw "$what '$path' is not a folder" }
  $resolved = (Resolve-Path -LiteralPath $path).Path
  if (-not (Test-Path -LiteralPath (Join-Path $resolved $marker) -PathType Leaf)) { throw "$what '$path' has no $marker" }
  return $resolved
}

function Get-RelativeFiles([string]$root) {
  $prefix = $root.TrimEnd('\') + '\'
  return Get-ChildItem -LiteralPath $root -Recurse -File | ForEach-Object { $_.FullName.Substring($prefix.Length) }
}

function Test-SameFile([string]$one, [string]$other) {
  if ((Get-Item -LiteralPath $one).Length -ne (Get-Item -LiteralPath $other).Length) { return $false }
  return (Get-FileHash -LiteralPath $one -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $other -Algorithm SHA256).Hash
}

$packageLicenses = Get-PinnedPackageLicenses $repository
$appRoot = Resolve-Folder $App "The app's build output" $library
$engineRoot = Resolve-Folder $Engine "The engine" $engineLauncher
if (Test-Path -LiteralPath (Join-Path $engineRoot $library)) { throw "The engine '$Engine' already holds a $library" }
if (Test-Path -LiteralPath $Out) {
  if (Get-ChildItem -LiteralPath $Out -Force | Select-Object -First 1) { throw "'$Out' is not empty" }
} else {
  New-Item -ItemType Directory -Path $Out -Force | Out-Null
}
$outRoot = (Resolve-Path -LiteralPath $Out).Path

$engineFiles = @(Get-RelativeFiles $engineRoot | Where-Object { $_ -ine $engineNotes })
foreach ($relative in $engineFiles) {
  $target = Join-Path $outRoot $relative
  New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $engineRoot $relative) -Destination $target
}

$clashes = @()
$appCount = 0
foreach ($relative in (Get-RelativeFiles $appRoot)) {
  if ($relative -ieq $launcher) { continue }
  if ($relative -ieq "Ardia.test-build") { continue }
  if ($notShipped -contains [System.IO.Path]::GetExtension($relative).ToLowerInvariant()) { continue }
  $source = Join-Path $appRoot $relative
  $target = Join-Path $outRoot $relative
  if (Test-Path -LiteralPath $target -PathType Leaf) {
    if (-not (Test-SameFile $source $target)) { $clashes += $relative }
    continue
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $target
  $appCount += 1
}

$licenseFolder = Join-Path $outRoot "Licenses"
New-Item -ItemType Directory -Path $licenseFolder -Force | Out-Null
foreach ($name in $packageLicenses.Keys) {
  $target = Join-Path $licenseFolder $name
  if (Test-Path -LiteralPath $target) { throw "the engine or the app already ships a Licenses\$name" }
  Copy-Item -LiteralPath $packageLicenses[$name].source -Destination $target
}
foreach ($name in $licenses.Keys) {
  $source = Join-Path $repository $licenses[$name]
  $target = Join-Path $licenseFolder $name
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "the repository has no $($licenses[$name]) to ship as Licenses\$name" }
  if (Test-Path -LiteralPath $target) { throw "the engine or the app already ships a Licenses\$name" }
  Copy-Item -LiteralPath $source -Destination $target
}

Move-Item -LiteralPath (Join-Path $outRoot $engineLauncher) -Destination (Join-Path $outRoot $launcher)
& (Join-Path $PSScriptRoot "host-manifest.ps1") -From (Join-Path $appRoot $library) -To (Join-Path $outRoot $launcher)
if ($LASTEXITCODE -ne 0) { throw "the launcher did not get the app's manifest entries" }
& (Join-Path $PSScriptRoot "launcher-identity.ps1") -Icon $appIcon -To (Join-Path $outRoot $launcher)
if ($LASTEXITCODE -ne 0) { throw "the launcher did not get Nilla's icon and name" }

$launcherImage = Read-PeImage ([System.IO.File]::ReadAllBytes((Join-Path $outRoot $launcher)))
if (-not $launcherImage -or @("x64", "arm64") -notcontains $launcherImage.Cpu) { throw "$launcher is not an x64 or ARM64 program" }
Add-VcRuntime $outRoot $launcherImage.Cpu $VcRedist

if ($Build -gt 0) {
  if (-not $Version) { $Version = & (Join-Path $PSScriptRoot "project-version.ps1") }
  $identity = [ordered]@{ version = $Version; build = $Build } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText((Join-Path $outRoot "Nilla.build.json"), $identity, (New-Object System.Text.UTF8Encoding $false))
  Write-Host "assemble: this is Nilla $Version, build $Build"
}

Write-Host "assemble: $($engineFiles.Count) engine files, $appCount app files and $($licenses.Count + $packageLicenses.Count) licence texts in $outRoot"
foreach ($name in $packageLicenses.Keys) { Write-Host "assemble: Licenses\$name is $($packageLicenses[$name].package) $($packageLicenses[$name].version)'s $($packageLicenses[$name].license) notice from $($packageLicenses[$name].source)" }
foreach ($relative in $clashes) { Write-Host "assemble: kept the engine's $relative; the app's differs" }
