param(
  [string]$Out = "",
  [string]$Label = "now"
)

$ErrorActionPreference = "Stop"

$folders = [ordered]@{
  "%LOCALAPPDATA%\Ardia" = (Join-Path $env:LOCALAPPDATA "Ardia")
  "%APPDATA%\Ardia" = (Join-Path $env:APPDATA "Ardia")
  "%LOCALAPPDATA%\Programs\Ardia" = (Join-Path $env:LOCALAPPDATA "Programs\Ardia")
}
$progId = "HKCU\Software\Classes\ArdiaHTM"
$registered = "HKCU\Software\RegisteredApplications"
$registeredName = "Ardia"

$checked = [System.Collections.Generic.List[string]]::new()
$found = [System.Collections.Generic.List[string]]::new()
foreach ($name in $folders.Keys) {
  $checked.Add($name)
  if (Test-Path -LiteralPath $folders[$name]) { $found.Add("the folder $name") }
}
$checked.Add($progId)
if (Test-Path -LiteralPath "Registry::HKEY_CURRENT_USER\Software\Classes\ArdiaHTM") { $found.Add("the key $progId") }
$checked.Add("$registered\$registeredName")
$registeredKey = "Registry::HKEY_CURRENT_USER\Software\RegisteredApplications"
if (Test-Path -LiteralPath (Join-Path $registeredKey $registeredName)) { $found.Add("the key $registered\$registeredName") }
$values = Get-ItemProperty -LiteralPath $registeredKey -ErrorAction SilentlyContinue
if ($values -and $values.PSObject.Properties[$registeredName]) { $found.Add("the value $registeredName under $registered") }

$result = [ordered]@{ label = $Label; time = (Get-Date).ToUniversalTime().ToString("o"); checked = @($checked); found = @($found) }
if ($Out) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Out) | Out-Null
  $result | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $Out -Encoding utf8NoBOM
}
if ($found.Count) {
  foreach ($trace in $found) { Write-Host "::error::$Label`: $trace exists; Nilla must leave nothing of the upstream app's behind" }
  exit 1
}
Write-Host "$Label`: none of $($checked -join ', ') exists"
exit 0
