#include "../ios/NillaChromiumSwitches.h"

#include <cstdio>
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

static std::vector<std::string> Launch(const std::vector<std::string> &callerSwitches) {
  std::vector<std::string> argv = {"Nilla", "--user-data-dir=/checked/Chromium", "--profile-directory=Default"};
  for (const std::string &arg : callerSwitches) {
    const Forwarding forwarding = ForwardedArgument(arg, kEnginePrefix, Syntax::posix);
    if (forwarding.refusal == Refusal::none) argv.push_back(forwarding.argument);
  }
  return argv;
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
    const Forwarding forwarding = ForwardedArgument(arg, kEnginePrefix, Syntax::posix);
    CHECK(forwarding.refusal == Refusal::none);
    CHECK(forwarding.argument == ChromiumTrim(arg));
    CHECK(ChromiumPosixSwitches({"Nilla", arg}) == ChromiumPosixSwitches({"Nilla", forwarding.argument}));
  }
  CHECK(ForwardedArgument(" --user-data-dir=/x", kEnginePrefix).refusal == Refusal::userDataDir);
  CHECK(ForwardedArgument("\t" + Engine("data-dir=/x"), kEnginePrefix).refusal == Refusal::engineSwitch);
  CHECK(ForwardedArgument("\t--mute-audio\n", kEnginePrefix).argument == "--mute-audio");

  if (failures) {
    std::printf("%d failure(s)\n", failures);
    return 1;
  }
  std::printf("chromium-switches: ok\n");
  return 0;
}
