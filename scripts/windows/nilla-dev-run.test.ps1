$ErrorActionPreference = "Stop"

$failures = @()
$shell = (Get-Process -Id $PID).Path
$devRun = Join-Path $PSScriptRoot "nilla-dev-run.ps1"
$root = Join-Path ([System.IO.Path]::GetTempPath()) ("nilla-dev-run-test-" + [guid]::NewGuid().ToString("N"))
$local = Join-Path $root "Local Application Data"
$roaming = Join-Path $root "Roaming"
$ardia = Join-Path $local "Ardia"
$app = Join-Path $root "Nilla.exe"
New-Item -ItemType Directory -Force -Path $ardia, (Join-Path $roaming "Ardia"), (Join-Path $root "scratch"), (Join-Path $ardia "inner") | Out-Null
Set-Content -LiteralPath $app -Value "" -Encoding ascii
$savedLocal = $env:LOCALAPPDATA
$savedRoaming = $env:APPDATA

function Invoke-DevRun([string]$DataDir, [string]$Where = $root) {
  Push-Location -LiteralPath $Where
  try {
    $env:LOCALAPPDATA = $local
    $env:APPDATA = $roaming
    $ErrorActionPreference = "Continue"
    $said = & $shell -NoProfile -NonInteractive -File $devRun -DataDir $DataDir -App $app -Check 2>&1 | Out-String
    return [pscustomobject]@{ Code = $LASTEXITCODE; Said = $said.Trim() }
  } finally {
    $env:LOCALAPPDATA = $savedLocal
    $env:APPDATA = $savedRoaming
    Pop-Location
  }
}

function Expect-Refused([string]$Case, [string]$DataDir, [string]$Where = $root) {
  $run = Invoke-DevRun $DataDir $Where
  if ($run.Code -ne 0 -and $run.Said -match "nilla-dev-run: ") { Write-Host "pass: $Case is refused" }
  else { $script:failures += "$Case ($DataDir from $Where) was not refused: exit $($run.Code), $($run.Said)" }
}

function Expect-Allowed([string]$Case, [string]$DataDir) {
  $run = Invoke-DevRun $DataDir
  if ($run.Code -eq 0 -and $run.Said -match "would start") { Write-Host "pass: $Case is allowed" }
  else { $script:failures += "$Case ($DataDir) was refused: exit $($run.Code), $($run.Said)" }
}

try {
  New-Item -ItemType Junction -Path (Join-Path $root "alias") -Target $ardia | Out-Null
  New-Item -ItemType Junction -Path (Join-Path $root "scratch\Chromium") -Target $ardia | Out-Null

  Expect-Refused "Ardia's data folder" $ardia
  Expect-Refused "a folder inside Ardia's data folder that doesn't exist yet" (Join-Path $ardia "User Data\more")
  Expect-Refused "Ardia's roaming folder" (Join-Path $roaming "Ardia")
  Expect-Refused "Ardia's install folder" (Join-Path $local "Programs\Ardia")
  Expect-Refused "a folder that holds Ardia's data folder" $local
  Expect-Refused "a junction to Ardia's data folder" (Join-Path $root "alias")
  Expect-Refused "a folder under a junction to Ardia's data folder" (Join-Path $root "alias\new")
  Expect-Refused "a scratch folder whose Chromium is a junction to Ardia's data folder" (Join-Path $root "scratch")
  Expect-Refused "Ardia's data folder as an extended path" "\\?\$ardia"
  Expect-Refused "Ardia's data folder with a trailing dot" "$ardia."
  Expect-Refused "Ardia's data folder with a trailing space" "$ardia "
  Expect-Refused "Ardia's data folder in other case" $ardia.ToUpperInvariant()
  Expect-Refused "Ardia's data folder as a relative ." "." $ardia
  Expect-Refused "Ardia's data folder as a relative .." ".." (Join-Path $ardia "inner")
  Expect-Refused "Ardia's data folder through .." (Join-Path $root "scratch\..\Local Application Data\Ardia")

  $short = (New-Object -ComObject Scripting.FileSystemObject).GetFolder($local).ShortPath
  if ($short -and $short -ne $local) { Expect-Refused "Ardia's data folder through an 8.3 short name" (Join-Path $short "Ardia") }
  else { Write-Host "note: this volume makes no 8.3 short names, so that case can't run here" }

  try {
    New-Item -ItemType SymbolicLink -Path (Join-Path $root "linked") -Target $ardia -ErrorAction Stop | Out-Null
    Expect-Refused "a symbolic link to Ardia's data folder" (Join-Path $root "linked")
    New-Item -ItemType SymbolicLink -Path (Join-Path $root "dangling") -Target (Join-Path $root "gone") -ErrorAction Stop | Out-Null
    Expect-Refused "a dangling symbolic link" (Join-Path $root "dangling")
  } catch {
    Write-Host "note: no symbolic links here ($($_.Exception.Message))"
  }

  Expect-Allowed "a scratch folder of its own" (Join-Path $root "own")
  Expect-Allowed "Nilla's own folder beside Ardia's" (Join-Path $local "Nilla")
  Expect-Allowed "a folder whose name starts like Ardia's" (Join-Path $local "Ardia Two")
} finally {
  foreach ($link in @("alias", "scratch\Chromium", "linked", "dangling")) {
    $path = Join-Path $root $link
    if (Test-Path -LiteralPath $path) { (Get-Item -LiteralPath $path -Force).Delete() }
    elseif (Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue) { (Get-Item -LiteralPath $path -Force).Delete() }
  }
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

if ($failures.Count) {
  $failures | ForEach-Object { Write-Host "::error::$_" }
  exit 1
}
Write-Host "nilla-dev-run refuses every way of reaching Ardia's folders and still starts with folders of its own."
exit 0
