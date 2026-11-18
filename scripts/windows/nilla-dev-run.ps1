param(
  [string]$DataDir = (Join-Path $env:LOCALAPPDATA "Nilla"),
  [string]$App = (Join-Path $env:LOCALAPPDATA "Programs\Nilla\Ardia.exe"),
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $App -PathType Leaf)) { throw "nilla-dev-run: no app at $App; pass -App with the path to the build's Ardia.exe" }
$data = [System.IO.Path]::GetFullPath($DataDir).TrimEnd("\")
$ardia = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Ardia")).TrimEnd("\")
if ($data -ieq $ardia -or $data.StartsWith("$ardia\", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "nilla-dev-run: $data is Ardia's data folder; Nilla never uses it"
}
New-Item -ItemType Directory -Force -Path $data | Out-Null
$env:ARDIA_DATA_DIR = $data
Write-Host "nilla-dev-run: starting $App with ARDIA_DATA_DIR=$data"
if ($Arguments) {
  Start-Process -FilePath $App -ArgumentList $Arguments
} else {
  Start-Process -FilePath $App
}
