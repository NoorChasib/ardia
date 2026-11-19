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

  const std::string scratchData = scratch + "/scratch-data";
  const std::string chromium = scratchData + "/Chromium";
  const auto launchAdmits = [&]() {
    const auto protection = ProtectionOf(home);
    return protection && Own(scratchData) && Own(chromium) && !UnownedEntry(chromium, *protection);
  };
  const auto unowned = [&]() { return UnownedEntry(chromium, *ProtectionOf(home)).value_or("<none>"); };

  Fresh();
  Folder(chromium);
  CHECK(launchAdmits());
  CHECK(unowned() == "<none>");
  Folder(chromium + "/Default");
  Folder(chromium + "/Profile 1");
  File(chromium + "/Local State");
  Link(chromium + "/SingletonLock", "nilla-host-4242");
  Link(chromium + "/SingletonSocket", scratch + "/tmp-socket-dir/SingletonSocket");
  Link(chromium + "/SingletonCookie", "8051398273");
  Link(chromium + "/RunningChromeVersion", "157.0.8103.50");
  CHECK(launchAdmits());

  Fresh();
  Folder(chromium);
  Link(chromium + "/Default", Data("com.ardia.browser/Chromium/Default"));
  CHECK(Own(scratchData) && Own(chromium));
  CHECK(!launchAdmits());
  CHECK(unowned() == "Default");

  Fresh();
  Folder(chromium);
  Link(chromium + "/Profile 3", At("Library/Application Support/Ardia"));
  CHECK(!launchAdmits());
  CHECK(unowned() == "Profile 3");

  Fresh();
  Folder(chromium);
  Link(chromium + "/System Profile", At(".config/ardia"));
  CHECK(unowned() == "System Profile");

  Fresh();
  Folder(chromium);
  Link(chromium + "/GrShaderCache", At(".config/ardia/config"));
  CHECK(unowned() == "GrShaderCache");

  Fresh();
  Folder(chromium);
  Link(chromium + "/Default", Data("com.ardia.browser/Chromium/Not Yet"));
  CHECK(unowned() == "Default");

  Fresh();
  Folder(chromium);
  Folder(scratch + "/hop");
  Link(scratch + "/hop/support", At("Library/Application Support"));
  Link(chromium + "/Default", scratch + "/hop/support/com.ardia.browser/Chromium/Default");
  CHECK(unowned() == "Default");

  Fresh();
  Folder(chromium);
  Link(chromium + "/Default", "Default");
  CHECK(unowned() == "Default");

  Fresh();
  Folder(chromium);
  Folder(scratch + "/elsewhere/Default");
  Link(chromium + "/Default", scratch + "/elsewhere/Default");
  CHECK(launchAdmits());

  Fresh();
  CHECK(!UnownedEntry(scratch + "/no-such-data", *ProtectionOf(home)));
  CHECK(UnownedEntry(scratch + "/no-such-data", *ProtectionOf(home)) == std::nullopt);

  const std::string upstreamHistory = Data("com.ardia.browser/Chromium/Default/History");
  Fresh();
  Folder(chromium + "/Default");
  Link(chromium + "/Default/History", upstreamHistory);
  CHECK(Own(chromium + "/Default"));
  CHECK(!launchAdmits());
  CHECK(unowned() == "Default/History");

  Fresh();
  Folder(chromium + "/Default/Cache/Cache_Data/index-dir");
  Folder(chromium + "/Profile 1/Local Storage");
  Link(chromium + "/Default/Cache/Cache_Data/index-dir/the-real-index", At(".config/ardia/config/config.json"));
  CHECK(unowned() == "Default/Cache/Cache_Data/index-dir/the-real-index");

  Fresh();
  Folder(chromium + "/Profile 1/Local Storage");
  Link(chromium + "/Profile 1/Local Storage/leveldb", At(".config/ardia/not-yet"));
  CHECK(unowned() == "Profile 1/Local Storage/leveldb");

  Fresh();
  Folder(chromium + "/Default");
  CHECK(link(upstreamHistory.c_str(), (chromium + "/Default/History").c_str()) == 0);
  CHECK(!launchAdmits());
  CHECK(unowned() == "Default/History");

  Fresh();
  Folder(chromium + "/Default");
  Folder(scratch + "/backup");
  File(chromium + "/Default/History");
  CHECK(link((chromium + "/Default/History").c_str(), (scratch + "/backup/History").c_str()) == 0);
  CHECK(launchAdmits());

  Fresh();
  Folder(chromium + "/Default");
  Folder(scratch + "/elsewhere/nested");
  Link(scratch + "/elsewhere/nested/Cookies", Data("com.ardia.browser/Chromium/Default/Cookies"));
  Link(chromium + "/Default/Extensions", scratch + "/elsewhere");
  CHECK(unowned() == "Default/Extensions/nested/Cookies");

  Fresh();
  Folder(chromium + "/Default");
  Folder(scratch + "/elsewhere");
  CHECK(link(upstreamHistory.c_str(), (scratch + "/elsewhere/History").c_str()) == 0);
  Link(chromium + "/Default/Extensions", scratch + "/elsewhere");
  CHECK(unowned() == "Default/Extensions/History");

  Fresh();
  Folder(chromium + "/Default/Cache");
  File(chromium + "/Default/Cache/data_0");
  Link(chromium + "/Default/Cache/loop", chromium + "/Default");
  Link(chromium + "/Default/Cache/self", "self");
  CHECK(unowned() == "Default/Cache/self");
  unlink((chromium + "/Default/Cache/self").c_str());
  CHECK(launchAdmits());

  Fresh();
  Folder(chromium + "/Default");
  Folder(scratch + "/hop");
  Link(scratch + "/hop/support", At("Library/Application Support"));
  Link(chromium + "/Default/Web Data", scratch + "/hop/support/com.ardia.browser/Chromium/Default/Web Data");
  CHECK(unowned() == "Default/Web Data");

  if (geteuid() != 0) {
    Fresh();
    Folder(chromium + "/Default/locked");
    chmod((chromium + "/Default/locked").c_str(), 0);
    CHECK(unowned() == "Default/locked");
    chmod((chromium + "/Default/locked").c_str(), 0755);
  }

  Fresh();
  Folder(chromium + "/Default/Cache/Cache_Data");
  for (int i = 0; i < 200; i++) File(chromium + "/Default/Cache/Cache_Data/f_" + std::to_string(i));
  Link(chromium + "/SingletonLock", "nilla-host-4242");
  Link(chromium + "/SingletonSocket", scratch + "/tmp-socket-dir/SingletonSocket");
  CHECK(launchAdmits());

  Fresh();
  Folder(chromium);
  const auto protection = *ProtectionOf(home);
  const auto roots = protection.roots;
  CHECK(IsOwnEntry(chromium, "Profile 2", protection));
  Link(chromium + "/Profile 2", Data("com.ardia.browser/Chromium/Profile 2"));
  CHECK(!IsOwnEntry(chromium, "Profile 2", protection));
  Fresh();
  Folder(chromium + "/Profile 2");
  CHECK(IsOwnEntry(chromium, "Profile 2", protection));
  Link(chromium + "/Profile 2/History", upstreamHistory);
  CHECK(!IsOwnEntry(chromium, "Profile 2", protection));
  unlink((chromium + "/Profile 2/History").c_str());
  CHECK(link(upstreamHistory.c_str(), (chromium + "/Profile 2/History").c_str()) == 0);
  CHECK(!IsOwnEntry(chromium, "Profile 2", protection));
  for (const char *name : {"", ".", "..", "Profile a/../../../.config/ardia", "Profile /x", "a/b"}) CHECK(!IsEntryName(name));
  for (const char *name : {"Default", "Profile 1", "Profile ..", "Profile .", "Guest Profile"}) CHECK(IsEntryName(name));

  Fresh();
  CHECK(ReachesProtected(At(".config/ardia/x"), "", roots));
  CHECK(ReachesProtected("x", At(".config/ardia"), roots));
  CHECK(!ReachesProtected("x", scratch, roots));
  CHECK(ReachesProtected("x", "", roots));
  CHECK(ReachesProtected(scratch + "/missing/../x", "", roots));
  CHECK(!ReachesProtected(scratch + "/" + std::string(NAME_MAX + 1, 'a') + "/../home/.config/ardia", "", roots));
  Link(scratch + "/dangling", At(".config/ardia/new-file"));
  CHECK(ReachesProtected(scratch + "/dangling", "", roots));
  Link(scratch + "/dangling-elsewhere", scratch + "/not-there");
  CHECK(!ReachesProtected(scratch + "/dangling-elsewhere", "", roots));

#if __APPLE__
  Fresh();
  Folder(chromium);
  Link(chromium + "/DEFAULT", Data("com.ardia.browser/Chromium/Default"));
  CHECK(unowned() == "DEFAULT");
  CHECK(!IsOwnEntry(chromium, "Default", *ProtectionOf(home)));
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
