[CmdletBinding()]
param(
  [string]$DataDir = (Join-Path $env:LOCALAPPDATA "Nilla"),
  [string]$App = (Join-Path $env:LOCALAPPDATA "Programs\Nilla\Nilla.exe"),
  [switch]$Check,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class NillaDevRunPaths {
  public const uint VolumeGuid = 0x1;
  public const uint VolumeDos = 0x0;
  const uint OpenExisting = 3;
  const uint ShareAll = 7;
  const uint BackupSemantics = 0x02000000;
  const uint OpenReparsePoint = 0x00200000;

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder path, uint size, uint flags);

  static string FinalPath(string path, uint volume, uint extra, out int error) {
    error = 0;
    using (SafeFileHandle handle = CreateFileW(path, 0, ShareAll, IntPtr.Zero, OpenExisting, BackupSemantics | extra, IntPtr.Zero)) {
      if (handle.IsInvalid) { error = Marshal.GetLastWin32Error(); return null; }
      uint size = GetFinalPathNameByHandleW(handle, null, 0, volume);
      if (size == 0) { error = Marshal.GetLastWin32Error(); return null; }
      var found = new StringBuilder((int)size + 1);
      uint written = GetFinalPathNameByHandleW(handle, found, (uint)found.Capacity, volume);
      if (written == 0 || written >= found.Capacity) { error = Marshal.GetLastWin32Error(); return null; }
      return found.ToString();
    }
  }

  public static string Resolve(string path, uint volume) {
    string at = path;
    var tail = new List<string>();
    while (true) {
      int error;
      string final = FinalPath(at, volume, 0, out error);
      if (final != null) {
        foreach (string part in tail) final = final.TrimEnd('\\') + "\\" + part;
        return final;
      }
      if (error != 2 && error != 3) return null;
      int ignored;
      if (FinalPath(at, volume, OpenReparsePoint, out ignored) != null) return null;
      string parent = Path.GetDirectoryName(at);
      if (string.IsNullOrEmpty(parent) || string.Equals(parent, at, StringComparison.OrdinalIgnoreCase)) return null;
      tail.Insert(0, Path.GetFileName(at));
      at = parent;
    }
  }

  public static string[] Parts(string path) {
    var parts = new List<string>();
    foreach (string part in path.Split(new[] { '\\', '/' }, StringSplitOptions.RemoveEmptyEntries)) parts.Add(part.TrimEnd('.', ' ').ToUpperInvariant());
    return parts.ToArray();
  }

  public static bool WithinOrSame(string inner, string outer) {
    string[] a = Parts(inner);
    string[] b = Parts(outer);
    if (a.Length < b.Length) return false;
    for (int i = 0; i < b.Length; i++) if (!string.Equals(a[i], b[i], StringComparison.Ordinal)) return false;
    return true;
  }
}
"@

function Resolve-Canonical([string]$Path, [string]$What) {
  $resolved = [NillaDevRunPaths]::Resolve($Path, [NillaDevRunPaths]::VolumeGuid)
  if (-not $resolved) { throw "nilla-dev-run: can't tell where $What ($Path) leads on a local volume, so Nilla won't use it" }
  return $resolved
}

function Get-UpstreamFolders {
  $local = @([Environment]::GetFolderPath("LocalApplicationData"), $env:LOCALAPPDATA) | Where-Object { $_ } | Select-Object -Unique
  $roaming = @([Environment]::GetFolderPath("ApplicationData"), $env:APPDATA) | Where-Object { $_ } | Select-Object -Unique
  $upstream = @()
  foreach ($base in $local) { $upstream += (Join-Path $base "Ardia"), (Join-Path $base "Programs\Ardia") }
  foreach ($base in $roaming) { $upstream += (Join-Path $base "Ardia") }
  return @($upstream | ForEach-Object { Resolve-Canonical $_ "Ardia's folder" })
}

function Assert-ApartFromUpstream([string]$Data, [string[]]$Upstream) {
  foreach ($used in @($Data, [System.IO.Path]::Combine($Data, "Chromium"), [System.IO.Path]::Combine($Data, "Sync"), [System.IO.Path]::Combine($Data, "config"))) {
    $canonical = Resolve-Canonical $used "the data folder"
    foreach ($ardia in $Upstream) {
      if ([NillaDevRunPaths]::WithinOrSame($canonical, $ardia) -or [NillaDevRunPaths]::WithinOrSame($ardia, $canonical)) {
        throw "nilla-dev-run: $used leads to $canonical, which is or holds Ardia's folder $ardia; Nilla never uses it"
      }
    }
  }
}

if (-not (Test-Path -LiteralPath $App -PathType Leaf)) { throw "nilla-dev-run: no app at $App; pass -App with the path to the build's Nilla.exe" }
foreach ($argument in $Arguments) {
  if ($argument -match '^(--?|/)user-data-dir(=|$)') { throw "nilla-dev-run: $argument isn't allowed; the profile always comes from -DataDir" }
}
try { $data = $PSCmdlet.GetUnresolvedProviderPathFromPSPath($DataDir) } catch { throw "nilla-dev-run: can't read $DataDir as a folder path: $($_.Exception.Message)" }
$upstream = Get-UpstreamFolders
Assert-ApartFromUpstream $data $upstream
if ($Check) {
  Write-Host "nilla-dev-run: would start $App with ARDIA_DATA_DIR=$data, apart from Ardia's folders"
  return
}
New-Item -ItemType Directory -Force -Path $data | Out-Null
Assert-ApartFromUpstream $data $upstream
$final = [NillaDevRunPaths]::Resolve($data, [NillaDevRunPaths]::VolumeDos)
if (-not $final) { throw "nilla-dev-run: can't tell where $data leads now that it exists" }
$data = $final -replace '^\\\\\?\\UNC\\', '\\' -replace '^\\\\\?\\', ''
$env:ARDIA_DATA_DIR = $data
Write-Host "nilla-dev-run: starting $App with ARDIA_DATA_DIR=$data"
if ($Arguments) {
  Start-Process -FilePath $App -ArgumentList $Arguments
} else {
  Start-Process -FilePath $App
}
