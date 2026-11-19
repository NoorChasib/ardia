function Test-LinkOnly([string]$Text) {
  $address = $null
  if (-not [System.Net.IPAddress]::TryParse($Text, [ref]$address)) { return $false }
  if ($address.IsIPv4MappedToIPv6) { $address = $address.MapToIPv4() }
  if ($address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetworkV6) { return $address.IsIPv6Multicast -or $address.IsIPv6LinkLocal }
  $first = $address.GetAddressBytes()
  return ($first[0] -ge 224) -or ($first[0] -eq 169 -and $first[1] -eq 254)
}

$networkService = "network.mojom.NetworkService"

function Get-NormalAddress([string]$Text) {
  $address = $null
  if (-not [System.Net.IPAddress]::TryParse("$Text".Trim(), [ref]$address)) { return "" }
  if ($address.IsIPv4MappedToIPv6) { $address = $address.MapToIPv4() }
  return $address.ToString()
}

function Get-ClientName($Row) {
  if (-not $Row -or -not "$($Row.client)") { return "a client the watch could not attribute$(if ("$($Row.client_error)") { " ($($Row.client_error))" })" }
  $leaf = ("$($Row.client)" -split "[\\/]")[-1]
  $role = if ("$($Row.client_service)") { "$($Row.client_type) $($Row.client_service)" } elseif ("$($Row.client_type)") { "$($Row.client_type)" } else { "no --type" }
  return "$leaf ($role, process $($Row.client_pid))"
}

function Test-ChromiumClient($Row, [string[]]$Engines) {
  if (-not $Row -or -not "$($Row.client)") { return $false }
  if ("$($Row.client_type)" -ne "utility" -or "$($Row.client_service)" -ne $networkService) { return $false }
  foreach ($engine in @($Engines)) {
    if ($engine -and [string]::Equals("$($Row.client)", "$engine", [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
}

function Get-NamesByAddress([object[]]$DnsRows, [object[]]$ProxyRows) {
  $names = @{}
  $add = {
    param([string]$Address, [string]$Name)
    $normal = Get-NormalAddress $Address
    $label = "$Name".Trim().TrimEnd(".").ToLowerInvariant()
    if (-not $normal -or -not $label) { return }
    if (-not $names.ContainsKey($normal)) { $names[$normal] = [System.Collections.Generic.HashSet[string]]::new() }
    $null = $names[$normal].Add($label)
  }
  foreach ($row in @($DnsRows)) { if ($row) { foreach ($address in @($row.addresses)) { & $add "$address" "$($row.name)" } } }
  foreach ($row in @($ProxyRows)) { if ($row -and "$($row.origin_address)") { & $add "$($row.origin_address)" "$($row.host)" } }
  return $names
}

function ConvertTo-ConnectionRow($Record, [string[]]$Watched, [hashtable]$NamesByAddress) {
  $data = $Record.Data
  if ("$($data['Direction'])" -ne "%%14593") { return $null }
  $address = Get-NormalAddress "$($data['DestAddress'])"
  if (-not $address) { $address = "$($data['DestAddress'])" }
  if (@("127.0.0.1", "::1") -contains $address) { return $null }
  $application = "$($data['Application'])"
  $leaf = ($application -split "\\")[-1].ToLowerInvariant()
  $named = $false
  foreach ($name in @($Watched)) { if ($leaf -like $name) { $named = $true; break } }
  if (-not $named) { return $null }
  $known = if ($NamesByAddress -and $NamesByAddress.ContainsKey($address)) { @($NamesByAddress[$address] | Sort-Object) } else { @() }
  $time = if ($Record.TimeCreated -is [datetime]) { $Record.TimeCreated.ToUniversalTime().ToString("o") } else { "$($Record.TimeCreated)" }
  return [ordered]@{ ts = $time; outcome = $(if ("$($Record.Id)" -eq "5157") { "blocked" } else { "allowed" }); application = $application; pid = $data['ProcessID']; address = $address; port = $data['DestPort']; protocol = $data['Protocol']; names = $known }
}

function Get-ConnectionVerdict([object[]]$Connections) {
  $verdict = [ordered]@{
    upstream = [System.Collections.Generic.List[object]]::new()
    unclassified = [System.Collections.Generic.List[object]]::new()
    unverified = [System.Collections.Generic.List[string]]::new()
  }
  foreach ($row in @($Connections)) {
    if (-not $row) { continue }
    $names = @($row.names | Where-Object { $_ })
    $seen = if ($names.Count) { $names -join ", " } else { "no DNS name or proxy row seen" }
    $program = ("$($row.application)" -split "\\")[-1]
    $entry = [ordered]@{ source = "connection audit"; what = "$($row.outcome) $($row.application) -> $($row.address):$($row.port) ($seen)"; why = "bypassed the proxy"; action = $row.outcome }
    $kinds = @($names | ForEach-Object { [NillaWatch.Rules]::ClassifyHost($_)[0] })
    if ($kinds -contains "upstream") { $verdict.upstream.Add($entry); continue }
    if ($kinds -contains "github-unknown-path") { $verdict.unclassified.Add($entry); continue }
    if (Test-LinkOnly "$($row.address)") { continue }
    if (-not $names.Count) {
      $verdict.unverified.Add("a watched program went around the proxy to $($row.address):$($row.port) ($program, $($row.outcome)) and no DNS lookup or proxy row names that address, so whether it was an upstream destination is unverified")
      continue
    }
    if ($row.outcome -eq "allowed") { $verdict.unverified.Add("a watched program reached $($row.address):$($row.port) around the proxy and was not blocked ($program, $seen)") }
  }
  return $verdict
}

function Get-ProxyVerdict([object[]]$Rows, [string[]]$TrustedEngines = @()) {
  $verdict = [ordered]@{
    upstream = [System.Collections.Generic.List[object]]::new()
    allowed = [System.Collections.Generic.List[object]]::new()
    unclassified = [System.Collections.Generic.List[object]]::new()
    nothingSent = [System.Collections.Generic.List[object]]::new()
    others = @{}
    requests = 0
    requestHosts = @{}
    connects = 0
  }
  $groups = [ordered]@{}
  $loose = 0
  foreach ($row in @($Rows)) {
    if (-not $row) { continue }
    $key = if ($null -ne $row.conn -and "$($row.conn)" -ne "") { "conn $($row.conn)" } else { $loose += 1; "row $loose" }
    if (-not $groups.Contains($key)) { $groups[$key] = [System.Collections.Generic.List[object]]::new() }
    $groups[$key].Add($row)
  }
  foreach ($key in $groups.Keys) {
    $group = @($groups[$key])
    $requests = @($group | Where-Object { $_.event -eq "request" })
    foreach ($row in $requests) {
      $verdict.requests += 1
      $verdict.requestHosts["$($row.host)".ToLowerInvariant()] = $true
      $judged = [NillaWatch.Rules]::Classify("$($row.host)", "$($row.path)")
      $entry = [ordered]@{ source = "proxy ($key)"; what = "$($row.method) $($row.scheme)://$($row.host)$($row.path)"; why = $judged[1]; action = "$($row.action)" }
      if ($judged[0] -eq "upstream") { $verdict.upstream.Add($entry) } elseif ($judged[0] -eq "allowed") { $verdict.allowed.Add($entry) } else { $verdict.others["$($row.host)"] = 1 + [int]$verdict.others["$($row.host)"] }
    }
    $opened = @($group | Where-Object { $_.event -in @("connect", "tls-failed-client", "no-request") }) | Select-Object -First 1
    if (-not $opened) { continue }
    if ($opened.event -eq "connect") { $verdict.connects += 1 }
    $judged = [NillaWatch.Rules]::ClassifyHost("$($opened.host)")
    $what = "$($opened.host):$($opened.port)"
    switch ($judged[0]) {
      "upstream" { $verdict.upstream.Add([ordered]@{ source = "proxy $($opened.event) ($key)"; what = $what; why = $judged[1]; action = "$($opened.action)" }) }
      "allowed" { $verdict.allowed.Add([ordered]@{ source = "proxy $($opened.event) ($key)"; what = $what; why = $judged[1]; action = "$($opened.action)" }) }
      "github-unknown-path" {
        if ($requests.Count) { break }
        $tls = @($group | Where-Object { $_.event -eq "tls-failed-client" }) | Select-Object -First 1
        $failed = @($group | Where-Object { $_.event -eq "error" }) | Select-Object -First 1
        $quiet = @($group | Where-Object { $_.event -eq "no-request" }).Count
        if ($quiet -and @($TrustedEngines).Count -and (Test-ChromiumClient $opened $TrustedEngines)) {
          $verdict.nothingSent.Add([ordered]@{ source = "proxy ($key)"; what = $what; why = "$(Get-ClientName $opened) finished TLS with the watch and sent no request (a preconnect; the probe showed this engine trusts the watch)" })
        } elseif ($quiet -and @($TrustedEngines).Count) {
          $verdict.unclassified.Add([ordered]@{ source = "proxy ($key)"; what = $what; why = "$(Get-ClientName $opened) closed TLS without a request; the probe vouches only for the engine's network service, so a refused certificate can't be ruled out" })
        } elseif ($quiet) {
          $verdict.unclassified.Add([ordered]@{ source = "proxy ($key)"; what = $what; why = "$(Get-ClientName $opened) closed TLS without a request, and no probe showed Chromium trusts the watch, so a refused certificate can't be ruled out" })
        } elseif ($tls) {
          $verdict.unclassified.Add([ordered]@{ source = "proxy ($key)"; what = $what; why = "the client refused the watch's certificate, so its path is unknown: $($tls.error)" })
        } elseif ($failed) {
          $verdict.unclassified.Add([ordered]@{ source = "proxy ($key)"; what = $what; why = "the connection failed before a request was read: $($failed.error)" })
        } elseif ($key -like "row *") {
          $verdict.unclassified.Add([ordered]@{ source = "proxy $($opened.event)"; what = $what; why = "a row with no connection id can't be matched to a request" })
        } else {
          $verdict.unclassified.Add([ordered]@{ source = "proxy ($key)"; what = $what; why = "no request was logged on this connection" })
        }
      }
      default { $verdict.others["$($opened.host)"] = 1 + [int]$verdict.others["$($opened.host)"] }
    }
  }
  return $verdict
}
