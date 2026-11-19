param(
  [Parameter(Mandatory = $true)][string]$App,
  [Parameter(Mandatory = $true)][string]$Out,
  [Parameter(Mandatory = $true)][string]$Proxy,
  [int]$Seconds = 660,
  [string]$Page = "https://example.org/"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "process-tree.ps1")
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Out = (Resolve-Path -LiteralPath $Out).Path
$App = (Resolve-Path -LiteralPath $App).Path
$appFolder = Split-Path -Parent $App
$log = Join-Path $Out "exercise-launch.log"
$data = Join-Path ([System.IO.Path]::GetTempPath()) ("nilla-exercise-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $data | Out-Null
Set-Content -Path (Join-Path $data "onboarding.json") -Value '{"completedAt":1700000000000,"version":1}' -Encoding utf8NoBOM

$report = [System.Collections.Generic.List[string]]::new()
$failures = @()
$report.Add("App: $App, with --proxy-server=$Proxy and HTTPS_PROXY=$env:HTTPS_PROXY, a scratch ARDIA_DATA_DIR, opening $Page")

$env:ARDIA_DATA_DIR = $data
$env:ARDIA_BACKGROUND = ""
$env:ARDIA_TEST = ""
$started = Get-Date
try {
  $process = Start-Process -FilePath $App -ArgumentList "--proxy-server=$Proxy", "--log-file=`"$log`"", $Page -PassThru
  $null = $process.Handle
  $deadline = $started.AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline -and -not $process.HasExited) { Start-Sleep -Seconds 5 }
  $ran = [int]((Get-Date) - $started).TotalSeconds
  if ($process.HasExited) {
    $failures += "the app exited after $ran s with code $($process.ExitCode), before the $Seconds s the timers need"
  } else {
    $report.Add("It ran for $ran s")
    $null = $process.CloseMainWindow()
    if (-not $process.WaitForExit(15000)) {
      $running = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CreationDate)
      foreach ($id in (Get-StopOrder $process.Id $running)) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
      $report.Add("It didn't close within 15 s of the close request; its process tree was stopped")
    } else {
      $report.Add("It closed when asked")
    }
  }
} finally {
  $stragglers = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($appFolder + "\", [System.StringComparison]::OrdinalIgnoreCase) -and $_.CreationDate -ge $started })
  foreach ($straggler in $stragglers) { Stop-Process -Id $straggler.ProcessId -Force -ErrorAction SilentlyContinue }
  $env:ARDIA_DATA_DIR = ""
  for ($try = 0; $try -lt 10 -and (Test-Path -LiteralPath $data); $try++) {
    Remove-Item -LiteralPath $data -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $data) { Start-Sleep -Seconds 2 }
  }
}

$covered = @("the kill-switch fetch and the first update check (30 s)", "the telemetry flush (30 s)")
if ($Seconds -ge 600) { $covered += "the diagnostics context (every 10 min)" }
$report.Add("Automatic timers inside this run: $($covered -join ', '). Longer than the run: the hourly telemetry watch and the 6-hour update repeat; the whole job's watch covers the tours too.")
if (Test-Path -LiteralPath $log) { $report.Add("Launch log: $((Get-Content -LiteralPath $log).Count) lines in exercise-launch.log") } else { $report.Add("Launch log: none written") }

$report | Set-Content -LiteralPath (Join-Path $Out "exercise.md") -Encoding utf8NoBOM
$report | ForEach-Object { Write-Host $_ }
if ($failures.Count) {
  $failures | ForEach-Object { Write-Host "::error::$_" }
  exit 1
}
exit 0
