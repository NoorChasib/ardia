$pinnedPackageLicenses = [ordered]@{
  "react-native-windows-LICENSE" = [ordered]@{ package = "react-native-windows"; license = "MIT"; text = "LICENSE"; holder = "Microsoft Corporation" }
}
$mitGrant = "Permission is hereby granted, free of charge, to any person obtaining a copy"
$mitDisclaimer = 'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND'

function Get-PackageFolders([string]$Repository, [string]$Package) {
  return @(
    [System.IO.Path]::Combine($Repository, "apps", "browser", "node_modules", $Package),
    [System.IO.Path]::Combine($Repository, "node_modules", $Package),
    [System.IO.Path]::Combine($Repository, ".ci", "windows-javascript", "node_modules", $Package)
  )
}

function Get-PinnedPackageLicenses([string]$Repository) {
  $appManifest = [System.IO.Path]::Combine($Repository, "apps", "browser", "package.json")
  if (-not (Test-Path -LiteralPath $appManifest -PathType Leaf)) { throw "the repository has no apps/browser/package.json to read the pinned packages from" }
  $app = Get-Content -LiteralPath $appManifest -Raw | ConvertFrom-Json -AsHashtable
  $found = [ordered]@{}
  foreach ($name in $pinnedPackageLicenses.Keys) {
    $wanted = $pinnedPackageLicenses[$name]
    $pin = "$($app.dependencies[$wanted.package])"
    if ($pin -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') { throw "apps/browser/package.json pins $($wanted.package) as '$pin', not an exact version, so the licence text to ship can't be chosen" }
    $seen = @()
    foreach ($folder in (Get-PackageFolders $Repository $wanted.package)) {
      $manifest = Join-Path $folder "package.json"
      if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { continue }
      $package = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json -AsHashtable
      if ("$($package.name)" -ne $wanted.package -or "$($package.version)" -ne $pin) { $seen += "$folder holds $($package.name) $($package.version)"; continue }
      if ("$($package.license)" -ne $wanted.license) { throw "$($wanted.package) $pin in $folder declares the licence '$($package.license)', not $($wanted.license)" }
      $source = Join-Path $folder $wanted.text
      if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "$($wanted.package) $pin in $folder has no $($wanted.text)" }
      $text = [System.IO.File]::ReadAllText($source)
      foreach ($part in @($wanted.holder, $mitGrant, $mitDisclaimer)) {
        if (-not $text.Contains($part)) { throw "$source is not the full $($wanted.license) notice of $($wanted.package): it lacks '$part'" }
      }
      $found[$name] = [ordered]@{ package = $wanted.package; version = $pin; license = $wanted.license; source = (Resolve-Path -LiteralPath $source).Path }
      break
    }
    if (-not $found.Contains($name)) { throw "no $($wanted.package) $pin package to take its $($wanted.text) from ($(if ($seen.Count) { $seen -join '; ' } else { 'none installed' })); run bun install, or restore the JavaScript the javascript job hands over" }
  }
  return $found
}
