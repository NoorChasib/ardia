param(
  [Parameter(Mandatory = $true, ParameterSetName = "Start")][switch]$Start,
  [Parameter(Mandatory = $true, ParameterSetName = "Stop")][switch]$Stop,
  [Parameter(Mandatory = $true, ParameterSetName = "Serve")][switch]$Serve,
  [Parameter(Mandatory = $true)][string]$Out,
  [Parameter(Mandatory = $true)][string]$State,
  [Parameter(ParameterSetName = "Start")][string[]]$Program = @(),
  [Parameter(ParameterSetName = "Start")][string[]]$ProgramFile = @(),
  [Parameter(ParameterSetName = "Start")][string]$Installed = "",
  [Parameter(ParameterSetName = "Start")][string]$Probe = "",
  [Parameter(ParameterSetName = "Start")][string]$ProbeUrl = "https://github.com/robots.txt"
)

$ErrorActionPreference = "Stop"
if (-not ([System.Management.Automation.PSTypeName]"NillaWatch.Proxy").Type) {
  Add-Type -Path (Join-Path $PSScriptRoot "upstream-watch.cs") -IgnoreWarnings
}
. (Join-Path $PSScriptRoot "upstream-verdict.ps1")

$ruleGroup = "Nilla no-upstream watch"
$auditCategory = "{0CCE9226-69AE-11D9-BED3-505054503030}"
$dnsLog = "Microsoft-Windows-DNS-Client/Operational"
$firewallLog = if ($env:SystemRoot) { Join-Path $env:SystemRoot "System32\LogFiles\Firewall\nilla-watch.log" } else { "" }
$nonLoopback = @("0.0.0.0-126.255.255.255", "128.0.0.0-255.255.255.255", "::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff")
$bypassList = "<local>;127.0.0.1;localhost;[::1]"
$extraNames = @("nilla-setup*", "unins*.exe", "_iu*.tmp")
$neverBlocked = @("pwsh.exe", "powershell.exe", "node.exe", "git.exe", "cmd.exe", "conhost.exe", "bash.exe", "svchost.exe", "runner.worker.exe", "runner.listener.exe")
$stateFile = Join-Path $State "watch.json"
$enforceFile = Join-Path $State "enforce.json"
$portFile = Join-Path $State "proxy.port"
$authorityFile = Join-Path $State "authority.cer"
$proxyLog = Join-Path $Out "proxy.jsonl"

New-Item -ItemType Directory -Force -Path $Out, $State | Out-Null

if ($Serve) {
  $authority = [NillaWatch.Authority]::Create()
  [System.IO.File]::WriteAllBytes($authorityFile, $authority.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
  $proxy = [NillaWatch.Proxy]::new($proxyLog, $authority)
  $proxy.Start()
  $proxy.RunInBackground()
  $enforce = Get-Content -LiteralPath $enforceFile -Raw | ConvertFrom-Json
  $blocked = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($path in @($enforce.blocked)) { if ($path) { $null = $blocked.Add("$path") } }
  $seen = [System.Collections.Generic.HashSet[string]]::new()
  $late = 0
  Set-Content -LiteralPath "$portFile.partial" -Value $proxy.Port -Encoding ascii
  Move-Item -LiteralPath "$portFile.partial" -Destination $portFile -Force
  while ($true) {
    foreach ($process in [System.Diagnostics.Process]::GetProcesses()) {
      $started = $null
      try { $started = $process.StartTime } catch { }
      if (-not $seen.Add("$($process.Id) $(if ($started) { $started.Ticks })")) { continue }
      $path = [NillaWatch.Processes]::ImagePath($process.Id)
      if (-not $path -or $blocked.Contains($path)) { continue }
      $leaf = [System.IO.Path]::GetFileName($path).ToLowerInvariant()
      if (@($enforce.never) -contains $leaf) { continue }
      $named = $false
      foreach ($name in @($enforce.names)) { if ($leaf -like $name) { $named = $true; break } }
      if (-not $named) { continue }
      $late += 1
      $null = $blocked.Add($path)
      $entry = [System.Collections.Generic.Dictionary[string, object]]::new()
      $entry["event"] = "enforced"
      $entry["path"] = $path
      $entry["pid"] = $process.Id
      $entry["lag_ms"] = if ($started) { [int]((Get-Date) - $started).TotalMilliseconds } else { -1 }
      try {
        New-NetFirewallRule -DisplayName "$ruleGroup late $late" -Group $ruleGroup -Direction Outbound -Action Block -Program $path -RemoteAddress $nonLoopback -Profile Any | Out-Null
        $entry["action"] = "blocked from all but loopback"
      } catch {
        $entry["action"] = "the block rule failed: $($_.Exception.Message)"
      }
      $proxy.Record($entry)
    }
    Start-Sleep -Milliseconds 200
  }
}

function Save-Watch($Watch) {
  $Watch | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $stateFile -Encoding utf8NoBOM
}

function Get-WatchedPrograms {
  $paths = [System.Collections.Generic.List[string]]::new()
  $relative = [System.Collections.Generic.List[string]]::new()
  foreach ($folder in $Program) {
    if (-not (Test-Path -LiteralPath $folder -PathType Container)) {
      Write-Host "watch: $folder isn't there; its programs aren't blocked"
      continue
    }
    $root = (Resolve-Path -LiteralPath $folder).Path.TrimEnd('\') + '\'
    foreach ($exe in (Get-ChildItem -LiteralPath $root -Recurse -File -Filter *.exe)) {
      $paths.Add($exe.FullName)
      $relative.Add($exe.FullName.Substring($root.Length))
    }
  }
  if ($Installed) {
    foreach ($name in $relative) { $paths.Add((Join-Path $Installed $name)) }
    $paths.Add((Join-Path $Installed "unins000.exe"))
  }
  foreach ($file in $ProgramFile) { if ($file) { $paths.Add([System.IO.Path]::GetFullPath($file)) } }
  return @($paths | Sort-Object -Unique)
}

function Stop-Network($Watch) {
  $problems = @()
  if ($Watch.systemProxy) {
    try { [NillaWatch.SystemProxy]::Clear() } catch { $problems += "the system proxy setting was not cleared: $_" }
  }
  if ($Watch.proxyPid) {
    $server = Get-Process -Id $Watch.proxyPid -ErrorAction SilentlyContinue
    if ($server) {
      Stop-Process -Id $Watch.proxyPid -Force -ErrorAction SilentlyContinue
      if (-not $server.WaitForExit(15000)) { $problems += "the proxy process $($Watch.proxyPid) did not stop" }
    }
  }
  if ($Watch.authority) {
    try {
      $store = [System.Security.Cryptography.X509Certificates.X509Store]::new("Root", "LocalMachine")
      $store.Open("ReadWrite")
      foreach ($certificate in @($store.Certificates | Where-Object { $_.Thumbprint -eq $Watch.authority })) { $store.Remove($certificate) }
      $store.Close()
    } catch { $problems += "the watch's certificate authority was not removed: $_" }
  }
  return $problems
}

function Stop-Logging($Watch) {
  $problems = @()
  if ($Watch.rules) {
    try { Remove-NetFirewallRule -Group $ruleGroup -ErrorAction SilentlyContinue } catch { $problems += "the block rules were not removed: $_" }
  }
  foreach ($saved in @($Watch.profiles)) {
    if (-not $saved) { continue }
    $restore = @{ Name = $saved.Name; Enabled = $saved.Enabled; LogAllowed = $saved.LogAllowed; LogBlocked = $saved.LogBlocked; NotifyOnListen = $saved.NotifyOnListen }
    if ($saved.LogFileName -and $saved.LogFileName -ne "NotConfigured") { $restore.LogFileName = $saved.LogFileName }
    $size = [uint64]0
    if ([uint64]::TryParse("$($saved.LogMaxSizeKilobytes)", [ref]$size) -and $size -gt 0) { $restore.LogMaxSizeKilobytes = $size }
    try { Set-NetFirewallProfile @restore } catch { $problems += "the $($saved.Name) firewall profile was not restored: $_" }
  }
  if ($null -ne $Watch.audit) {
    $success = if ("$($Watch.audit)" -match "Success") { "enable" } else { "disable" }
    $failure = if ("$($Watch.audit)" -match "Failure") { "enable" } else { "disable" }
    auditpol /set /subcategory:$auditCategory /success:$success /failure:$failure | Out-Null
    if ($LASTEXITCODE -ne 0) { $problems += "the connection audit policy was not restored" }
  }
  if ($Watch.dnsEnabled -eq $false) { wevtutil sl $dnsLog /e:false | Out-Null }
  return $problems
}

function Invoke-Probe([string]$Engine, [string]$Url) {
  if (-not (Test-Path -LiteralPath $Engine -PathType Leaf)) { return "the engine $Engine isn't there" }
  . (Join-Path $PSScriptRoot "process-tree.ps1")
  $target = [uri]$Url
  $probeProfile = Join-Path $State ("probe-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $probeProfile | Out-Null
  $rowsBefore = if (Test-Path -LiteralPath $proxyLog) { @(Get-Content -LiteralPath $proxyLog).Count } else { 0 }
  $arguments = @("--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", "--user-data-dir=`"$probeProfile`"", "--dump-dom", $Url)
  $saved = @{}
  foreach ($name in "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY") { $saved[$name] = [Environment]::GetEnvironmentVariable($name); [Environment]::SetEnvironmentVariable($name, $null) }
  try {
    $run = Start-Process -FilePath $Engine -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $Out "probe-dom.txt") -RedirectStandardError (Join-Path $Out "probe-stderr.txt")
    $null = $run.Handle
    if (-not $run.WaitForExit(90000)) {
      $running = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CreationDate)
      foreach ($id in (Get-StopOrder $run.Id $running)) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
    }
  } finally {
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name]) }
  }
  $deadline = (Get-Date).AddSeconds(15)
  $rows = @()
  do {
    $rows = @(if (Test-Path -LiteralPath $proxyLog) { Get-Content -LiteralPath $proxyLog | Select-Object -Skip $rowsBefore | Where-Object { $_ } | ForEach-Object { try { $_ | ConvertFrom-Json } catch { $null } } | Where-Object { $_ -and "$($_.host)" -ieq $target.Host } })
    $seen = @($rows | Where-Object { $_.event -eq "request" -and "$($_.path)" -eq $target.PathAndQuery }) | Select-Object -First 1
    if ($seen) { break }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  Remove-Item -LiteralPath $probeProfile -Recurse -Force -ErrorAction SilentlyContinue
  if ($seen) { return "path seen: $($seen.method) $($target.Host)$($seen.path), $($seen.action)" }
  $tls = @($rows | Where-Object { $_.event -eq "tls-failed-client" }) | Select-Object -First 1
  if ($tls) { return "Chromium refused the watch's certificate authority for $($target.Host) ($($tls.error)), so GitHub paths can't be read" }
  if ($rows.Count) { return "Chromium reached $($target.Host) through the watch, but no request for $($target.PathAndQuery) was logged" }
  return "Chromium never reached $($target.Host) through the watch (exit $(if ($run.HasExited) { $run.ExitCode } else { 'none, stopped' })), so the system proxy isn't in effect for it"
}

function Get-EventData($Record) {
  $data = @{}
  foreach ($item in ([xml]$Record.ToXml()).Event.EventData.Data) { $data[$item.Name] = $item.'#text' }
  return $data
}

function Get-Events([hashtable]$Filter, [string]$XPath, [string]$LogName) {
  try {
    if ($XPath) { return @(Get-WinEvent -LogName $LogName -FilterXPath $XPath -ErrorAction Stop) }
    return @(Get-WinEvent -FilterHashtable $Filter -ErrorAction Stop)
  } catch {
    if ("$($_.FullyQualifiedErrorId)" -like "NoMatchingEventsFound*") { return @() }
    throw
  }
}

function Test-WatchedName([string]$Leaf, [string[]]$Names) {
  foreach ($name in $Names) { if ($Leaf -like $name) { return $true } }
  return $false
}

function Get-Addresses([string]$Results) {
  $found = @()
  foreach ($token in ("$Results" -split "[;\s]+")) {
    $address = $null
    if ([System.Net.IPAddress]::TryParse($token, [ref]$address)) {
      if ($address.IsIPv4MappedToIPv6) { $address = $address.MapToIPv4() }
      $found += $address.ToString()
    }
  }
  return $found
}

if ($Start) {
  if (Test-Path -LiteralPath $stateFile) { throw "a watch already runs with its state in $State" }
  Remove-Item -LiteralPath $portFile, $authorityFile, $proxyLog -Force -ErrorAction SilentlyContinue
  $watch = [ordered]@{
    started = (Get-Date).ToUniversalTime().ToString("o")
    programs = @()
    names = @()
    profiles = @()
    rules = $false
    audit = $null
    dnsEnabled = $null
    proxyPid = $null
    port = $null
    authority = $null
    systemProxy = $false
    systemProxyCheck = ""
    probe = ""
    startProblems = @()
  }
  Save-Watch $watch
  try {
    $watch.programs = @(Get-WatchedPrograms)
    $watch.names = @(@($watch.programs | ForEach-Object { (Split-Path -Leaf $_).ToLowerInvariant() }) + $extraNames | Where-Object { $neverBlocked -notcontains $_ } | Sort-Object -Unique)
    [ordered]@{ names = @($watch.names); never = $neverBlocked; blocked = @($watch.programs) } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $enforceFile -Encoding utf8NoBOM
    $watch.profiles = @(Get-NetFirewallProfile | ForEach-Object {
        [ordered]@{ Name = "$($_.Name)"; Enabled = "$($_.Enabled)"; LogAllowed = "$($_.LogAllowed)"; LogBlocked = "$($_.LogBlocked)"; LogFileName = "$($_.LogFileName)"; LogMaxSizeKilobytes = "$($_.LogMaxSizeKilobytes)"; NotifyOnListen = "$($_.NotifyOnListen)" }
      })
    Save-Watch $watch
    Set-NetFirewallProfile -All -Enabled True -NotifyOnListen False -LogAllowed True -LogBlocked True -LogFileName $firewallLog -LogMaxSizeKilobytes 32767
    $watch.rules = $true
    Save-Watch $watch
    $number = 0
    foreach ($path in $watch.programs) {
      $number += 1
      New-NetFirewallRule -DisplayName "$ruleGroup $number" -Group $ruleGroup -Direction Outbound -Action Block -Program $path -RemoteAddress $nonLoopback -Profile Any | Out-Null
    }

    $watch.audit = "$((auditpol /get /subcategory:$auditCategory /r | Where-Object { $_ } | ConvertFrom-Csv | Select-Object -First 1).'Inclusion Setting')"
    Save-Watch $watch
    auditpol /set /subcategory:$auditCategory /success:enable /failure:enable | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "auditpol could not turn on the connection audit" }
    wevtutil sl Security /ms:536870912 | Out-Null

    $watch.dnsEnabled = [bool]((wevtutil gl $dnsLog) -match "^enabled:\s*true")
    Save-Watch $watch
    wevtutil sl $dnsLog /e:true /ms:134217728 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "wevtutil could not turn on $dnsLog" }

    $shell = (Get-Process -Id $PID).Path
    $server = Start-Process -FilePath $shell -ArgumentList "-NoProfile", "-NonInteractive", "-File", "`"$PSCommandPath`"", "-Serve", "-Out", "`"$Out`"", "-State", "`"$State`"" -WindowStyle Hidden -PassThru
    $watch.proxyPid = $server.Id
    Save-Watch $watch
    $deadline = (Get-Date).AddSeconds(60)
    while (-not (Test-Path -LiteralPath $portFile)) {
      if ($server.HasExited) { throw "the proxy exited with code $($server.ExitCode) before it listened" }
      if ((Get-Date) -gt $deadline) { throw "the proxy did not listen within 60 s" }
      Start-Sleep -Milliseconds 250
    }
    $watch.port = [int](Get-Content -LiteralPath $portFile -Raw).Trim()
    $authority = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($authorityFile)
    $store = [System.Security.Cryptography.X509Certificates.X509Store]::new("Root", "LocalMachine")
    $store.Open("ReadWrite")
    $store.Add($authority)
    $store.Close()
    $watch.authority = $authority.Thumbprint
    Save-Watch $watch

    [NillaWatch.SystemProxy]::Use("127.0.0.1:$($watch.port)", $bypassList)
    $watch.systemProxy = $true
    $probe = & $shell -NoProfile -NonInteractive -Command "foreach (`$name in 'HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY') { Remove-Item -LiteralPath env:`$name -ErrorAction SilentlyContinue }; [System.Net.WebRequest]::GetSystemWebProxy().GetProxy([uri]'https://example.org/').AbsoluteUri"
    $watch.systemProxyCheck = "$probe".Trim()
    Save-Watch $watch
    if ($watch.systemProxyCheck -ne "http://127.0.0.1:$($watch.port)/") {
      $watch.startProblems += "the system proxy reads back as '$($watch.systemProxyCheck)', not http://127.0.0.1:$($watch.port)/, so launches without --proxy-server may go around the watch's path log"
      Save-Watch $watch
    }

    if ($Probe) {
      $watch.probe = try { Invoke-Probe $Probe $ProbeUrl } catch { "could not run: $($_.Exception.Message)" }
      if ($watch.probe -notlike "path seen*") { $watch.startProblems += "Chromium probe: $($watch.probe)" }
    } else {
      $watch.probe = "not run: no engine on this runner, so path-level GitHub evidence from Chromium is unverified"
    }
    Save-Watch $watch
    foreach ($problem in $watch.startProblems) { Write-Host "::error::no-upstream watch: $problem" }

    & (Join-Path $PSScriptRoot "upstream-traces.ps1") -Out (Join-Path $Out "traces-at-start.json") -Label "when the watch started"
  } catch {
    Write-Host "::error::the no-upstream watch did not start: $_"
    $undo = @(Stop-Network $watch) + @(Stop-Logging $watch)
    $undo | ForEach-Object { Write-Host "::warning::$_" }
    Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue
    exit 1
  }
  if ($env:GITHUB_OUTPUT) { "proxy=http://127.0.0.1:$($watch.port)" | Add-Content -LiteralPath $env:GITHUB_OUTPUT }
  Write-Host "watch: proxy on 127.0.0.1:$($watch.port); $($watch.programs.Count) programs blocked from everything but loopback; firewall logging, the connection audit and the DNS client log are on"
  exit 0
}

if (-not (Test-Path -LiteralPath $stateFile)) {
  Write-Host "::error::no watch state in $State; the no-upstream check is unverified"
  exit 1
}
$watch = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
$problems = @()
$proxyAlive = $watch.proxyPid -and (Get-Process -Id $watch.proxyPid -ErrorAction SilentlyContinue)
if ($watch.proxyPid -and -not $proxyAlive) { $problems += "the proxy stopped during the run, so later requests went unlogged" }
$problems += @(Stop-Network $watch)
$stopped = Get-Date

$firewallCopy = Join-Path $Out "firewall.log"
$firewallCounts = @{ ALLOW = 0; DROP = 0 }
if ($firewallLog -and (Test-Path -LiteralPath $firewallLog)) {
  $reader = [System.IO.FileStream]::new($firewallLog, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
  $writer = [System.IO.File]::Create($firewallCopy)
  try { $reader.CopyTo($writer) } finally { $writer.Dispose(); $reader.Dispose() }
  foreach ($line in [System.IO.File]::ReadLines($firewallCopy)) {
    $fields = $line -split " "
    if ($fields.Count -gt 2 -and $firewallCounts.ContainsKey($fields[2])) { $firewallCounts[$fields[2]] += 1 }
  }
} else {
  $problems += "the firewall wrote no log at $firewallLog"
}

$startedUtc = if ($watch.started -is [datetime]) { $watch.started.ToUniversalTime() } else { [datetime]::Parse("$($watch.started)", [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime() }
$since = $startedUtc.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$names = @($watch.names)

$dnsRows = [System.Collections.Generic.List[object]]::new()
$namesByAddress = @{}
try {
  foreach ($record in (Get-Events -Filter @{ LogName = $dnsLog; Id = 3006, 3008, 3020; StartTime = $startedUtc.ToLocalTime() })) {
    $data = Get-EventData $record
    $name = "$($data['QueryName'])".Trim()
    if (-not $name) { continue }
    $addresses = @(Get-Addresses "$($data['QueryResults'])$($data['Result'])")
    foreach ($address in $addresses) {
      if (-not $namesByAddress.ContainsKey($address)) { $namesByAddress[$address] = [System.Collections.Generic.HashSet[string]]::new() }
      $null = $namesByAddress[$address].Add($name.ToLowerInvariant())
    }
    $dnsRows.Add([ordered]@{ ts = $record.TimeCreated.ToUniversalTime().ToString("o"); id = $record.Id; pid = $record.ProcessId; name = $name; addresses = $addresses })
  }
} catch { $problems += "the DNS client log could not be read: $_" }

$connections = [System.Collections.Generic.List[object]]::new()
try {
  $outbound = "*[System[(EventID=5156 or EventID=5157) and TimeCreated[@SystemTime>='$since']]] and *[EventData[Data[@Name='Direction']='%%14593']]"
  $remote = "*[System[(EventID=5156 or EventID=5157) and TimeCreated[@SystemTime>='$since']]] and *[EventData[Data[@Name='Direction']='%%14593' and Data[@Name='DestAddress']!='127.0.0.1' and Data[@Name='DestAddress']!='::1']]"
  try { $records = Get-Events -XPath $remote -LogName Security } catch { $records = Get-Events -XPath $outbound -LogName Security }
  foreach ($record in $records) {
    $data = Get-EventData $record
    if (@("127.0.0.1", "::1") -contains "$($data['DestAddress'])") { continue }
    $application = "$($data['Application'])"
    $leaf = ($application -split "\\")[-1].ToLowerInvariant()
    if (-not (Test-WatchedName $leaf $names)) { continue }
    $address = "$($data['DestAddress'])"
    $known = if ($namesByAddress.ContainsKey($address)) { @($namesByAddress[$address]) } else { @() }
    $connections.Add([ordered]@{ ts = $record.TimeCreated.ToUniversalTime().ToString("o"); outcome = $(if ($record.Id -eq 5157) { "blocked" } else { "allowed" }); application = $application; pid = $data['ProcessID']; address = $address; port = $data['DestPort']; protocol = $data['Protocol']; names = $known })
  }
} catch { $problems += "the connection audit could not be read: $_" }

$problems += @(Stop-Logging $watch)

$proxyRows = @()
if (Test-Path -LiteralPath $proxyLog) {
  $proxyRows = @(Get-Content -LiteralPath $proxyLog | Where-Object { $_ } | ForEach-Object { try { $_ | ConvertFrom-Json } catch { $null } } | Where-Object { $_ })
} else {
  $problems += "the proxy wrote no log"
}

$judged = Get-ProxyVerdict $proxyRows -ChromiumTrustsTheWatch:("$($watch.probe)" -like "path seen*")
$upstream = $judged.upstream
$allowed = $judged.allowed
$github = $judged.unclassified
$others = $judged.others
$requests = $judged.requests
$requestHosts = $judged.requestHosts
$enforced = @($proxyRows | Where-Object { $_.event -eq "enforced" })
foreach ($row in $enforced) { if ("$($row.action)" -notlike "blocked*") { $problems += "a watched program at $($row.path) could not be blocked: $($row.action)" } }
foreach ($row in $dnsRows) {
  $verdict = [NillaWatch.Rules]::ClassifyHost($row.name)
  if ($verdict[0] -eq "upstream") { $upstream.Add([ordered]@{ source = "dns (event $($row.id), process $($row.pid))"; what = $row.name; why = $verdict[1]; action = "looked up" }) }
}
foreach ($row in $connections) {
  $verdicts = @($row.names | ForEach-Object { [NillaWatch.Rules]::ClassifyHost($_)[0] })
  $entry = [ordered]@{ source = "connection audit"; what = "$($row.outcome) $($row.application) -> $($row.address):$($row.port) ($(if ($row.names.Count) { $row.names -join ', ' } else { 'no DNS name seen' }))"; why = "bypassed the proxy"; action = $row.outcome }
  if ($verdicts -contains "upstream") { $upstream.Add($entry) } elseif ($verdicts -contains "github-unknown-path") { $github.Add($entry) } elseif ($row.outcome -eq "allowed" -and -not (Test-LinkOnly $row.address)) { $problems += "a watched program reached $($row.address):$($row.port) around the proxy and was not blocked ($(Split-Path -Leaf $row.application), $(if ($row.names.Count) { $row.names -join ', ' } else { 'no DNS name seen' }))" }
}
foreach ($entry in $github) { $problems += "a GitHub contact could not be classified: $($entry.source) $($entry.what) ($($entry.why))" }
$problems = @(@($watch.startProblems | Where-Object { $_ }) + $problems)
$unverifiedRows = @(
  "the hourly telemetry watch and the 6-hour update repeat: longer than the job, so they never fire on Windows CI (the shared JS timers are covered by the Linux run's virtual clock)",
  "the nilla-browser command: not shipped on Windows (PLATFORM_FEATURES.nillaCommand is false), so there is nothing to exercise"
)

$dnsRows | ForEach-Object { $_ | ConvertTo-Json -Compress -Depth 4 } | Set-Content -LiteralPath (Join-Path $Out "dns-lookups.jsonl") -Encoding utf8NoBOM
$connections | ForEach-Object { $_ | ConvertTo-Json -Compress -Depth 4 } | Set-Content -LiteralPath (Join-Path $Out "app-connections.jsonl") -Encoding utf8NoBOM

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add("# No-upstream check, Windows")
$lines.Add("")
$lines.Add("- watched from $($startedUtc.ToString('o')) to $($stopped.ToUniversalTime().ToString('o'))")
$lines.Add("- upstream attempts: **$($upstream.Count)**")
$lines.Add("- proxy: $requests requests to $($requestHosts.Count) hosts, $($judged.connects) CONNECTs, $($judged.nothingSent.Count) GitHub connections that sent no request; the system proxy read back as '$($watch.systemProxyCheck)'")
$lines.Add("- Chromium probe: $($watch.probe)")
$lines.Add("- programs blocked after they started (copies, setup and uninstall): $($enforced.Count)$(if ($enforced.Count) { ' (' + (@($enforced | ForEach-Object { "$(Split-Path -Leaf $_.path) after $($_.lag_ms) ms" }) -join ', ') + ')' })")
$lines.Add("- programs blocked from all but loopback: $(@($watch.programs).Count); attributed by name: $($names -join ', ')")
$lines.Add("- connections from those programs that didn't go through the proxy: $($connections.Count) ($(@($connections | Where-Object { $_.outcome -eq 'blocked' }).Count) blocked)")
$lines.Add("- DNS client lookups on the runner: $($dnsRows.Count)")
$lines.Add("- Windows Firewall log: $($firewallCounts['ALLOW']) allowed and $($firewallCounts['DROP']) dropped connections (firewall.log)")
$lines.Add("- GitHub contacts that could not be classified: $($github.Count)")
$lines.Add("- allowed exceptions: $($allowed.Count)")
if ($problems.Count) { $lines.Add("- watch problems: $($problems -join '; ')") }
foreach ($row in $unverifiedRows) { $lines.Add("- unverified on Windows: $row") }
$lines.Add("")
if ($upstream.Count) {
  $lines.Add("## Upstream attempts")
  $lines.Add("")
  $lines.Add("| source | request | why | action |")
  $lines.Add("| --- | --- | --- | --- |")
  foreach ($entry in $upstream) { $lines.Add("| $($entry.source) | ``$($entry.what)`` | $($entry.why) | $($entry.action) |") }
  $lines.Add("")
}
if ($github.Count) {
  $lines.Add("## GitHub contacts that could not be classified")
  $lines.Add("")
  foreach ($entry in $github) { $lines.Add("- $($entry.source) ``$($entry.what)`` ($($entry.why))") }
  $lines.Add("")
}
if ($connections.Count) {
  $lines.Add("## Connections that bypassed the proxy")
  $lines.Add("")
  foreach ($group in ($connections | Group-Object { "$($_.outcome) $(Split-Path -Leaf $_.application) -> $($_.address):$($_.port) $($_.names -join ',')" } | Sort-Object Count -Descending)) { $lines.Add("- ``$($group.Name)`` x$($group.Count)") }
  $lines.Add("")
}
if ($others.Count) {
  $lines.Add("## Other destinations through the proxy")
  $lines.Add("")
  foreach ($destination in ($others.Keys | Sort-Object)) { $lines.Add("- $destination x$($others[$destination])") }
  $lines.Add("")
}
$lines | Set-Content -LiteralPath (Join-Path $Out "no-upstream.md") -Encoding utf8NoBOM
[ordered]@{ upstream = @($upstream); github = @($github); allowed = @($allowed); nothingSent = @($judged.nothingSent); enforced = @($enforced); bypassed = $connections.Count; probe = $watch.probe; problems = @($problems); unverified = $unverifiedRows } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $Out "no-upstream.json") -Encoding utf8NoBOM
$lines | ForEach-Object { Write-Host $_ }
if ($env:GITHUB_STEP_SUMMARY) {
  $verdict = if ($upstream.Count) { "**failed**: $($upstream.Count) upstream attempts" } elseif ($problems.Count) { "**unverified**: $($problems -join '; ')" } else { "**passed** for what ran: no upstream attempt" }
  @("### No-upstream watch", "- $verdict", "- proxy requests $requests, connections around the proxy $($connections.Count), GitHub contacts not classified $($github.Count), programs blocked late $($enforced.Count), firewall log $($firewallCounts['ALLOW']) allowed / $($firewallCounts['DROP']) dropped", "- Chromium probe: $($watch.probe)") + @($unverifiedRows | ForEach-Object { "- unverified on Windows: $_" }) | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY
}
Remove-Item -LiteralPath $stateFile, $portFile, $authorityFile, $enforceFile -Force -ErrorAction SilentlyContinue

foreach ($entry in $upstream) { Write-Host "::error::upstream attempt: $($entry.source) $($entry.what) ($($entry.why))" }
foreach ($problem in $problems) { Write-Host "::error::no-upstream watch: $problem" }
if ($upstream.Count -or $problems.Count) { exit 1 }
exit 0
