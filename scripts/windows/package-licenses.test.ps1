$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "package-licenses.ps1")

$failures = @()
function Check([string]$Name, [bool]$Passed, [string]$Detail = "") {
  if ($Passed) { Write-Host "pass: $Name" } else { $script:failures += "$Name$(if ($Detail) { ": $Detail" })" }
}
function Refusal([scriptblock]$Run) {
  try { & $Run | Out-Null; return "" } catch { return "$($_.Exception.Message)" }
}

$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$entry = $pinnedPackageLicenses["react-native-windows-LICENSE"]
Check "the pinned package manifest ships React Native for Windows' notice as Licenses\react-native-windows-LICENSE" ($null -ne $entry -and $entry.package -eq "react-native-windows" -and $entry.license -eq "MIT" -and $entry.text -eq "LICENSE")
$mitGrant = "Permission is hereby granted, free of charge, to any person obtaining a copy"
$mitDisclaimer = 'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND'

$pin = "$((Get-Content -LiteralPath ([System.IO.Path]::Combine($repository, "apps", "browser", "package.json")) -Raw | ConvertFrom-Json -AsHashtable).dependencies['react-native-windows'])"
Check "a LICENSE digest is recorded for the pinned version $pin" ($entry.sha256.Contains($pin) -and $entry.sha256[$pin] -match '^[0-9A-F]{64}$') "$($entry.sha256.Keys -join ', ')"
$resolved = $null
$fullBytes = $null
$problem = Refusal { $script:resolved = Get-PinnedPackageLicenses $repository }
Check "this checkout resolves React Native for Windows' licence at the version apps/browser/package.json pins" (-not $problem -and $resolved.Contains("react-native-windows-LICENSE")) $problem
if ($resolved -and $resolved.Contains("react-native-windows-LICENSE")) {
  $shipped = $resolved["react-native-windows-LICENSE"]
  Check "the resolved notice is version $pin" ($shipped.version -eq $pin) "$($shipped.version)"
  $folder = Split-Path -Parent $shipped.source
  $package = Get-Content -LiteralPath (Join-Path $folder "package.json") -Raw | ConvertFrom-Json -AsHashtable
  Check "the notice comes from the react-native-windows package of that version" ($package.name -eq "react-native-windows" -and $package.version -eq $pin -and (Split-Path -Leaf $shipped.source) -eq "LICENSE") $shipped.source
  $fullBytes = [System.IO.File]::ReadAllBytes($shipped.source)
  $text = [System.Text.Encoding]::UTF8.GetString($fullBytes)
  Check "the notice is the full MIT text with Microsoft's copyright" ($text.StartsWith("The MIT License") -and $text.Contains("Copyright (c) Microsoft Corporation") -and $text.Contains($mitGrant) -and $text.Contains("The above copyright notice and this permission notice shall be included") -and $text.Contains($mitDisclaimer))
}
if ($null -eq $fullBytes) {
  $failures += "the refusal cases need this checkout's react-native-windows $pin LICENSE, which didn't resolve"
  $fullBytes = [byte[]]@()
}
$fullText = [System.Text.Encoding]::UTF8.GetString($fullBytes)
function New-FakeRepository([string]$Pin) {
  $root = Join-Path ([System.IO.Path]::GetTempPath()) ("nilla-licences-" + [guid]::NewGuid().ToString("N"))
  $app = [System.IO.Path]::Combine($root, "apps", "browser")
  New-Item -ItemType Directory -Force -Path $app | Out-Null
  [ordered]@{ name = "nilla"; dependencies = [ordered]@{ "react-native-windows" = $Pin } } | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $app "package.json") -Encoding utf8NoBOM
  return $root
}
function Add-Package([string]$Root, [string[]]$Where, [string]$Version, [string]$License = "MIT", [string]$Text = $fullText, [switch]$NoText) {
  $bytes = if ($Text -ceq $fullText) { $fullBytes } else { [System.Text.Encoding]::UTF8.GetBytes($Text) }
  $folder = [System.IO.Path]::Combine([string[]](@($Root) + $Where + @("react-native-windows")))
  New-Item -ItemType Directory -Force -Path $folder | Out-Null
  [ordered]@{ name = "react-native-windows"; version = $Version; license = $License } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $folder "package.json") -Encoding utf8NoBOM
  if (-not $NoText) { [System.IO.File]::WriteAllBytes((Join-Path $folder "LICENSE"), $bytes) }
  return $folder
}

$fakes = @()
try {
  $fake = New-FakeRepository "0.81.38"; $fakes += $fake
  $problem = Refusal { Get-PinnedPackageLicenses $fake }
  Check "with no react-native-windows installed nothing is shipped and the assembly stops" ($problem -like "no react-native-windows 0.81.38 package*none installed*") $problem

  $fake = New-FakeRepository "0.81.38"; $fakes += $fake
  $null = Add-Package $fake @("node_modules") "0.80.2"
  $problem = Refusal { Get-PinnedPackageLicenses $fake }
  Check "another version's notice is never shipped in the pinned one's place" ($problem -like "*holds react-native-windows 0.80.2*") $problem

  $handed = Add-Package $fake @(".ci", "windows-javascript", "node_modules") "0.81.38"
  $found = Get-PinnedPackageLicenses $fake
  Check "the copy the javascript job hands over serves when the checkout has no node_modules of that version" ($found["react-native-windows-LICENSE"].source -eq (Resolve-Path -LiteralPath (Join-Path $handed "LICENSE")).Path) "$($found['react-native-windows-LICENSE'].source)"

  $app = Add-Package $fake @("apps", "browser", "node_modules") "0.81.38"
  $found = Get-PinnedPackageLicenses $fake
  Check "the app's own node_modules comes first, as Node resolves it" ($found["react-native-windows-LICENSE"].source -eq (Resolve-Path -LiteralPath (Join-Path $app "LICENSE")).Path) "$($found['react-native-windows-LICENSE'].source)"

  foreach ($case in @(@("^0.81.38", "a range"), @("", "no pin"), @("latest", "a tag"))) {
    $fake = New-FakeRepository $case[0]; $fakes += $fake
    $null = Add-Package $fake @("node_modules") "0.81.38"
    $problem = Refusal { Get-PinnedPackageLicenses $fake }
    Check "a pin that is $($case[1]) is refused, since the notice to ship can't be chosen" ($problem -like "*not an exact version*") $problem
  }

  $fake = New-FakeRepository "0.81.38"; $fakes += $fake
  $null = Add-Package $fake @("node_modules") "0.81.38" "Apache-2.0"
  $problem = Refusal { Get-PinnedPackageLicenses $fake }
  Check "a package that declares another licence is refused" ($problem -like "*declares the licence 'Apache-2.0'*") $problem

  $fake = New-FakeRepository "0.81.38"; $fakes += $fake
  $null = Add-Package $fake @("node_modules") "0.81.38" "MIT" -NoText
  $problem = Refusal { Get-PinnedPackageLicenses $fake }
  Check "a package with no LICENSE file is refused" ($problem -like "*has no LICENSE*") $problem

  $sentences = @($fullText -split '(?<=\.)\s+' | Where-Object { $_.Trim() })
  $cuts = @(
    @($fullText.Replace($mitDisclaimer, ""), "without the warranty disclaimer"),
    @($fullText.Replace($mitGrant, ""), "without the permission grant"),
    @($fullText.Replace("Microsoft Corporation", ""), "without Microsoft's copyright"),
    @($fullText.Substring(0, [Math]::Floor($fullText.Length / 2)), "cut in half"),
    @((($sentences | Select-Object -SkipLast 1) -join " "), "without its last sentence, the grant and disclaimer still in place"),
    @("The MIT License (MIT)`n`nCopyright (c) Microsoft Corporation`n`n$mitGrant of this software.`n`n$mitDisclaimer.`n", "abbreviated to the copyright, the grant's first line and the disclaimer's first line"),
    @($fullText.Replace("`n", "`r`n"), "with its line endings changed"),
    @(($fullText + "`n"), "with a byte added")
  )
  foreach ($cut in $cuts) {
    $fake = New-FakeRepository "0.81.38"; $fakes += $fake
    $null = Add-Package $fake @("node_modules") "0.81.38" "MIT" $cut[0]
    $problem = Refusal { Get-PinnedPackageLicenses $fake }
    Check "a notice $($cut[1]) is not the recorded full text and is refused" ($problem -like "*is not the full MIT notice recorded for react-native-windows 0.81.38*") $problem
  }

  $fake = New-FakeRepository "0.81.39"; $fakes += $fake
  $null = Add-Package $fake @("node_modules") "0.81.39"
  $problem = Refusal { Get-PinnedPackageLicenses $fake }
  Check "a newly pinned version whose LICENSE digest isn't recorded yet is refused, even with the same text" ($problem -like "*records no LICENSE digest for react-native-windows 0.81.39*") $problem
} finally {
  foreach ($fake in $fakes) { Remove-Item -LiteralPath $fake -Recurse -Force -ErrorAction SilentlyContinue }
}

$scriptText = @{}
foreach ($name in "assemble.ps1", "make-installer.ps1", "installer-check.ps1") { $scriptText[$name] = Get-Content -LiteralPath (Join-Path $PSScriptRoot $name) -Raw }
foreach ($name in $scriptText.Keys) {
  Check "$name reads the pinned package notices from package-licenses.ps1" ($scriptText[$name].Contains('. (Join-Path $PSScriptRoot "package-licenses.ps1")') -and $scriptText[$name].Contains('$packageLicenses = Get-PinnedPackageLicenses $repository'))
}
Check "assemble.ps1 copies each pinned notice into Licenses" ($scriptText["assemble.ps1"] -match 'Copy-Item -LiteralPath \$packageLicenses\[\$name\]\.source -Destination \$target')
Check "make-installer.ps1 refuses a package whose pinned notice differs from the package's" ($scriptText["make-installer.ps1"] -match 'Get-FileHash -LiteralPath \$pinned\.source')
Check "installer-check.ps1 compares each installed pinned notice with the package's bytes" ($scriptText["installer-check.ps1"] -match '\$want = \(Get-FileHash -LiteralPath \$pinned\.source -Algorithm SHA256\)\.Hash')
$workflow = Get-Content -LiteralPath ([System.IO.Path]::Combine($repository, ".github", "workflows", "windows.yml")) -Raw
Check "the javascript job hands React Native for Windows' LICENSE and package.json to the launch jobs" ($workflow.Contains('.ci/windows-javascript/node_modules/react-native-windows"') -and $workflow.Contains('cp "$from/LICENSE" "$from/package.json" "$to/"'))
Check "the launch jobs run this test after the hand-over is restored" ($workflow.IndexOf("scripts/windows/package-licenses.test.ps1") -gt $workflow.IndexOf("- name: Take the bundle this run made"))

if ($failures.Count) {
  $failures | ForEach-Object { Write-Host "::error::$_" }
  exit 1
}
Write-Host "The Windows package ships React Native for Windows' full MIT notice at the pinned version, and the assembly, the installer and the install check hold it to the package's bytes."
