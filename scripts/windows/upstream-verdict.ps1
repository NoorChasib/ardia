function Test-LinkOnly([string]$Text) {
  $address = $null
  if (-not [System.Net.IPAddress]::TryParse($Text, [ref]$address)) { return $false }
  if ($address.IsIPv4MappedToIPv6) { $address = $address.MapToIPv4() }
  if ($address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetworkV6) { return $address.IsIPv6Multicast -or $address.IsIPv6LinkLocal }
  $first = $address.GetAddressBytes()
  return ($first[0] -ge 224) -or ($first[0] -eq 169 -and $first[1] -eq 254)
}

function Get-ProxyVerdict([object[]]$Rows, [switch]$ChromiumTrustsTheWatch) {
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
        if (@($group | Where-Object { $_.event -eq "no-request" }).Count -and $ChromiumTrustsTheWatch) {
          $verdict.nothingSent.Add([ordered]@{ source = "proxy ($key)"; what = $what; why = "the client finished TLS with the watch and sent no request (a preconnect; the probe showed Chromium trusts the watch)" })
        } elseif (@($group | Where-Object { $_.event -eq "no-request" }).Count) {
          $verdict.unclassified.Add([ordered]@{ source = "proxy ($key)"; what = $what; why = "the client closed TLS without a request, and no probe showed Chromium trusts the watch, so a refused certificate can't be ruled out" })
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
