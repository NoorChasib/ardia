$ErrorActionPreference = "Stop"
if (-not ([System.Management.Automation.PSTypeName]"NillaWatch.Proxy").Type) {
  Add-Type -Path (Join-Path $PSScriptRoot "upstream-watch.cs") -IgnoreWarnings
}
. (Join-Path $PSScriptRoot "upstream-verdict.ps1")

$failures = @()

function Check([string]$Name, [bool]$Passed, [string]$Detail = "") {
  if ($Passed) { Write-Host "pass: $Name" } else { $script:failures += "$Name$(if ($Detail) { ": $Detail" })" }
}

$cases = @(
  @("ardia.dev", $null, "upstream"),
  @("lab.ardia.dev", "/x", "upstream"),
  @("ARDIA.DEV.", $null, "upstream"),
  @("netnyahoo.com", "/", "upstream"),
  @("www.netnyahoo.com", $null, "upstream"),
  @("notardia.dev", $null, "other"),
  @("ardia.dev.example.org", $null, "other"),
  @("github.com", $null, "github-unknown-path"),
  @("github.com", "/ardia-browser/ardia/releases/latest", "upstream"),
  @("github.com", "/NoorChasib/nilla/issues/new?title=x", "other"),
  @("api.github.com", "/repos/mantrakp04/ardia/releases", "upstream"),
  @("api.github.com", "/search/code?q=user%3Amantrakp04%20x", "other"),
  @("raw.githubusercontent.com", "/ardia-browser/ardia/main/README.md", "upstream"),
  @("codeload.github.com", "/MANTRAKP04/ardia/zip/refs/heads/main", "upstream"),
  @("uploads.github.com", "/repos/NoorChasib/nilla/releases/1/assets", "other"),
  @("objects.githubusercontent.com", "/github-production-release-asset-2e65be/1?response-content-disposition=attachment%3B%20filename%3Dardia-browser.zip", "upstream"),
  @("objects.githubusercontent.com", "/github-production-release-asset-2e65be/1?x=ardia-browsers", "other"),
  @("github.com", "/search?q=%61rdia-browser%2Fx", "upstream"),
  @("services.helium.imput.net", "/bangs.json", "allowed"),
  @("example.org", "/", "other"),
  @("", $null, "other"),
  @("gist.github.com", "/ardia-browser/x", "other")
)
foreach ($case in $cases) {
  $verdict = if ($null -eq $case[1]) { [NillaWatch.Rules]::ClassifyHost($case[0])[0] } else { [NillaWatch.Rules]::Classify($case[0], $case[1])[0] }
  Check "classify '$($case[0])' '$($case[1])' as $($case[2])" ($verdict -eq $case[2]) "got $verdict"
}

function Row([string]$Event, [string]$TargetHost, $Conn, [hashtable]$More = @{}) {
  $row = [ordered]@{ event = $Event; host = $TargetHost; port = 443 }
  if ($null -ne $Conn) { $row.conn = $Conn }
  foreach ($key in $More.Keys) { $row[$key] = $More[$key] }
  return [pscustomobject]$row
}

$tlsFailed = @((Row "connect" "github.com" 1 @{ action = "opened to read the path" }), (Row "tls-failed-client" "github.com" 1 @{ error = "AuthenticationException: unknown CA" }))
$judged = Get-ProxyVerdict $tlsFailed
Check "a GitHub connection whose TLS failed is unclassified" ($judged.unclassified.Count -eq 1 -and $judged.upstream.Count -eq 0) ($judged | ConvertTo-Json -Depth 4 -Compress)
$judged = Get-ProxyVerdict ($tlsFailed + @((Row "connect" "github.com" 2 @{ action = "opened to read the path" }), (Row "request" "github.com" 2 @{ method = "GET"; scheme = "https"; path = "/NoorChasib/nilla"; action = "forwarded" })))
Check "a benign request on another connection to the same host doesn't hide the unclassified one" ($judged.unclassified.Count -eq 1 -and $judged.requests -eq 1) ($judged | ConvertTo-Json -Depth 4 -Compress)
$engine = "C:\runner\_temp\Nilla\Nilla.exe"
$networkClient = @{ client = $engine; client_pid = 4100; client_type = "utility"; client_service = "network.mojom.NetworkService" }
function Quiet([hashtable]$Client, $Conn = 3) {
  return @((Row "connect" "api.github.com" $Conn ($Client + @{ action = "opened to read the path" })), (Row "no-request" "api.github.com" $Conn $Client))
}
$judged = Get-ProxyVerdict (Quiet $networkClient) -TrustedEngines @($engine)
Check "a GitHub connection the engine's network service opened and sent nothing on is nothing sent once the probe showed the engine trusts the watch" ($judged.unclassified.Count -eq 0 -and $judged.nothingSent.Count -eq 1) ($judged | ConvertTo-Json -Depth 4 -Compress)
$judged = Get-ProxyVerdict (Quiet ($networkClient + @{})) -TrustedEngines @($engine.ToUpperInvariant())
Check "the engine's image path matches without regard to case" ($judged.nothingSent.Count -eq 1)
$judged = Get-ProxyVerdict (Quiet $networkClient)
Check "without that probe, a GitHub connection that sent no request is unclassified, since a refused certificate looks the same" ($judged.unclassified.Count -eq 1 -and $judged.nothingSent.Count -eq 0)
$others = @(
  @("another program", @{ client = "C:\runner\_temp\app\Nilla.exe"; client_pid = 4200; client_type = "utility"; client_service = "network.mojom.NetworkService" }),
  @("the engine's browser process", @{ client = $engine; client_pid = 4300; client_type = ""; client_service = "" }),
  @("the engine's renderer", @{ client = $engine; client_pid = 4400; client_type = "renderer"; client_service = "" }),
  @("another utility of the engine", @{ client = $engine; client_pid = 4500; client_type = "utility"; client_service = "storage.mojom.StorageService" }),
  @("a client the watch could not attribute", @{ client = ""; client_pid = 0; client_type = ""; client_service = ""; client_error = "InvalidOperationException: no process owns the client end" }),
  @("a row with no client fields", @{})
)
foreach ($case in $others) {
  $judged = Get-ProxyVerdict (Quiet $case[1]) -TrustedEngines @($engine)
  Check "the Chromium probe doesn't vouch for $($case[0]): its quiet GitHub connection is unclassified" ($judged.unclassified.Count -eq 1 -and $judged.nothingSent.Count -eq 0) ($judged | ConvertTo-Json -Depth 4 -Compress)
}
$judged = Get-ProxyVerdict ((Quiet $networkClient 30) + (Quiet @{ client = "C:\Windows\System32\curl.exe"; client_pid = 4600 } 31)) -TrustedEngines @($engine)
Check "one engine connection that sent nothing doesn't excuse another program's quiet connection" ($judged.nothingSent.Count -eq 1 -and $judged.unclassified.Count -eq 1 -and "$($judged.unclassified[0].why)" -like "curl.exe*") ($judged | ConvertTo-Json -Depth 4 -Compress)
$commandLine = '"C:\runner\_temp\Nilla\Nilla.exe" --type=utility --utility-sub-type=network.mojom.NetworkService --lang=en-US --service-sandbox-type=none'
Check "the client's --type is read from its command line" ([NillaWatch.Clients]::Switch($commandLine, "type") -eq "utility")
Check "the client's --utility-sub-type is read from its command line" ([NillaWatch.Clients]::Switch($commandLine, "utility-sub-type") -eq "network.mojom.NetworkService")
Check "a switch that only ends with the name doesn't count" ([NillaWatch.Clients]::Switch('"x.exe" --utility-sub-type=a', "type") -eq "")
Check "a command line with no --type reads as none" ([NillaWatch.Clients]::Switch('"C:\x\Nilla.exe" --flag-switches-begin', "type") -eq "")
$judged = Get-ProxyVerdict @((Row "connect" "github.com" 4 @{ action = "opened to read the path" }), (Row "error" "" 4 @{ error = "IOException: reset" }))
Check "a GitHub connection that failed before its request is unclassified" ($judged.unclassified.Count -eq 1)
$judged = Get-ProxyVerdict @((Row "connect" "github.com" 5 @{ action = "opened to read the path" }))
Check "a GitHub CONNECT with nothing logged after it is unclassified" ($judged.unclassified.Count -eq 1)
$judged = Get-ProxyVerdict @((Row "connect" "github.com" $null @{ action = "opened to read the path" }), (Row "request" "github.com" $null @{ method = "GET"; scheme = "https"; path = "/x"; action = "forwarded" }))
Check "rows without a connection id never vouch for each other" ($judged.unclassified.Count -eq 1)
$judged = Get-ProxyVerdict @((Row "connect" "lab.ardia.dev" 6 @{ action = "refused" }), (Row "connect" "github.com" 7 @{ action = "opened to read the path" }), (Row "request" "github.com" 7 @{ method = "GET"; scheme = "https"; path = "/ardia-browser/ardia/releases"; action = "refused" }))
Check "a refused upstream CONNECT and an upstream GitHub path both count as upstream" ($judged.upstream.Count -eq 2 -and $judged.unclassified.Count -eq 0)
function AuditEvent([int]$Id, [string]$Address, [string]$Application = "\device\harddiskvolume3\a\_temp\Nilla\Nilla.exe", [string]$Direction = "%%14593") {
  return [ordered]@{ Id = $Id; TimeCreated = [datetime]::UtcNow; Data = @{ ProcessID = "4242"; Application = $Application; Direction = $Direction; DestAddress = $Address; DestPort = "443"; Protocol = "6" } }
}
$watched = @("nilla.exe", "nilla-setup*")
$codexReplay = ConvertTo-ConnectionRow (AuditEvent 5157 "140.82.112.3") $watched (Get-NamesByAddress @() @())
Check "the replayed 5157 event becomes a blocked Nilla.exe connection with no name" ($codexReplay -and $codexReplay.outcome -eq "blocked" -and $codexReplay.address -eq "140.82.112.3" -and @($codexReplay.names).Count -eq 0) ($codexReplay | ConvertTo-Json -Compress)
$judged = Get-ConnectionVerdict @($codexReplay)
Check "a blocked direct connection with no DNS or proxy evidence is unverified, not passed (Codex's replay: Nilla.exe -> 140.82.112.3:443)" ($judged.unverified.Count -eq 1 -and $judged.upstream.Count -eq 0 -and "$($judged.unverified[0])" -like "*140.82.112.3:443*unverified*") ($judged | ConvertTo-Json -Depth 4 -Compress)
$judged = Get-ConnectionVerdict @(ConvertTo-ConnectionRow (AuditEvent 5156 "140.82.112.3") $watched @{})
Check "an allowed direct connection with no name is unverified too" ($judged.unverified.Count -eq 1)
$dnsGitHub = @([ordered]@{ name = "github.com"; addresses = @("140.82.112.3") })
$judged = Get-ConnectionVerdict @(ConvertTo-ConnectionRow (AuditEvent 5157 "140.82.112.3") $watched (Get-NamesByAddress $dnsGitHub @()))
Check "a direct connection DNS names as GitHub is unclassified" ($judged.unclassified.Count -eq 1 -and $judged.unverified.Count -eq 0)
$judged = Get-ConnectionVerdict @(ConvertTo-ConnectionRow (AuditEvent 5157 "203.0.113.9") $watched (Get-NamesByAddress @([ordered]@{ name = "LAB.ARDIA.DEV."; addresses = @("203.0.113.9") }) @()))
Check "a direct connection DNS names as upstream is upstream, whatever the name's case and trailing dot" ($judged.upstream.Count -eq 1)
$proxyEvidence = @([pscustomobject]@{ event = "connect"; host = "api.github.com"; port = 443; origin_address = "140.82.112.3"; conn = 9 })
$judged = Get-ConnectionVerdict @(ConvertTo-ConnectionRow (AuditEvent 5157 "140.82.112.3") $watched (Get-NamesByAddress @() $proxyEvidence))
Check "the address the proxy dialled for a host names a direct connection to it" ($judged.unclassified.Count -eq 1 -and $judged.unverified.Count -eq 0) ($judged | ConvertTo-Json -Depth 4 -Compress)
$judged = Get-ConnectionVerdict @(ConvertTo-ConnectionRow (AuditEvent 5157 "::ffff:140.82.112.3") $watched (Get-NamesByAddress $dnsGitHub @()))
Check "an IPv4-mapped destination matches its IPv4 name" ($judged.unclassified.Count -eq 1)
$exampleNamed = Get-NamesByAddress @([ordered]@{ name = "example.org"; addresses = @("93.184.215.14") }) @()
$judged = Get-ConnectionVerdict @(ConvertTo-ConnectionRow (AuditEvent 5157 "93.184.215.14") $watched $exampleNamed)
Check "a blocked direct connection to a named, non-upstream host is no problem" ($judged.unverified.Count -eq 0 -and $judged.upstream.Count -eq 0 -and $judged.unclassified.Count -eq 0)
$judged = Get-ConnectionVerdict @(ConvertTo-ConnectionRow (AuditEvent 5156 "93.184.215.14") $watched $exampleNamed)
Check "an allowed direct connection to a named host still fails as not blocked" ($judged.unverified.Count -eq 1 -and "$($judged.unverified[0])" -like "*was not blocked*")
$judged = Get-ConnectionVerdict @(ConvertTo-ConnectionRow (AuditEvent 5157 "224.0.0.251") $watched @{})
Check "a link-only destination with no name stays ignored" ($judged.unverified.Count -eq 0)
Check "an unwatched program's connection is not a watched row" ($null -eq (ConvertTo-ConnectionRow (AuditEvent 5157 "140.82.112.3" "\device\harddiskvolume3\windows\system32\svchost.exe") $watched @{}))
Check "a loopback connection is not a watched row" ($null -eq (ConvertTo-ConnectionRow (AuditEvent 5157 "127.0.0.1") $watched @{}))
Check "an inbound connection is not a watched row" ($null -eq (ConvertTo-ConnectionRow (AuditEvent 5157 "140.82.112.3" -Direction "%%14592") $watched @{}))
Check "a setup program is watched by its pattern" ($null -ne (ConvertTo-ConnectionRow (AuditEvent 5157 "140.82.112.3" "\device\harddiskvolume3\a\_temp\installer\Nilla-Setup-x64.exe") $watched @{}))

foreach ($case in @(@("224.0.0.251", $true), @("239.255.255.250", $true), @("169.254.1.1", $true), @("ff02::fb", $true), @("fe80::1", $true), @("140.82.112.3", $false), @("2606:50c0:8000::153", $false), @("::ffff:224.0.0.251", $true))) {
  Check "link-only address $($case[0]) is $($case[1])" ((Test-LinkOnly $case[0]) -eq $case[1])
}

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("nilla-watch-test-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $work | Out-Null
$log = Join-Path $work "proxy.jsonl"

$originSource = @"
using System;
using System.IO;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Threading;

namespace NillaWatchTest {
  public sealed class Origin {
    readonly TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
    readonly X509Certificate2 certificate;
    public int Port;
    public string LastRequestLine = "";
    public string LastConnection = "";

    public Func<string, int, IPEndPoint> Redirect() {
      int port = Port;
      return (host, wanted) => new IPEndPoint(IPAddress.Loopback, port);
    }

    public static RemoteCertificateValidationCallback AnyCertificate() {
      return (sender, certificate, chain, errors) => true;
    }

    public Origin(X509Certificate2 certificate) {
      this.certificate = certificate;
      listener.Start();
      Port = ((IPEndPoint)listener.LocalEndpoint).Port;
      new Thread(Loop) { IsBackground = true }.Start();
    }

    void Loop() {
      while (true) {
        TcpClient client;
        try { client = listener.AcceptTcpClient(); } catch (Exception) { return; }
        new Thread(() => Serve(client)) { IsBackground = true }.Start();
      }
    }

    void Serve(TcpClient client) {
      using (client) {
        Stream stream = client.GetStream();
        if (certificate != null) {
          var secure = new SslStream(stream, false);
          secure.AuthenticateAsServer(certificate);
          stream = secure;
        }
        var head = new StringBuilder();
        while (!head.ToString().EndsWith("\r\n\r\n")) {
          int next = stream.ReadByte();
          if (next < 0) return;
          head.Append((char)next);
        }
        string[] lines = head.ToString().Split(new[] { "\r\n" }, StringSplitOptions.None);
        LastRequestLine = lines[0];
        foreach (string line in lines) if (line.StartsWith("Connection:", StringComparison.OrdinalIgnoreCase)) LastConnection = line.Substring(11).Trim();
        byte[] reply = Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
        stream.Write(reply, 0, reply.Length);
        stream.Flush();
        stream.Dispose();
      }
    }
  }

  public static class Client {
    public static string Exchange(int proxyPort, string head) {
      using (var client = new TcpClient()) {
        client.Connect(IPAddress.Loopback, proxyPort);
        client.ReceiveTimeout = 20000;
        Stream stream = client.GetStream();
        byte[] bytes = Encoding.ASCII.GetBytes(head);
        stream.Write(bytes, 0, bytes.Length);
        using (var reader = new StreamReader(stream, Encoding.ASCII)) return reader.ReadToEnd();
      }
    }

    public static string Inspected(int proxyPort, string host, string path, X509Certificate2 trusted) {
      using (var client = new TcpClient()) {
        client.Connect(IPAddress.Loopback, proxyPort);
        client.ReceiveTimeout = 20000;
        Stream stream = client.GetStream();
        byte[] connect = Encoding.ASCII.GetBytes("CONNECT " + host + ":443 HTTP/1.1\r\nHost: " + host + ":443\r\n\r\n");
        stream.Write(connect, 0, connect.Length);
        string established = ReadHead(stream);
        if (!established.StartsWith("HTTP/1.1 200")) return "CONNECT answered " + established;
        var secure = new SslStream(stream, false, (sender, certificate, chain, errors) => {
          using (var custom = new X509Chain()) {
            custom.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
            custom.ChainPolicy.CustomTrustStore.Add(trusted);
            custom.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
            return custom.Build(new X509Certificate2(certificate)) && (errors & ~SslPolicyErrors.RemoteCertificateChainErrors) == SslPolicyErrors.None;
          }
        });
        secure.AuthenticateAsClient(host);
        byte[] request = Encoding.ASCII.GetBytes("GET " + path + " HTTP/1.1\r\nHost: " + host + "\r\nConnection: keep-alive\r\n\r\n");
        secure.Write(request, 0, request.Length);
        secure.Flush();
        using (var reader = new StreamReader(secure, Encoding.ASCII)) return reader.ReadToEnd();
      }
    }

    static string ReadHead(Stream stream) {
      var head = new StringBuilder();
      while (!head.ToString().EndsWith("\r\n\r\n")) {
        int next = stream.ReadByte();
        if (next < 0) break;
        head.Append((char)next);
      }
      return head.ToString();
    }
  }
}
"@
if (-not ([System.Management.Automation.PSTypeName]"NillaWatchTest.Origin").Type) {
  Add-Type -TypeDefinition $originSource -IgnoreWarnings
}

function Read-Log {
  if (-not (Test-Path -LiteralPath $log)) { return @() }
  return @(Get-Content -LiteralPath $log | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json })
}

$authority = [NillaWatch.Authority]::Create()
$proxy = [NillaWatch.Proxy]::new($log, $authority)
$proxy.Start()
$proxy.RunInBackground()
try {
  $plainOrigin = [NillaWatchTest.Origin]::new($null)
  $answer = [NillaWatchTest.Client]::Exchange($proxy.Port, "GET http://127.0.0.1:$($plainOrigin.Port)/hello?x=1 HTTP/1.1`r`nHost: 127.0.0.1:$($plainOrigin.Port)`r`nProxy-Connection: keep-alive`r`n`r`n")
  Check "a plain request to another host is forwarded" ($answer -match "^HTTP/1.1 200" -and $answer.EndsWith("ok")) $answer
  Check "the origin gets the path in origin form" ($plainOrigin.LastRequestLine -eq "GET /hello?x=1 HTTP/1.1") $plainOrigin.LastRequestLine
  Check "the origin is asked to close the connection after one request" ($plainOrigin.LastConnection -eq "close") $plainOrigin.LastConnection

  $answer = [NillaWatchTest.Client]::Exchange($proxy.Port, "GET http://ardia.dev/switches.json HTTP/1.1`r`nHost: ardia.dev`r`n`r`n")
  Check "a plain request to an upstream host is refused" ($answer -match "^HTTP/1.1 403") $answer

  $answer = [NillaWatchTest.Client]::Exchange($proxy.Port, "CONNECT lab.ardia.dev:443 HTTP/1.1`r`nHost: lab.ardia.dev:443`r`n`r`n")
  Check "a CONNECT to an upstream host is refused" ($answer -match "^HTTP/1.1 403") $answer

  $answer = [NillaWatchTest.Client]::Exchange($proxy.Port, "CONNECT 127.0.0.1:$($plainOrigin.Port) HTTP/1.1`r`nHost: 127.0.0.1:$($plainOrigin.Port)`r`n`r`nGET /tunnelled HTTP/1.1`r`nHost: 127.0.0.1`r`n`r`n")
  Check "a CONNECT to another host is tunnelled" ($answer -match "200 Connection Established" -and $answer.EndsWith("ok")) $answer
  Check "the tunnel carries the request untouched" ($plainOrigin.LastRequestLine -eq "GET /tunnelled HTTP/1.1") $plainOrigin.LastRequestLine

  $answer = [NillaWatchTest.Client]::Inspected($proxy.Port, "github.com", "/ardia-browser/ardia/releases/latest", $authority)
  Check "a GitHub request under an upstream owner is read through TLS and refused" ($answer -match "^HTTP/1.1 403") $answer

  $originCertificate = [NillaWatch.Authority]::Leaf([NillaWatch.Authority]::Create(), "localhost")
  $secureOrigin = [NillaWatchTest.Origin]::new($originCertificate)
  $proxy.Redirect = $secureOrigin.Redirect()
  $proxy.OriginCheck = [NillaWatchTest.Origin]::AnyCertificate()
  $answer = [NillaWatchTest.Client]::Inspected($proxy.Port, "github.com", "/NoorChasib/nilla/issues", $authority)
  Check "a GitHub request elsewhere is forwarded after its path is read" ($answer -match "^HTTP/1.1 200" -and $answer.EndsWith("ok")) $answer
  Check "the GitHub origin gets the same path" ($secureOrigin.LastRequestLine -eq "GET /NoorChasib/nilla/issues HTTP/1.1") $secureOrigin.LastRequestLine
  Check "the GitHub origin is asked to close the connection" ($secureOrigin.LastConnection -eq "close") $secureOrigin.LastConnection

  $refusing = [NillaWatch.Authority]::Create()
  $handshake = try { [NillaWatchTest.Client]::Inspected($proxy.Port, "github.com", "/NoorChasib/nilla", $refusing) } catch { "refused: $($_.Exception.InnerException.Message)" }
  Check "a client that doesn't trust the watch's authority never gets an answer" ($handshake -like "refused*") $handshake
  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $deadline -and -not @(Read-Log | Where-Object { $_.event -eq "tls-failed-client" }).Count) { Start-Sleep -Milliseconds 200 }

  $rows = Read-Log
  Check "every proxy row carries its connection id" (@($rows | Where-Object { -not $_.conn }).Count -eq 0) ($rows | Where-Object { -not $_.conn } | ConvertTo-Json -Compress)
  Check "rows of one connection share an id, and connections differ" (@($rows | Group-Object conn).Count -ge 7) "$(@($rows | Group-Object conn).Count) connections"
  $judged = Get-ProxyVerdict $rows
  Check "the live log judges three upstream attempts, and the client that refused the authority as unclassified" ($judged.upstream.Count -eq 3 -and $judged.unclassified.Count -eq 1 -and $judged.nothingSent.Count -eq 0) ($judged | ConvertTo-Json -Depth 4 -Compress)
  $requests = @($rows | Where-Object { $_.event -eq "request" })
  $connects = @($rows | Where-Object { $_.event -eq "connect" })
  Check "the plain request is logged with its path" (@($requests | Where-Object { $_.path -eq "/hello?x=1" -and $_.action -eq "forwarded" -and $_.verdict -eq "other" }).Count -eq 1) ($requests | ConvertTo-Json -Compress)
  Check "the refused plain request is logged as upstream" (@($requests | Where-Object { $_.host -eq "ardia.dev" -and $_.path -eq "/switches.json" -and $_.verdict -eq "upstream" -and $_.action -eq "refused" }).Count -eq 1)
  Check "the refused CONNECT is logged as upstream" (@($connects | Where-Object { $_.host -eq "lab.ardia.dev" -and $_.verdict -eq "upstream" -and $_.action -eq "refused" }).Count -eq 1)
  Check "the tunnel is logged by host" (@($connects | Where-Object { $_.host -eq "127.0.0.1" -and $_.action -eq "tunnelled" }).Count -eq 1)
  Check "the GitHub CONNECTs are logged without a path" (@($connects | Where-Object { $_.host -eq "github.com" -and $_.verdict -eq "github-unknown-path" }).Count -eq 3)
  Check "the upstream GitHub path is logged as upstream and refused" (@($requests | Where-Object { $_.host -eq "github.com" -and $_.path -eq "/ardia-browser/ardia/releases/latest" -and $_.verdict -eq "upstream" -and $_.action -eq "refused" }).Count -eq 1)
  Check "the other GitHub path is logged and forwarded" (@($requests | Where-Object { $_.host -eq "github.com" -and $_.path -eq "/NoorChasib/nilla/issues" -and $_.verdict -eq "other" -and $_.action -eq "forwarded" }).Count -eq 1)
  Check "every log row has a time" (@($rows | Where-Object { -not $_.ts }).Count -eq 0)
  if ($IsWindows) {
    $self = [NillaWatch.Processes]::ImagePath($PID)
    Check "every log row names the test as its client" (@($rows | Where-Object { "$($_.client_pid)" -ne "$PID" -or "$($_.client)" -ne $self }).Count -eq 0) ($rows | Where-Object { "$($_.client_pid)" -ne "$PID" } | Select-Object -First 1 | ConvertTo-Json -Compress)
  } else {
    Check "off Windows every log row says why its client is unknown" (@($rows | Where-Object { "$($_.client)" -or -not "$($_.client_error)" }).Count -eq 0)
  }
  $dialled = @($rows | Where-Object { $_.action -in @("tunnelled", "forwarded") })
  Check "every forwarded or tunnelled row records the address the proxy dialled" ($dialled.Count -ge 3 -and @($dialled | Where-Object { $_.origin_address -ne "127.0.0.1" }).Count -eq 0) ($dialled | ConvertTo-Json -Compress)
  $judged = Get-ProxyVerdict $rows -TrustedEngines @((Get-Process -Id $PID).Path)
  Check "the probe's trust doesn't excuse the live log's clients, which aren't an engine's network service" ($judged.nothingSent.Count -eq 0 -and $judged.unclassified.Count -eq 1)
} finally {
  $proxy.Stop()
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

function Invoke-StopReplay([string]$Name, [object[]]$Audit, [object[]]$Dns, [object[]]$ProxyRows) {
  $root = Join-Path ([System.IO.Path]::GetTempPath()) ("nilla-watch-replay-" + [guid]::NewGuid().ToString("N"))
  $out = Join-Path $root "out"
  $state = Join-Path $root "state"
  $firewall = Join-Path $root "winroot\System32\LogFiles\Firewall"
  New-Item -ItemType Directory -Force -Path $out, $state, $firewall | Out-Null
  Set-Content -LiteralPath (Join-Path $firewall "nilla-watch.log") -Value "#Fields: date time action protocol src-ip dst-ip" -Encoding ascii
  Set-Content -LiteralPath (Join-Path $out "proxy.jsonl") -Value (@($ProxyRows | ForEach-Object { $_ | ConvertTo-Json -Compress }) -join "`n") -Encoding utf8NoBOM
  [ordered]@{ started = [datetime]::UtcNow.AddMinutes(-5).ToString("o"); programs = @(); names = @("nilla.exe"); profiles = @(); rules = $false; audit = $null; dnsEnabled = $null; proxyPid = $null; systemProxy = $false; systemProxyCheck = "http://127.0.0.1:1/"; probe = "path seen: GET github.com/robots.txt, forwarded"; engines = @(); startProblems = @() } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $state "watch.json") -Encoding utf8NoBOM
  $saved = @{ SystemRoot = $env:SystemRoot; GITHUB_STEP_SUMMARY = $env:GITHUB_STEP_SUMMARY; GITHUB_OUTPUT = $env:GITHUB_OUTPUT }
  $events = @{ audit = @($Audit); dns = @($Dns) }
  try {
    $env:SystemRoot = Join-Path $root "winroot"
    $env:GITHUB_STEP_SUMMARY = $null
    $env:GITHUB_OUTPUT = $null
    $global:LASTEXITCODE = 0
    $printed = & {
      function Get-WinEvent([string]$LogName, [string]$FilterXPath, [hashtable]$FilterHashtable) {
        $source = if ($FilterHashtable) { $events.dns } else { $events.audit }
        foreach ($item in $source) {
          $xml = "<Event><EventData>" + (@($item.Data.Keys | ForEach-Object { "<Data Name=`"$_`">$([System.Security.SecurityElement]::Escape("$($item.Data[$_])"))</Data>" }) -join "") + "</EventData></Event>"
          $record = [pscustomobject]@{ Id = $item.Id; TimeCreated = [datetime]::Now; ProcessId = 4242 }
          $record | Add-Member -MemberType ScriptMethod -Name ToXml -Value ([scriptblock]::Create("'$($xml -replace "'", "''")'"))
          $record
        }
      }
      & (Join-Path $PSScriptRoot "upstream-watch.ps1") -Stop -Out $out -State $state 6>&1 *>&1
    }
    $code = $LASTEXITCODE
    $report = Get-Content -LiteralPath (Join-Path $out "no-upstream.json") -Raw | ConvertFrom-Json
    return [pscustomobject]@{ code = $code; report = $report; printed = ($printed | Out-String) }
  } finally {
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key]) }
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$clean = Invoke-StopReplay "clean" @() @() @()
Check "the stop replay passes a run with nothing around the proxy" ($clean.code -eq 0 -and @($clean.report.problems).Count -eq 0) "exit $($clean.code): $(@($clean.report.problems) -join '; ')"
$codex = Invoke-StopReplay "codex" @((AuditEvent 5157 "140.82.112.3")) @() @()
Check "the stop replay fails Codex's synthetic 5157 event (Nilla.exe -> 140.82.112.3:443, no DNS or proxy row) as unverified" ($codex.code -eq 1 -and @($codex.report.upstream).Count -eq 0 -and @($codex.report.problems | Where-Object { "$_" -like "*140.82.112.3:443*unverified*" }).Count -eq 1) "exit $($codex.code): $(@($codex.report.problems) -join '; ')"
$named = Invoke-StopReplay "named" @((AuditEvent 5157 "140.82.112.3")) @([ordered]@{ Id = 3008; Data = @{ QueryName = "github.com"; QueryResults = "::ffff:140.82.112.3;" } }) @()
Check "the stop replay fails the same event as an unclassified GitHub contact once DNS names it" ($named.code -eq 1 -and @($named.report.github).Count -eq 1) "exit $($named.code): $(@($named.report.problems) -join '; ')"
$dialled = Invoke-StopReplay "dialled" @((AuditEvent 5157 "93.184.215.14")) @() @([ordered]@{ event = "connect"; host = "example.org"; port = 443; action = "tunnelled"; origin_address = "93.184.215.14"; conn = 1 })
Check "the stop replay passes a blocked connection to an address the proxy dialled for a non-upstream host" ($dialled.code -eq 0 -and @($dialled.report.problems).Count -eq 0) "exit $($dialled.code): $(@($dialled.report.problems) -join '; ')"
$quietOther = Invoke-StopReplay "quiet" @() @() @((Quiet @{ client = "C:\Windows\System32\curl.exe"; client_pid = 4600 } 1))
Check "the stop replay fails another program's quiet GitHub connection although the probe passed" ($quietOther.code -eq 1 -and @($quietOther.report.github).Count -eq 1 -and @($quietOther.report.nothingSent).Count -eq 0) "exit $($quietOther.code): $(@($quietOther.report.problems) -join '; ')"

if ($failures.Count) {
  $failures | ForEach-Object { Write-Host "::error::$_" }
  exit 1
}
Write-Host "The no-upstream watch classifies the fixed list as the Linux check does, refuses upstream requests and logs every host and GitHub path."
