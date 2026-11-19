#include "../ios/NillaChromiumSwitches.h"

#include <cstdio>
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

static std::string ChromiumSwitchValue(const std::vector<std::string> &argv, std::string_view wanted) {
  std::string value;
  bool found = false;
  for (size_t i = 1; i < argv.size(); i++) {
    const std::string &arg = argv[i];
    if (arg == "--") break;
    size_t prefix = arg.rfind("--", 0) == 0 && arg.size() > 2 ? 2 : arg.rfind("-", 0) == 0 && arg.size() > 1 ? 1 : 0;
    if (!prefix) continue;
    const std::string rest = arg.substr(prefix);
    const size_t equals = rest.find('=');
    if (rest.substr(0, equals) != wanted) continue;
    value = equals == std::string::npos ? "" : rest.substr(equals + 1);
    found = true;
  }
  return found ? value : "<none>";
}

static std::string Engine(const char *rest, const char *dashes = "--") { return std::string(dashes) + std::string(kEnginePrefix) + rest; }

static std::vector<std::string> Launch(const std::vector<std::string> &callerSwitches) {
  std::vector<std::string> argv = {"Nilla", "--user-data-dir=/checked/Chromium", "--profile-directory=Default"};
  for (const std::string &arg : callerSwitches)
    if (!IsReserved(arg, kEnginePrefix)) argv.push_back(arg);
  return argv;
}

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
                           "---user-data-dir=/x", "--nilla-user-data-dir=/x", "--mute-audio"})
    CHECK(!IsReserved(kept, kEnginePrefix));
  CHECK(!IsReserved("--anything", ""));
  CHECK(IsReserved("--user-data-dir=/x", ""));
  CHECK(SwitchName("--user-data-dir=/a=b") == "user-data-dir");
  CHECK(SwitchName("-x") == "x");
  CHECK(SwitchName("--") == "");
  CHECK(NamesUserDataDir("--user-data-dir=/x") && NamesUserDataDir("-user-data-dir"));
  CHECK(!NamesUserDataDir(Engine("data-dir=/x")));

  const std::vector<std::vector<std::string>> attempts = {
      {"--user-data-dir=/upstream"},
      {"-user-data-dir=/upstream"},
      {"--user-data-dir=/upstream", "--user-data-dir=/again"},
      {"--mute-audio", "-user-data-dir=/upstream", "--enable-features=X"},
      {"--user-data-dir"},
      {"--", "--user-data-dir=/positional"},
      {"https://example.com", "-user-data-dir=/upstream"},
      {Engine("data-dir=/upstream", "-")},
  };
  for (const auto &attempt : attempts) {
    const std::vector<std::string> argv = Launch(attempt);
    CHECK(ChromiumSwitchValue(argv, kUserDataDir) == "/checked/Chromium");
    CHECK(ChromiumSwitchValue(argv, Engine("data-dir", "")) == "<none>");
  }
  for (const std::string &arg : std::vector<std::string>{"--user-data-dir=/upstream", "-user-data-dir=/upstream"}) {
    std::vector<std::string> unfiltered = {"Nilla", "--user-data-dir=/checked/Chromium", arg};
    CHECK(ChromiumSwitchValue(unfiltered, kUserDataDir) == "/upstream");
  }

  if (failures) {
    std::printf("%d failure(s)\n", failures);
    return 1;
  }
  std::printf("chromium-switches: ok\n");
  return 0;
}
