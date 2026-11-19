using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;

namespace NillaWatch {
  public static class Rules {
    public static readonly string[] UpstreamDomains = { "ardia.dev", "netnyahoo.com" };
    public static readonly string[] GitHubHosts = { "github.com", "api.github.com", "objects.githubusercontent.com" };
    public static readonly string[] ExtraGitHubHosts = { "raw.githubusercontent.com", "codeload.github.com", "uploads.github.com" };
    public static readonly string[] UpstreamOwners = { "ardia-browser", "mantrakp04" };
    public static readonly string[] AllowedHosts = { "services.helium.imput.net" };
    static readonly string[] OwnerRoutes = { "repos", "users", "orgs" };
    static readonly Regex OwnerPattern = new Regex("(?:^|[/=%.\\s])(" + string.Join("|", UpstreamOwners.Select(Regex.Escape)) + ")(?:[/%&\\s.]|$)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public static string NormalHost(string host) {
      return (host ?? "").Trim().TrimEnd('.').ToLowerInvariant();
    }

    static bool Under(string host, string domain) {
      return host == domain || host.EndsWith("." + domain, StringComparison.Ordinal);
    }

    public static bool IsGitHubHost(string host) {
      string normal = NormalHost(host);
      return GitHubHosts.Contains(normal) || ExtraGitHubHosts.Contains(normal);
    }

    static bool OwnerInPath(string host, string path) {
      string decoded = Uri.UnescapeDataString(path ?? "");
      string[] segments = decoded.Split(new[] { '?' }, 2)[0].Split('/').Where(segment => segment.Length > 0).ToArray();
      if (host == "api.github.com" && segments.Length >= 2 && OwnerRoutes.Contains(segments[0]) && UpstreamOwners.Contains(segments[1].ToLowerInvariant())) return true;
      if (segments.Length > 0 && UpstreamOwners.Contains(segments[0].ToLowerInvariant())) return true;
      return OwnerPattern.IsMatch(decoded);
    }

    public static string[] ClassifyHost(string host) {
      return Classify(host, null);
    }

    public static string[] Classify(string host, string path) {
      string normal = NormalHost(host);
      if (normal.Length == 0) return new[] { "other", "" };
      if (AllowedHosts.Any(allowed => Under(normal, allowed))) return new[] { "allowed", "Helium bang list exception" };
      foreach (string domain in UpstreamDomains) {
        if (Under(normal, domain)) return new[] { "upstream", "host under " + domain };
      }
      if (GitHubHosts.Contains(normal) || ExtraGitHubHosts.Contains(normal)) {
        if (path == null) return new[] { "github-unknown-path", "GitHub host contacted without a visible path" };
        if (OwnerInPath(normal, path)) {
          string listed = GitHubHosts.Contains(normal) ? "fixed list" : "extension of the fixed list";
          return new[] { "upstream", normal + " path under an upstream owner (" + listed + ")" };
        }
      }
      return new[] { "other", "" };
    }
  }

  public static class Authority {
    public static X509Certificate2 Create() {
      using (RSA key = RSA.Create(2048)) {
        var request = new CertificateRequest("CN=Nilla CI no-upstream watch, O=throwaway", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, true, 0, true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign, true));
        request.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(request.PublicKey, false));
        using (X509Certificate2 made = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(3))) {
          return Usable(made);
        }
      }
    }

    public static X509Certificate2 Leaf(X509Certificate2 authority, string host) {
      using (RSA key = RSA.Create(2048)) {
        var request = new CertificateRequest("CN=" + host, key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var names = new SubjectAlternativeNameBuilder();
        IPAddress address;
        if (IPAddress.TryParse(host, out address)) names.AddIpAddress(address); else names.AddDnsName(host);
        request.CertificateExtensions.Add(names.Build());
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, false));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));
        request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(new OidCollection { new Oid("1.3.6.1.5.5.7.3.1") }, false));
        byte[] serial = new byte[16];
        RandomNumberGenerator.Fill(serial);
        serial[0] &= 0x7f;
        using (X509Certificate2 issued = request.Create(authority, DateTimeOffset.UtcNow.AddHours(-1), DateTimeOffset.UtcNow.AddDays(2), serial))
        using (X509Certificate2 withKey = issued.CopyWithPrivateKey(key)) {
          return Usable(withKey);
        }
      }
    }

    static X509Certificate2 Usable(X509Certificate2 certificate) {
      return new X509Certificate2(certificate.Export(X509ContentType.Pkcs12), (string)null, X509KeyStorageFlags.Exportable);
    }
  }

  public sealed class Proxy {
    const int MaxHead = 65536;
    readonly string logPath;
    readonly X509Certificate2 authority;
    readonly object logGate = new object();
    readonly Dictionary<string, X509Certificate2> leaves = new Dictionary<string, X509Certificate2>(StringComparer.OrdinalIgnoreCase);
    TcpListener listener;
    long connections;
    [ThreadStatic] static long connection;
    [ThreadStatic] static Dictionary<string, object> client;

    public int Port { get; private set; }
    public Func<string, int, IPEndPoint> Redirect { get; set; }
    public RemoteCertificateValidationCallback OriginCheck { get; set; }

    public Proxy(string logPath, X509Certificate2 authority) {
      this.logPath = logPath;
      this.authority = authority;
    }

    public void Start() {
      listener = new TcpListener(IPAddress.Loopback, 0);
      listener.Start(256);
      Port = ((IPEndPoint)listener.LocalEndpoint).Port;
    }

    public void Run() {
      while (true) {
        TcpClient client;
        try {
          client = listener.AcceptTcpClient();
        } catch (ObjectDisposedException) {
          return;
        } catch (SocketException) {
          if (listener == null || !listener.Server.IsBound) return;
          continue;
        }
        var worker = new Thread(() => Handle(client)) { IsBackground = true };
        worker.Start();
      }
    }

    public void RunInBackground() {
      var loop = new Thread(Run) { IsBackground = true };
      loop.Start();
    }

    public void Stop() {
      try {
        listener.Stop();
      } catch (Exception) {
      }
    }

    public void Record(Dictionary<string, object> entry) {
      entry["ts"] = Math.Round(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0, 3);
      if (connection > 0 && !entry.ContainsKey("conn")) entry["conn"] = connection;
      if (client != null) foreach (var pair in client) if (!entry.ContainsKey(pair.Key)) entry[pair.Key] = pair.Value;
      string line = JsonSerializer.Serialize(entry) + "\n";
      lock (logGate) {
        File.AppendAllText(logPath, line, new UTF8Encoding(false));
      }
    }

    sealed class Head {
      public string Method;
      public string Target;
      public string Version;
      public List<string> Headers = new List<string>();

      public string Header(string name) {
        foreach (string line in Headers) {
          int colon = line.IndexOf(':');
          if (colon > 0 && string.Equals(line.Substring(0, colon).Trim(), name, StringComparison.OrdinalIgnoreCase)) return line.Substring(colon + 1).Trim();
        }
        return null;
      }
    }

    static Head ReadHead(Stream stream) {
      var bytes = new List<byte>();
      while (bytes.Count < MaxHead) {
        int next = stream.ReadByte();
        if (next < 0) return null;
        bytes.Add((byte)next);
        int count = bytes.Count;
        if (count >= 4 && bytes[count - 4] == 13 && bytes[count - 3] == 10 && bytes[count - 2] == 13 && bytes[count - 1] == 10) break;
      }
      if (bytes.Count >= MaxHead) return null;
      string text = Encoding.Latin1.GetString(bytes.ToArray());
      string[] lines = text.Split(new[] { "\r\n" }, StringSplitOptions.None);
      string[] first = lines[0].Split(' ');
      if (first.Length < 3) return null;
      var head = new Head { Method = first[0], Target = first[1], Version = first[2] };
      for (int i = 1; i < lines.Length; i++) {
        if (lines[i].Length > 0) head.Headers.Add(lines[i]);
      }
      return head;
    }

    static byte[] Forwarded(Head head, string target) {
      bool upgrade = head.Header("Upgrade") != null;
      var text = new StringBuilder();
      text.Append(head.Method).Append(' ').Append(target).Append(' ').Append(head.Version).Append("\r\n");
      foreach (string line in head.Headers) {
        int colon = line.IndexOf(':');
        string name = colon > 0 ? line.Substring(0, colon).Trim() : "";
        if (name.Equals("Proxy-Connection", StringComparison.OrdinalIgnoreCase) || name.Equals("Proxy-Authorization", StringComparison.OrdinalIgnoreCase)) continue;
        if (!upgrade && (name.Equals("Connection", StringComparison.OrdinalIgnoreCase) || name.Equals("Keep-Alive", StringComparison.OrdinalIgnoreCase))) continue;
        text.Append(line).Append("\r\n");
      }
      if (!upgrade) text.Append("Connection: close\r\n");
      text.Append("\r\n");
      return Encoding.Latin1.GetBytes(text.ToString());
    }

    static void Reply(Stream stream, int status, string reason) {
      byte[] body = Encoding.UTF8.GetBytes("nilla no-upstream watch: " + reason + "\n");
      string head = "HTTP/1.1 " + status + " " + (status == 403 ? "Forbidden" : status == 502 ? "Bad Gateway" : "Bad Request") + "\r\nContent-Type: text/plain\r\nX-Nilla-Watch: refused\r\nContent-Length: " + body.Length + "\r\nConnection: close\r\n\r\n";
      byte[] bytes = Encoding.Latin1.GetBytes(head);
      stream.Write(bytes, 0, bytes.Length);
      stream.Write(body, 0, body.Length);
      stream.Flush();
    }

    static bool SplitHostPort(string text, int fallback, out string host, out int port) {
      host = text;
      port = fallback;
      if (text.StartsWith("[")) {
        int end = text.IndexOf(']');
        if (end < 0) return false;
        host = text.Substring(1, end - 1);
        string rest = text.Substring(end + 1);
        if (rest.StartsWith(":")) return int.TryParse(rest.Substring(1), out port);
        return rest.Length == 0;
      }
      int colon = text.LastIndexOf(':');
      if (colon > 0 && text.IndexOf(':') == colon) {
        host = text.Substring(0, colon);
        return int.TryParse(text.Substring(colon + 1), out port);
      }
      return text.Length > 0;
    }

    TcpClient Dial(string host, int port) {
      IPEndPoint redirected = Redirect == null ? null : Redirect(host, port);
      var origin = new TcpClient();
      if (redirected != null) origin.Connect(redirected); else origin.Connect(host, port);
      origin.NoDelay = true;
      return origin;
    }

    static string DialledAddress(TcpClient origin) {
      try {
        IPAddress address = ((IPEndPoint)origin.Client.RemoteEndPoint).Address;
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        return address.ToString();
      } catch (Exception) {
        return "";
      }
    }

    static void Pipe(Stream from, Stream to, ManualResetEvent done) {
      try {
        from.CopyTo(to, 65536);
      } catch (Exception) {
      } finally {
        done.Set();
      }
    }

    static void Join(Stream client, Stream origin) {
      using (var done = new ManualResetEvent(false)) {
        var up = new Thread(() => Pipe(client, origin, done)) { IsBackground = true };
        var down = new Thread(() => Pipe(origin, client, done)) { IsBackground = true };
        up.Start();
        down.Start();
        done.WaitOne();
        try {
          origin.Dispose();
        } catch (Exception) {
        }
        try {
          client.Dispose();
        } catch (Exception) {
        }
        up.Join(5000);
        down.Join(5000);
      }
    }

    X509Certificate2 LeafFor(string host) {
      lock (leaves) {
        X509Certificate2 leaf;
        if (!leaves.TryGetValue(host, out leaf)) {
          leaf = Authority.Leaf(authority, host);
          leaves[host] = leaf;
        }
        return leaf;
      }
    }

    void Handle(TcpClient accepted) {
      connection = Interlocked.Increment(ref connections);
      client = Clients.Describe(accepted.Client.RemoteEndPoint as IPEndPoint, Port);
      using (accepted) {
        accepted.NoDelay = true;
        NetworkStream stream = accepted.GetStream();
        Head head = null;
        try {
          head = ReadHead(stream);
          if (head == null) return;
          if (head.Method.Equals("CONNECT", StringComparison.OrdinalIgnoreCase)) Connect(stream, head); else Plain(stream, head);
        } catch (Exception error) {
          Record(new Dictionary<string, object> { { "event", "error" }, { "target", head == null ? "" : head.Target }, { "error", error.GetType().Name + ": " + error.Message } });
        }
      }
    }

    void Plain(NetworkStream stream, Head head) {
      Uri uri;
      if (!Uri.TryCreate(head.Target, UriKind.Absolute, out uri) || uri.Scheme != "http") {
        Record(new Dictionary<string, object> { { "event", "request" }, { "method", head.Method }, { "scheme", "" }, { "host", "" }, { "port", 0 }, { "path", head.Target }, { "verdict", "other" }, { "why", "" }, { "action", "refused: not a proxy request" } });
        Reply(stream, 400, "send an absolute http:// URL or CONNECT");
        return;
      }
      string host = uri.IdnHost;
      string path = uri.PathAndQuery;
      string[] verdict = Rules.Classify(host, path);
      bool upstream = verdict[0] == "upstream";
      var entry = new Dictionary<string, object> { { "event", "request" }, { "method", head.Method }, { "scheme", "http" }, { "host", host }, { "port", uri.Port }, { "path", path }, { "user_agent", head.Header("User-Agent") ?? "" }, { "verdict", verdict[0] }, { "why", verdict[1] }, { "action", upstream ? "refused" : "forwarded" } };
      if (upstream) {
        Record(entry);
        Reply(stream, 403, "upstream destination refused");
        return;
      }
      TcpClient origin;
      try {
        origin = Dial(host, uri.Port);
        entry["origin_address"] = DialledAddress(origin);
      } catch (Exception error) {
        entry["action"] = "origin unreachable: " + error.Message;
        Record(entry);
        Reply(stream, 502, "origin unreachable");
        return;
      }
      Record(entry);
      using (origin) {
        NetworkStream originStream = origin.GetStream();
        byte[] forwarded = Forwarded(head, path);
        originStream.Write(forwarded, 0, forwarded.Length);
        Join(stream, originStream);
      }
    }

    void Connect(NetworkStream stream, Head head) {
      string host;
      int port;
      if (!SplitHostPort(head.Target, 443, out host, out port)) {
        Reply(stream, 400, "bad CONNECT target");
        return;
      }
      string[] verdict = Rules.Classify(host, null);
      bool github = Rules.IsGitHubHost(host);
      var entry = new Dictionary<string, object> { { "event", "connect" }, { "host", host }, { "port", port }, { "user_agent", head.Header("User-Agent") ?? "" }, { "verdict", verdict[0] }, { "why", verdict[1] } };
      if (verdict[0] == "upstream") {
        entry["action"] = "refused";
        Record(entry);
        Reply(stream, 403, "upstream destination refused");
        return;
      }
      if (github) {
        entry["action"] = "opened to read the path";
        Record(entry);
        Inspect(stream, host, port);
        return;
      }
      TcpClient origin;
      try {
        origin = Dial(host, port);
        entry["origin_address"] = DialledAddress(origin);
      } catch (Exception error) {
        entry["action"] = "origin unreachable: " + error.Message;
        Record(entry);
        Reply(stream, 502, "origin unreachable");
        return;
      }
      entry["action"] = "tunnelled";
      Record(entry);
      using (origin) {
        byte[] established = Encoding.Latin1.GetBytes("HTTP/1.1 200 Connection Established\r\n\r\n");
        stream.Write(established, 0, established.Length);
        stream.Flush();
        Join(stream, origin.GetStream());
      }
    }

    void Inspect(NetworkStream stream, string host, int port) {
      byte[] established = Encoding.Latin1.GetBytes("HTTP/1.1 200 Connection Established\r\n\r\n");
      stream.Write(established, 0, established.Length);
      stream.Flush();
      using (var secure = new SslStream(stream, false)) {
        try {
          var options = new SslServerAuthenticationOptions {
            ServerCertificate = LeafFor(host),
            ClientCertificateRequired = false,
            ApplicationProtocols = new List<SslApplicationProtocol> { SslApplicationProtocol.Http11 },
          };
          secure.AuthenticateAsServer(options);
        } catch (Exception error) {
          Record(new Dictionary<string, object> { { "event", "tls-failed-client" }, { "host", host }, { "port", port }, { "verdict", Rules.Classify(host, null)[0] }, { "error", error.GetType().Name + ": " + error.Message } });
          return;
        }
        Head head = ReadHead(secure);
        if (head == null) {
          Record(new Dictionary<string, object> { { "event", "no-request" }, { "host", host }, { "port", port }, { "verdict", Rules.Classify(host, null)[0] } });
          return;
        }
        string path = head.Target;
        string[] verdict = Rules.Classify(host, path);
        bool upstream = verdict[0] == "upstream";
        var entry = new Dictionary<string, object> { { "event", "request" }, { "method", head.Method }, { "scheme", "https" }, { "host", host }, { "port", port }, { "path", path }, { "user_agent", head.Header("User-Agent") ?? "" }, { "verdict", verdict[0] }, { "why", verdict[1] }, { "action", upstream ? "refused" : "forwarded" } };
        if (upstream) {
          Record(entry);
          Reply(secure, 403, "upstream destination refused");
          return;
        }
        TcpClient origin;
        try {
          origin = Dial(host, port);
          entry["origin_address"] = DialledAddress(origin);
        } catch (Exception error) {
          entry["action"] = "origin unreachable: " + error.Message;
          Record(entry);
          Reply(secure, 502, "origin unreachable");
          return;
        }
        using (origin)
        using (var originSecure = new SslStream(origin.GetStream(), false, OriginCheck)) {
          try {
            originSecure.AuthenticateAsClient(new SslClientAuthenticationOptions {
              TargetHost = host,
              ApplicationProtocols = new List<SslApplicationProtocol> { SslApplicationProtocol.Http11 },
            });
          } catch (Exception error) {
            entry["action"] = "origin TLS failed: " + error.Message;
            Record(entry);
            Reply(secure, 502, "origin TLS failed");
            return;
          }
          Record(entry);
          byte[] forwarded = Forwarded(head, path);
          originSecure.Write(forwarded, 0, forwarded.Length);
          originSecure.Flush();
          Join(secure, originSecure);
        }
      }
    }
  }

  public static class Processes {
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(int access, bool inherit, int id);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "QueryFullProcessImageNameW")]
    static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int size);

    const int QueryLimitedInformation = 0x1000;

    public static string ImagePath(int id) {
      IntPtr process = OpenProcess(QueryLimitedInformation, false, id);
      if (process == IntPtr.Zero) return null;
      try {
        var name = new StringBuilder(32768);
        int size = name.Capacity;
        return QueryFullProcessImageName(process, 0, name, ref size) ? name.ToString(0, size) : null;
      } finally {
        CloseHandle(process);
      }
    }
  }

  public static class Clients {
    [DllImport("iphlpapi.dll", SetLastError = true)]
    static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool sorted, int family, int tableClass, int reserved);

    [DllImport("ntdll.dll")]
    static extern int NtQueryInformationProcess(IntPtr process, int infoClass, IntPtr info, int length, out int returned);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(int access, bool inherit, int id);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    const int InterNetwork = 2;
    const int OwnerPidConnections = 4;
    const uint InsufficientBuffer = 122;
    const int CommandLineInformation = 60;
    const int LengthMismatch = unchecked((int)0xC0000004);
    const int BufferTooSmall = unchecked((int)0xC0000023);
    const int QueryLimitedInformation = 0x1000;

    public static Dictionary<string, object> Describe(IPEndPoint peer, int listenerPort) {
      var described = new Dictionary<string, object> { { "client_pid", 0 }, { "client", "" }, { "client_type", "" }, { "client_service", "" } };
      try {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("the client's process can only be read on Windows");
        if (peer == null) throw new InvalidOperationException("the connection has no peer address");
        int id = OwnerOf(peer, listenerPort);
        described["client_pid"] = id;
        string image = Processes.ImagePath(id);
        if (image == null) throw new Win32Exception(Marshal.GetLastWin32Error(), "the image path of process " + id + " could not be read");
        described["client"] = image;
        string commandLine = CommandLineOf(id);
        described["client_type"] = Switch(commandLine, "type");
        described["client_service"] = Switch(commandLine, "utility-sub-type");
      } catch (Exception error) {
        described["client_error"] = error.GetType().Name + ": " + error.Message;
      }
      return described;
    }

    public static string Switch(string commandLine, string name) {
      Match found = Regex.Match(commandLine ?? "", "(?:^|\\s)\"?--" + Regex.Escape(name) + "=([^\\s\"]*)");
      return found.Success ? found.Groups[1].Value : "";
    }

    static int Port(int raw) {
      return ((raw & 0xff) << 8) | ((raw >> 8) & 0xff);
    }

    static int OwnerOf(IPEndPoint peer, int listenerPort) {
      IPAddress wanted = peer.Address.IsIPv4MappedToIPv6 ? peer.Address.MapToIPv4() : peer.Address;
      if (wanted.AddressFamily != AddressFamily.InterNetwork) throw new NotSupportedException("the client " + peer + " is not an IPv4 peer");
      int size = 0;
      uint status = GetExtendedTcpTable(IntPtr.Zero, ref size, false, InterNetwork, OwnerPidConnections, 0);
      for (int attempt = 0; attempt < 4; attempt++) {
        IntPtr table = Marshal.AllocHGlobal(size);
        try {
          status = GetExtendedTcpTable(table, ref size, false, InterNetwork, OwnerPidConnections, 0);
          if (status == InsufficientBuffer) continue;
          if (status != 0) throw new Win32Exception((int)status, "the TCP table could not be read");
          int count = Marshal.ReadInt32(table);
          for (int row = 0; row < count; row++) {
            int at = 4 + row * 24;
            var local = new IPAddress((long)(uint)Marshal.ReadInt32(table, at + 4));
            int localPort = Port(Marshal.ReadInt32(table, at + 8));
            int remotePort = Port(Marshal.ReadInt32(table, at + 16));
            if (localPort == peer.Port && remotePort == listenerPort && local.Equals(wanted)) return Marshal.ReadInt32(table, at + 20);
          }
          throw new InvalidOperationException("no process owns the client end " + peer);
        } finally {
          Marshal.FreeHGlobal(table);
        }
      }
      throw new Win32Exception((int)status, "the TCP table kept growing");
    }

    static string CommandLineOf(int id) {
      IntPtr process = OpenProcess(QueryLimitedInformation, false, id);
      if (process == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "process " + id + " could not be opened");
      try {
        int length = 4096;
        for (int attempt = 0; attempt < 4; attempt++) {
          IntPtr buffer = Marshal.AllocHGlobal(length);
          try {
            int returned;
            int status = NtQueryInformationProcess(process, CommandLineInformation, buffer, length, out returned);
            if (status == LengthMismatch || status == BufferTooSmall) {
              length = Math.Max(returned, length * 2);
              continue;
            }
            if (status != 0) throw new Win32Exception("the command line of process " + id + " could not be read (status 0x" + status.ToString("x8") + ")");
            int bytes = (ushort)Marshal.ReadInt16(buffer);
            IntPtr text = Marshal.ReadIntPtr(buffer, IntPtr.Size);
            return bytes == 0 || text == IntPtr.Zero ? "" : Marshal.PtrToStringUni(text, bytes / 2);
          } finally {
            Marshal.FreeHGlobal(buffer);
          }
        }
        throw new Win32Exception("the command line of process " + id + " kept growing");
      } finally {
        CloseHandle(process);
      }
    }
  }

  public static class SystemProxy {
    [StructLayout(LayoutKind.Sequential)]
    struct OptionList {
      public int Size;
      public IntPtr Connection;
      public int OptionCount;
      public int OptionError;
      public IntPtr Options;
    }

    [DllImport("wininet.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "InternetSetOptionW")]
    static extern bool InternetSetOption(IntPtr handle, int option, IntPtr buffer, int length);

    const int PerConnectionOption = 75;
    const int SettingsChanged = 39;
    const int Refresh = 37;
    const int FlagsOption = 1;
    const int ServerOption = 2;
    const int BypassOption = 3;
    const int Direct = 1;
    const int Proxied = 2;

    public static void Use(string server, string bypass) {
      Apply(Direct | Proxied, server, bypass);
    }

    public static void Clear() {
      Apply(Direct, null, null);
    }

    static void Apply(int flags, string server, string bypass) {
      int entry = IntPtr.Size == 8 ? 16 : 12;
      int valueAt = IntPtr.Size == 8 ? 8 : 4;
      int count = server == null ? 1 : 3;
      IntPtr options = Marshal.AllocCoTaskMem(entry * count);
      IntPtr serverText = IntPtr.Zero;
      IntPtr bypassText = IntPtr.Zero;
      IntPtr list = IntPtr.Zero;
      try {
        for (int i = 0; i < entry * count; i++) Marshal.WriteByte(options, i, 0);
        Marshal.WriteInt32(options, 0, FlagsOption);
        Marshal.WriteInt32(options, valueAt, flags);
        if (server != null) {
          serverText = Marshal.StringToCoTaskMemUni(server);
          bypassText = Marshal.StringToCoTaskMemUni(bypass ?? "");
          Marshal.WriteInt32(options, entry, ServerOption);
          Marshal.WriteIntPtr(options, entry + valueAt, serverText);
          Marshal.WriteInt32(options, entry * 2, BypassOption);
          Marshal.WriteIntPtr(options, entry * 2 + valueAt, bypassText);
        }
        var value = new OptionList { Connection = IntPtr.Zero, OptionCount = count, OptionError = 0, Options = options };
        value.Size = Marshal.SizeOf(typeof(OptionList));
        list = Marshal.AllocCoTaskMem(value.Size);
        Marshal.StructureToPtr(value, list, false);
        if (!InternetSetOption(IntPtr.Zero, PerConnectionOption, list, value.Size)) throw new Win32Exception(Marshal.GetLastWin32Error());
        InternetSetOption(IntPtr.Zero, SettingsChanged, IntPtr.Zero, 0);
        InternetSetOption(IntPtr.Zero, Refresh, IntPtr.Zero, 0);
      } finally {
        if (list != IntPtr.Zero) Marshal.FreeCoTaskMem(list);
        if (serverText != IntPtr.Zero) Marshal.FreeCoTaskMem(serverText);
        if (bypassText != IntPtr.Zero) Marshal.FreeCoTaskMem(bypassText);
        Marshal.FreeCoTaskMem(options);
      }
    }
  }
}
