$ErrorActionPreference = "Stop"
if (-not ([System.Management.Automation.PSTypeName]"NillaWatch.Proxy").Type) {
  Add-Type -Path (Join-Path $PSScriptRoot "upstream-watch.cs") -IgnoreWarnings
}

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

  $rows = Read-Log
  $requests = @($rows | Where-Object { $_.event -eq "request" })
  $connects = @($rows | Where-Object { $_.event -eq "connect" })
  Check "the plain request is logged with its path" (@($requests | Where-Object { $_.path -eq "/hello?x=1" -and $_.action -eq "forwarded" -and $_.verdict -eq "other" }).Count -eq 1) ($requests | ConvertTo-Json -Compress)
  Check "the refused plain request is logged as upstream" (@($requests | Where-Object { $_.host -eq "ardia.dev" -and $_.path -eq "/switches.json" -and $_.verdict -eq "upstream" -and $_.action -eq "refused" }).Count -eq 1)
  Check "the refused CONNECT is logged as upstream" (@($connects | Where-Object { $_.host -eq "lab.ardia.dev" -and $_.verdict -eq "upstream" -and $_.action -eq "refused" }).Count -eq 1)
  Check "the tunnel is logged by host" (@($connects | Where-Object { $_.host -eq "127.0.0.1" -and $_.action -eq "tunnelled" }).Count -eq 1)
  Check "the GitHub CONNECTs are logged without a path" (@($connects | Where-Object { $_.host -eq "github.com" -and $_.verdict -eq "github-unknown-path" }).Count -eq 2)
  Check "the upstream GitHub path is logged as upstream and refused" (@($requests | Where-Object { $_.host -eq "github.com" -and $_.path -eq "/ardia-browser/ardia/releases/latest" -and $_.verdict -eq "upstream" -and $_.action -eq "refused" }).Count -eq 1)
  Check "the other GitHub path is logged and forwarded" (@($requests | Where-Object { $_.host -eq "github.com" -and $_.path -eq "/NoorChasib/nilla/issues" -and $_.verdict -eq "other" -and $_.action -eq "forwarded" }).Count -eq 1)
  Check "every log row has a time" (@($rows | Where-Object { -not $_.ts }).Count -eq 0)
} finally {
  $proxy.Stop()
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

if ($failures.Count) {
  $failures | ForEach-Object { Write-Host "::error::$_" }
  exit 1
}
Write-Host "The no-upstream watch classifies the fixed list as the Linux check does, refuses upstream requests and logs every host and GitHub path."
