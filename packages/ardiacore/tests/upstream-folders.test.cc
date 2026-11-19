#include "../ios/NillaUpstreamFolders.h"

#include <cstdio>
#include <cstdlib>
#include <fcntl.h>
#include <string>

using namespace nilla_upstream;

static int failures = 0;
#define CHECK(cond)                                                \
  do {                                                             \
    if (!(cond)) {                                                 \
      std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);  \
      failures++;                                                  \
    }                                                              \
  } while (0)

static std::string scratch, home;

static std::string At(const std::string &relative) { return home + "/" + relative; }

static void Folder(const std::string &path) {
  std::string partial;
  for (const auto &part : Components(path)) {
    partial += "/" + part;
    mkdir(partial.c_str(), 0755);
  }
}

static void File(const std::string &path) {
  const int fd = open(path.c_str(), O_CREAT | O_WRONLY | O_TRUNC, 0644);
  if (fd >= 0) close(fd);
}

static void Link(const std::string &at, const std::string &target) { symlink(target.c_str(), at.c_str()); }

static bool Own(const std::string &path) { return OwnPath(path, home).has_value(); }

static std::string Data(const std::string &bundle) { return At("Library/Application Support/" + bundle); }

static void Fresh() {
  std::string command = "rm -rf '" + scratch + "'";
  if (!scratch.empty() && std::system(command.c_str()) != 0) std::printf("couldn't clear %s\n", scratch.c_str());
  Folder(At(".config/ardia/config/themes"));
  File(At(".config/ardia/config/config.json"));
  Folder(At("Library/Application Support/com.ardia.browser/Chromium/Default"));
  File(At("Library/Application Support/com.ardia.browser/Chromium/Default/History"));
  Folder(At("Library/Application Support/Ardia"));
}

int main() {
  char base[] = "/tmp/nilla-upstream-folders-XXXXXX";
  if (!mkdtemp(base)) return 1;
  scratch = *Resolve(base);
  home = scratch + "/home";

  Fresh();
  CHECK(Own(Data("com.nilladigital.nilla")));
  CHECK(Own(Data("com.nilladigital.nilla/Chromium")));
  CHECK(*OwnPath(Data("com.nilladigital.nilla/Chromium"), home) == Data("com.nilladigital.nilla/Chromium"));

  Link(Data("com.nilladigital.nilla"), Data("com.ardia.browser"));
  CHECK(!Own(Data("com.nilladigital.nilla")));
  CHECK(!Own(Data("com.nilladigital.nilla/Chromium")));
  CHECK(!Own(Data("com.nilladigital.nilla/switches-cache.json")));

  Fresh();
  Link(Data("com.nilladigital.nilla"), "Ardia");
  CHECK(!Own(Data("com.nilladigital.nilla")));

  Fresh();
  Folder(Data("com.nilladigital.nilla"));
  Link(Data("com.nilladigital.nilla/Chromium"), Data("com.ardia.browser/Chromium"));
  CHECK(Own(Data("com.nilladigital.nilla")));
  CHECK(!Own(Data("com.nilladigital.nilla/Chromium")));

  Fresh();
  Folder(scratch + "/elsewhere");
  Folder(Data("com.nilladigital.nilla"));
  Link(scratch + "/elsewhere/support", At("Library/Application Support"));
  CHECK(!Own(scratch + "/elsewhere/support/com.ardia.browser/Chromium"));
  CHECK(!Own(Data("com.nilladigital.nilla/../com.ardia.browser/Chromium")));
  CHECK(Own(Data("com.nilladigital.nilla/../com.nilladigital.nilla.notes")));
  CHECK(!Own(Data("missing/../../Library/Application Support/Ardia")));

  Fresh();
  Link(Data("com.nilladigital.nilla"), scratch + "/gone");
  CHECK(!Own(Data("com.nilladigital.nilla/Chromium")));

  Fresh();
  Folder(scratch + "/scratch-data");
  CHECK(Own(scratch + "/scratch-data/Chromium"));
  Link(scratch + "/scratch-data/Chromium", At(".config/ardia"));
  CHECK(!Own(scratch + "/scratch-data/Chromium"));

  Fresh();
  Folder(At("Library/Logs"));
  Link(At("Library/Logs/Ardia"), "../../../later/ardia-logs");
  CHECK(Own(Data("com.nilladigital.nilla")));
  CHECK(!Own(scratch + "/later/ardia-logs"));
  CHECK(!Own(scratch + "/later/ardia-logs/data"));
  Folder(At(".cache"));
  Link(At(".cache/ardia"), At(".cache/ardia"));
  CHECK(!Own(Data("com.nilladigital.nilla")));

  Fresh();
  Folder(scratch + "/real/nilla");
  Link(Data("com.nilladigital.nilla"), scratch + "/real/nilla");
  CHECK(Own(Data("com.nilladigital.nilla")));
  CHECK(*OwnPath(Data("com.nilladigital.nilla/Chromium"), home) == scratch + "/real/nilla/Chromium");
  CHECK(!Own("relative/Chromium"));
  CHECK(!Own(""));

#if __APPLE__
  Fresh();
  CHECK(!Own(At("Library/Application Support/COM.ARDIA.BROWSER/Chromium")));
  CHECK(!Own(At(".config/ARDIA/config")));
#endif

  CHECK(Folders(home).size() == 7);

  std::string command = "rm -rf '" + scratch + "'";
  if (std::system(command.c_str()) != 0) std::printf("couldn't clear %s\n", scratch.c_str());
  if (failures) {
    std::printf("%d failure(s)\n", failures);
    return 1;
  }
  std::printf("upstream-folders: ok\n");
  return 0;
}
