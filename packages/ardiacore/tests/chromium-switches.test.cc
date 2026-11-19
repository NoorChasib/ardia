#include "../ios/NillaChromiumSwitches.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <fcntl.h>
#include <map>
#include <string>
#include <vector>

using namespace nilla_switches;

static int failures = 0;
#define CHECK(cond)                                                \
  do {                                                             \
    if (!(cond)) {                                                 \
      std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);  \
      failures++;                                                  \
    }                                                              \
  } while (0)

static constexpr std::string_view kEnginePrefix = "ardia-";

static std::string ChromiumTrim(const std::string &arg) {
  const char *whitespace = "\x09\x0A\x0B\x0C\x0D\x20";
  const size_t first = arg.find_first_not_of(whitespace);
  if (first == std::string::npos) return "";
  return arg.substr(first, arg.find_last_not_of(whitespace) - first + 1);
}

static std::map<std::string, std::string> ChromiumPosixSwitches(const std::vector<std::string> &argv) {
  std::map<std::string, std::string> switches;
  bool parseSwitches = true;
  for (size_t i = 1; i < argv.size(); i++) {
    const std::string arg = ChromiumTrim(argv[i]);
    parseSwitches &= arg != "--";
    const size_t prefix = arg.rfind("--", 0) == 0 ? 2 : arg.rfind("-", 0) == 0 ? 1 : 0;
    if (!parseSwitches || prefix == 0 || prefix == arg.size()) continue;
    const size_t equals = arg.find('=');
    std::string key = arg.substr(0, equals);
    key = key.substr(key.rfind("--", 0) == 0 ? 2 : key.rfind("-", 0) == 0 ? 1 : 0);
    switches[key] = equals == std::string::npos ? "" : arg.substr(equals + 1);
  }
  return switches;
}

static std::string ChromiumSwitchValue(const std::vector<std::string> &argv, const std::string &wanted) {
  const auto switches = ChromiumPosixSwitches(argv);
  const auto found = switches.find(wanted);
  return found == switches.end() ? "<none>" : found->second;
}

static std::string Engine(const char *rest, const char *dashes = "--") { return std::string(dashes) + std::string(kEnginePrefix) + rest; }

static std::vector<std::string> NoRoots() { return {}; }

static std::vector<std::string> Launch(const std::vector<std::string> &callerSwitches) {
  std::vector<std::string> argv = {"Nilla", "--user-data-dir=/checked/Chromium", "--profile-directory=Default"};
  for (const std::string &arg : callerSwitches) {
    const Forwarding forwarding = ForwardedArgument(arg, kEnginePrefix, "/", NoRoots(), Syntax::posix);
    if (forwarding.refusal == Refusal::none) argv.push_back(forwarding.argument);
  }
  return argv;
}

static void Folder(const std::string &path) {
  std::string partial;
  for (const auto &part : nilla_upstream::Components(path)) {
    partial += "/" + part;
    mkdir(partial.c_str(), 0755);
  }
}

static Forwarding Forward(const std::string &arg, const std::string &workingDirectory, const std::vector<std::string> &roots) {
  return ForwardedArgument(arg, kEnginePrefix, workingDirectory, roots, Syntax::posix);
}

static const std::vector<std::string> kAsciiSpaces = {" ", "\t", "\n", "\v", "\f", "\r", " \t\r\n\v\f"};

int main() {
  for (const char *reserved : {"--user-data-dir=/Users/me/Library/Application Support/Elsewhere", "-user-data-dir=/elsewhere",
                               "--user-data-dir", "-user-data-dir", "--user-data-dir=", "--USER-DATA-DIR=/x", "--User-Data-Dir=/x"})
    CHECK(IsReserved(reserved, kEnginePrefix));
  for (const std::string &reserved : {Engine("data-dir=/x"), Engine("data-dir=/x", "-"), Engine("test=a"), Engine(""), Engine("background", "-")})
    CHECK(IsReserved(reserved, kEnginePrefix));
  std::string shouted = Engine("background", "-");
  for (char &c : shouted) c = (char)std::toupper((unsigned char)c);
  CHECK(IsReserved(shouted, kEnginePrefix));
  for (const char *kept : {"--enable-features=X", "--user-data-directory=/x", "--user-data-dirs=/x", "--profile-directory=Default",
                           "user-data-dir=/x", "/user-data-dir=/x", "--", "-", "", "https://example.com/--user-data-dir=/x",
                           "---user-data-dir=/x", "--nilla-user-data-dir=/x", "--mute-audio", " -- ", "\t-\t"})
    CHECK(!IsReserved(kept, kEnginePrefix));
  CHECK(!IsReserved("--anything", ""));
  CHECK(IsReserved("--user-data-dir=/x", ""));
  CHECK(SwitchName("--user-data-dir=/a=b") == "user-data-dir");
  CHECK(SwitchName("-x") == "x");
  CHECK(SwitchName("--") == "");
  CHECK(NamesUserDataDir("--user-data-dir=/x") && NamesUserDataDir("-user-data-dir"));
  CHECK(!NamesUserDataDir(Engine("data-dir=/x")));

  for (const std::string &space : kAsciiSpaces) {
    for (const std::string &arg : {space + "--user-data-dir=/target", space + "-user-data-dir=/target", "--user-data-dir=/target" + space,
                                   space + "--user-data-dir=/target" + space, space + "--USER-DATA-DIR=/target"}) {
      CHECK(IsReserved(arg, kEnginePrefix));
      CHECK(NamesUserDataDir(arg));
    }
    for (const std::string &arg : {space + Engine("data-dir=/target"), space + Engine("background", "-") + space})
      CHECK(IsReserved(arg, kEnginePrefix));
    CHECK(Trimmed(space + "--mute-audio" + space) == "--mute-audio");
  }
  CHECK(Trimmed(" \t--x=a b\t \n") == "--x=a b");
  CHECK(Trimmed("\x1c--user-data-dir=/x") == "\x1c--user-data-dir=/x");
  CHECK(!IsReserved("\x1c--user-data-dir=/x", kEnginePrefix));
  CHECK(Trimmed("\xC2\xA0--user-data-dir=/x", Syntax::posix) == "\xC2\xA0--user-data-dir=/x");
  CHECK(!IsReserved("\xC2\xA0--user-data-dir=/x", kEnginePrefix, Syntax::posix));
  CHECK(Trimmed("   ") == "");

  for (const char *space : {"\xC2\xA0", "\xE3\x80\x80", "\xE2\x80\xAF", "\xC2\x85", "\xE2\x80\xA8", " "}) {
    CHECK(IsReserved(std::string(space) + "--user-data-dir=/target", kEnginePrefix, Syntax::windows));
    CHECK(IsReserved("--user-data-dir=/target" + std::string(space), kEnginePrefix, Syntax::windows));
  }
  CHECK(IsReserved("/user-data-dir=C:\\target", kEnginePrefix, Syntax::windows));
  CHECK(IsReserved("/USER-DATA-DIR=C:\\target", kEnginePrefix, Syntax::windows));
  CHECK(IsReserved(" " + Engine("data-dir=C:\\target", "/"), kEnginePrefix, Syntax::windows));
  CHECK(!IsReserved(" " + Engine("data-dir=/target", "/"), kEnginePrefix, Syntax::posix));
  CHECK(!IsReserved("/user-data-dir=/x", kEnginePrefix, Syntax::posix));
  CHECK(SwitchName("--USER-DATA-DIR=/x", Syntax::windows) == "user-data-dir");
  CHECK(SwitchName("--USER-DATA-DIR=/x", Syntax::posix) == "USER-DATA-DIR");
  CHECK(SwitchName("/", Syntax::windows) == "");
  CHECK(SwitchName("--=x") == "");
  CHECK(!ParsedSwitch("--"));
  CHECK(!ParsedSwitch(" - "));
  CHECK(ParsedSwitch("--a")->value == std::nullopt);
  CHECK(ParsedSwitch("--a=")->value == std::string());
  CHECK(ParsedSwitch(" --a=b=c ")->value == std::string("b=c"));

  const std::vector<std::vector<std::string>> attempts = {
      {"--user-data-dir=/upstream"},
      {"-user-data-dir=/upstream"},
      {"--user-data-dir=/upstream", "--user-data-dir=/again"},
      {"--mute-audio", "-user-data-dir=/upstream", "--enable-features=X"},
      {"--user-data-dir"},
      {"--", "--user-data-dir=/positional"},
      {" -- ", "--user-data-dir=/positional"},
      {"https://example.com", "-user-data-dir=/upstream"},
      {Engine("data-dir=/upstream", "-")},
      {" --user-data-dir=/upstream"},
      {"\t--user-data-dir=/upstream"},
      {"\v-user-data-dir=/upstream\n"},
      {"--user-data-dir=/upstream\r\n"},
      {"\f\f--user-data-dir=/upstream \t"},
      {"--mute-audio", " -user-data-dir=/upstream", "--enable-features=X"},
      {" " + Engine("data-dir=/upstream", "-")},
  };
  for (const auto &attempt : attempts) {
    const std::vector<std::string> argv = Launch(attempt);
    CHECK(ChromiumSwitchValue(argv, std::string(kUserDataDir)) == "/checked/Chromium");
    CHECK(ChromiumSwitchValue(argv, Engine("data-dir", "")) == "<none>");
  }
  for (const std::string &arg : std::vector<std::string>{"--user-data-dir=/upstream", "-user-data-dir=/upstream", " --user-data-dir=/upstream",
                                                         "\t--user-data-dir=/upstream", "\v-user-data-dir=/upstream\n"}) {
    std::vector<std::string> unfiltered = {"Nilla", "--user-data-dir=/checked/Chromium", arg};
    CHECK(ChromiumSwitchValue(unfiltered, std::string(kUserDataDir)) == "/upstream");
  }

  for (const std::string &arg : {std::string(" --enable-features=A,B "), std::string("\t--mute-audio"), std::string("https://example.com/a b"),
                                 std::string("\x1c--user-data-dir=/x"), std::string(" -- "), std::string("--js-flags=--no-memory-reducer\n")}) {
    const Forwarding forwarding = ForwardedArgument(arg, kEnginePrefix, "/", NoRoots(), Syntax::posix);
    CHECK(forwarding.refusal == Refusal::none);
    CHECK(forwarding.argument == ChromiumTrim(arg));
    CHECK(ChromiumPosixSwitches({"Nilla", arg}) == ChromiumPosixSwitches({"Nilla", forwarding.argument}));
  }
  CHECK(ForwardedArgument(" --user-data-dir=/x", kEnginePrefix, "/", NoRoots()).refusal == Refusal::userDataDir);
  CHECK(ForwardedArgument("\t" + Engine("data-dir=/x"), kEnginePrefix, "/", NoRoots()).refusal == Refusal::engineSwitch);
  CHECK(ForwardedArgument("\t--mute-audio\n", kEnginePrefix, "/", NoRoots()).argument == "--mute-audio");

  char base[] = "/tmp/nilla-chromium-switches-XXXXXX";
  if (!mkdtemp(base)) return 1;
  const std::string scratch = *nilla_upstream::Resolve(base);
  const std::string home = scratch + "/home";
  const std::string config = nilla_upstream::Folders(home)[0];
  const std::string support = nilla_upstream::Folders(home)[5];
  const std::string configName = config.substr(home.size() + 1);
  const std::string configLeaf = configName.substr(configName.rfind('/') + 1);
  const std::string configParent = configName.substr(0, configName.rfind('/'));
  Folder(config);
  Folder(support + "/Default");
  Folder(home + "/ok/ext");
  Folder(home + "/sub");
  symlink(config.c_str(), (home + "/elsewhere").c_str());
  symlink((config + "/new.log").c_str(), (home + "/ok/dangling.log").c_str());
  symlink((scratch + "/nowhere/new.log").c_str(), (home + "/ok/dangling-elsewhere.log").c_str());
  const std::vector<std::string> roots = *nilla_upstream::ProtectedRoots(home);
  const std::string own = home + "/ok";

  const std::vector<std::string> pathSwitches = {
      "disk-cache-dir", "log-file", "log-net-log", "crash-dumps-dir", "breakpad-dump-location", "trace-startup-file", "trace-to-file-name",
      "trace-config-file", "trace-perfetto-config-file", "background-tracing-output-path", "ssl-key-log-file", "profiling-file",
      "ozone-dump-file", "export-uma-logs-to-file", "export-ukm-logs-to-file", "load-extension", "disable-extensions-except",
      "pack-extension", "pack-extension-key", "install-isolated-web-app-from-file", "local-sync-backend-dir", "print-to-pdf", "screenshot",
      "use-file-for-fake-audio-capture", "use-file-for-fake-video-capture", "actor-trace-path", "variations-test-seed-path",
      "browser-subprocess-path", "homedir", "media-cache-dir", "an-unknown-switch",
  };
  for (const std::string &name : pathSwitches) {
    for (const std::string &dashes : {"--", "-"}) {
      const Forwarding refused = Forward(dashes + name + "=" + config + "/target", "/", roots);
      CHECK(refused.refusal == Refusal::protectedPath);
      CHECK(refused.path == config + "/target");
      CHECK(Forward(" " + dashes + name + "=" + support + "/Default/History\t", "/", roots).refusal == Refusal::protectedPath);
      CHECK(Forward(dashes + name + "=" + own + "/target", "/", roots).refusal == Refusal::none);
    }
  }
  for (const std::string &arg : std::vector<std::string>{
           "--load-extension=" + own + "/ext," + config + "/ext",
           "--load-extension=" + config + "/ext," + own + "/ext",
           "--disable-extensions-except=" + own + "/ext;" + support,
           "--js-flags=--logfile=" + config + "/v8.log --log",
           "--js-flags=--no-memory-reducer --redirect-code-traces-to=" + support + "/Default/x",
           "--log-file=" + home + "/elsewhere/linked.log",
           "--log-file=" + home + "/ok/dangling.log",
           "--log-file=" + own + "/../" + configName + "/up.log",
           "--disk-cache-dir=" + own + "/missing/../../" + configName,
           "--log-file=" + home + "/" + configParent + "/./" + configLeaf + "/x",
           "--log-file=" + home + "//" + configParent + "//" + configLeaf + "//x",
           support + "/Default/History",
           "file://" + support + "/Default/History",
           "--trace-startup-file=" + config,
           "--load-extension=" + own + "/a b/ext," + support + "/Default/Extensions/x",
           "--load-extension=" + support + "/Default/Extensions/x y," + own + "/ext",
           "--js-flags=--logfile=" + support + "/Default/v8 log.txt --log",
           "--js-flags=--logfile=\"" + config + "/v8.log\"",
           "--js-flags=--logfile='" + config + "/v8.log'",
           "--x=" + own + "/a:" + config + "/b",
       })
    CHECK(Forward(arg, "/", roots).refusal == Refusal::protectedPath);
  for (const std::string &arg : std::vector<std::string>{"--log-file=owned.log", "owned.log", "--disk-cache-dir=.", "--log-net-log=Default/net.json"})
    CHECK(Forward(arg, config, roots).refusal == Refusal::protectedPath);
  CHECK(Forward("--log-file=../" + configName + "/x.log", home + "/sub", roots).refusal == Refusal::protectedPath);
  CHECK(Forward("--log-file=../elsewhere/x.log", home + "/sub", roots).refusal == Refusal::protectedPath);
  CHECK(Forward("--log-file=x.log", "", roots).refusal == Refusal::protectedPath);
  CHECK(Forward("--log-file=x.log", home + "/sub", roots).refusal == Refusal::none);
  for (const std::string &arg : std::vector<std::string>{
           "--trace-startup=toplevel", "--trace-startup-file=" + own + "/trace.json", "--trace-startup-duration=4", "--trace-startup-format=json",
           "--load-extension=" + own + "/ext", "--disable-features=DisableLoadExtensionCommandLineSwitch", "--log-file=" + home + "/ok/dangling-elsewhere.log",
           "--proxy-server=http://127.0.0.1:9", "--enable-features=WebContentsDiscard,BrowserInitiatedAutomaticPictureInPicture",
           "--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36", "--js-flags=--no-memory-reducer",
           "--remote-debugging-port=9222", "--remote-allow-origins=*", "https://example.com/a?b=c#d", "--host-resolver-rules=MAP * 127.0.0.1",
           "--auto-select-tab-capture-source-by-title=Capture Target", "--autoplay-policy=no-user-gesture-required", "--mute-audio",
           "--enable-logging=stderr", "--apps-gallery-update-url=http://127.0.0.1:8080/webstore/crx", "--" + std::string(NAME_MAX + 1, 'x'),
           "--disk-cache-dir=" + config + "-other", "--log-file=" + support + ".notes/x",
       })
    CHECK(Forward(arg, "/", roots).refusal == Refusal::none);
  CHECK(Forward("--log-file=" + config + "/x", "/", roots).argument == "--log-file=" + config + "/x");
  CHECK(PathCandidates("--a=/x,/y z").size() == 9);
  for (std::string_view candidate : {"--a=/x", "--a=/x,/y", "--a=/x,/y z", "/x", "/x,/y", "/x,/y z", "/y", "/y z", "z"}) {
    const auto all = PathCandidates("--a=/x,/y z");
    CHECK(std::find(all.begin(), all.end(), candidate) != all.end());
  }
  CHECK(PathCandidates("").empty());
  CHECK(PathCandidates(",,==").empty());
#if __APPLE__
  const auto shouted = [&](const std::string &folder) {
    std::string spelled = folder.substr(home.size());
    for (char &c : spelled) c = (char)std::toupper((unsigned char)c);
    return home + spelled;
  };
  CHECK(Forward("--log-file=" + shouted(support) + "/x", "/", roots).refusal == Refusal::protectedPath);
  CHECK(Forward("--log-file=" + shouted(config) + "/x", "/", roots).refusal == Refusal::protectedPath);
#endif

  std::string features = "--enable-features=";
  for (int i = 0; i < 80; i++) features += "Feature" + std::to_string(i) + (i % 3 ? ":param/value," : ",");
  const auto started = std::chrono::steady_clock::now();
  CHECK(Forward(features, "/", roots).refusal == Refusal::none);
  const auto took = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();
  CHECK(took < 100);
  std::printf("chromium-switches: an 80-entry feature list checked in %lld ms\n", (long long)took);

  std::string clear = "rm -rf '" + scratch + "'";
  if (std::system(clear.c_str()) != 0) std::printf("couldn't clear %s\n", scratch.c_str());

  if (failures) {
    std::printf("%d failure(s)\n", failures);
    return 1;
  }
  std::printf("chromium-switches: ok\n");
  return 0;
}
