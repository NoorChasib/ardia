param(
  [Parameter(Mandatory = $true)][string]$App,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Seconds = 30,
  [switch]$AppOnly,
  [string]$KnownLimit = ""
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "process-tree.ps1")
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Out = (Resolve-Path -LiteralPath $Out).Path
$traces = Join-Path $PSScriptRoot "upstream-traces.ps1"
$report = [System.Collections.Generic.List[string]]::new()
$failures = @()

$App = (Resolve-Path -LiteralPath $App).Path
$appFolder = Split-Path -Parent $App
$report.Add("App: $App")
if ($AppOnly) { $report.Add("Without an assembled engine: the app alone was launched, so this says nothing about the engine's own default folders") }
if ($KnownLimit) { $report.Add("Known limit: $KnownLimit") }

& $traces -Out (Join-Path $Out "traces-before.json") -Label "before the bare launch"
if ($LASTEXITCODE -ne 0) { $failures += "an upstream trace was already there before the bare launch (traces-before.json), so the bare launch can't show it left none" }

$cleared = @(Get-ChildItem env: | Where-Object { $_.Name -like "ARDIA_*" -or $_.Name -like "NILLA_*" } | ForEach-Object { $_.Name } | Sort-Object)
foreach ($name in $cleared) { Remove-Item -LiteralPath "env:$name" }
$report.Add("Environment cleared for the launch: $(if ($cleared.Count) { $cleared -join ', ' } else { 'nothing was set' }); no arguments")

$ownData = Join-Path $env:LOCALAPPDATA "Nilla"
$ownDataBefore = Test-Path -LiteralPath $ownData
$started = Get-Date
$process = Start-Process -FilePath $App -PassThru
$null = $process.Handle
if ($process.WaitForExit($Seconds * 1000)) {
  $report.Add("It exited by itself after $([int]((Get-Date) - $started).TotalSeconds) s with code $($process.ExitCode)")
} else {
  $report.Add("It was still running after $Seconds s; its process tree was stopped")
  $running = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CreationDate)
  foreach ($id in (Get-StopOrder $process.Id $running)) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
}
$stragglers = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($appFolder + "\", [System.StringComparison]::OrdinalIgnoreCase) -and $_.CreationDate -ge $started })
foreach ($straggler in $stragglers) { Stop-Process -Id $straggler.ProcessId -Force -ErrorAction SilentlyContinue }
if ($stragglers.Count) { $report.Add("Stopped $($stragglers.Count) process(es) it left running from its folder") }
Start-Sleep -Seconds 5

$ownDataAfter = Test-Path -LiteralPath $ownData
$report.Add("%LOCALAPPDATA%\Nilla: $(if ($ownDataBefore) { 'already there before the launch' } elseif ($ownDataAfter) { 'created by the launch' } else { 'not created' })")
$launchLog = Join-Path $ownData "Logs\launch.log"
if ((-not $ownDataBefore) -and (Test-Path -LiteralPath $launchLog)) {
  $report.Add("Its launch log ends with:")
  Get-Content -LiteralPath $launchLog -Tail 20 | ForEach-Object { $report.Add("    $_") }
}
$report.Add("The development build's refusal without ARDIA_DATA_DIR is not the pass condition; the pass condition is that the upstream app's folder and registrations still don't exist.")

& $traces -Out (Join-Path $Out "traces-after.json") -Label "after the bare launch"
if ($LASTEXITCODE -ne 0) { $failures += "the bare launch left an upstream trace (traces-after.json)" } else { $report.Add("After it: none of the upstream app's folders or registrations exist") }

$report | Set-Content -LiteralPath (Join-Path $Out "bare-launch.md") -Encoding utf8NoBOM
$report | ForEach-Object { Write-Host $_ }
if ($env:GITHUB_STEP_SUMMARY) {
  $summary = @("### Bare launch, last on the runner") + @($report | ForEach-Object { "- $_" })
  if ($failures.Count) { $summary += @($failures | ForEach-Object { "- **failed:** $_" }) }
  if ($failures.Count -and $KnownLimit) { $summary += "- **known Layer 2 limit, still failing:** $KnownLimit" }
  elseif ($KnownLimit) { $summary += "- **passed**, although this row was expected to fail as a known Layer 2 limit: check what changed in the engine, then retire the limit" }
  elseif ($AppOnly) { $summary += "- **unverified** for the engine: the app alone $(if ($failures.Count) { 'failed' } else { 'left no upstream trace' })" }
  elseif (-not $failures.Count) { $summary += "- **passed**" }
  $summary | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY
}
if ($failures.Count) {
  $failures | ForEach-Object { Write-Host "::error::$_" }
  exit 1
}
exit 0
