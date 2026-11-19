#pragma once

#include <algorithm>
#include <cerrno>
#include <climits>
#include <cstdlib>
#include <cstring>
#include <dirent.h>
#include <fcntl.h>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <sys/stat.h>
#include <unistd.h>
#include <vector>

#if __APPLE__
#include <CoreFoundation/CoreFoundation.h>
#endif
#ifdef __OBJC__
#import <Foundation/Foundation.h>
#endif

namespace nilla_upstream {

inline const std::vector<std::string> &FolderSuffixes() {
  static const std::vector<std::string> suffixes = {
      ".config/ardia",
      ".local/share/ardia",
      ".local/state/ardia",
      ".cache/ardia",
      "Library/Application Support/Ardia",
      "Library/Application Support/com.ardia.browser",
      "Library/Logs/Ardia",
  };
  return suffixes;
}

inline std::vector<std::string> Folders(const std::string &home) {
  std::vector<std::string> folders;
  for (const auto &suffix : FolderSuffixes()) folders.push_back(home + (home.size() && home.back() == '/' ? "" : "/") + suffix);
  return folders;
}

constexpr int kMaxLinkHops = 40;

inline std::vector<std::string> Components(const std::string &path) {
  std::vector<std::string> parts;
  std::string part;
  for (char c : path) {
    if (c == '/') {
      if (!part.empty()) parts.push_back(part);
      part.clear();
    } else {
      part.push_back(c);
    }
  }
  if (!part.empty()) parts.push_back(part);
  return parts;
}

inline std::string Joined(const std::vector<std::string> &parts) {
  if (parts.empty()) return "/";
  std::string path;
  for (const auto &part : parts) path += "/" + part;
  return path;
}

inline std::optional<std::string> RealPath(const std::string &path) {
  char *real = realpath(path.c_str(), nullptr);
  if (!real) return std::nullopt;
  std::string result(real);
  free(real);
  return result;
}

inline std::optional<std::string> LinkTarget(const std::string &path) {
  std::vector<char> buffer(PATH_MAX + 1);
  const ssize_t count = readlink(path.c_str(), buffer.data(), buffer.size() - 1);
  if (count <= 0) return std::nullopt;
  return std::string(buffer.data(), count);
}

inline std::optional<std::string> Resolve(const std::string &path, bool followingDanglingLinks = false) {
  if (path.empty() || path[0] != '/' || path.find('\0') != std::string::npos) return std::nullopt;
  std::vector<std::string> pending = Components(path);
  std::reverse(pending.begin(), pending.end());
  std::vector<std::string> resolved;
  bool missing = false;
  int hops = 0;
  while (!pending.empty()) {
    const std::string part = pending.back();
    pending.pop_back();
    if (part == ".") continue;
    if (part == "..") {
      if (missing) return std::nullopt;
      if (!resolved.empty()) resolved.pop_back();
      continue;
    }
    if (missing) {
      resolved.push_back(part);
      continue;
    }
    std::vector<std::string> next = resolved;
    next.push_back(part);
    const std::string candidate = Joined(next);
    struct stat info;
    if (lstat(candidate.c_str(), &info) == 0) {
      if (auto real = RealPath(candidate)) {
        resolved = Components(*real);
      } else if (followingDanglingLinks && S_ISLNK(info.st_mode) && hops < kMaxLinkHops) {
        auto target = LinkTarget(candidate);
        if (!target) return std::nullopt;
        hops++;
        if ((*target)[0] == '/') resolved.clear();
        std::vector<std::string> inner = Components(*target);
        pending.insert(pending.end(), inner.rbegin(), inner.rend());
      } else {
        return std::nullopt;
      }
    } else if (errno == ENOENT) {
      missing = true;
      resolved.push_back(part);
    } else {
      return std::nullopt;
    }
  }
  return Joined(resolved);
}

inline std::optional<std::string> Comparable(const std::string &path) {
  std::string trimmed = path.size() > 1 && path.back() == '/' ? path.substr(0, path.size() - 1) : path;
#if __APPLE__
  CFStringRef text = CFStringCreateWithBytes(nullptr, (const UInt8 *)trimmed.data(), (CFIndex)trimmed.size(), kCFStringEncodingUTF8, false);
  if (!text) return std::nullopt;
  CFMutableStringRef folded = CFStringCreateMutableCopy(nullptr, 0, text);
  CFRelease(text);
  if (!folded) return std::nullopt;
  CFStringNormalize(folded, kCFStringNormalizationFormC);
  CFStringLowercase(folded, nullptr);
  const CFIndex size = CFStringGetMaximumSizeForEncoding(CFStringGetLength(folded), kCFStringEncodingUTF8) + 1;
  std::vector<char> buffer(size);
  const bool converted = CFStringGetCString(folded, buffer.data(), size, kCFStringEncodingUTF8);
  CFRelease(folded);
  if (!converted) return std::nullopt;
  trimmed = buffer.data();
#endif
  return trimmed;
}

inline std::optional<std::vector<std::string>> ProtectedRoots(const std::string &home) {
  std::vector<std::string> roots;
  for (const auto &folder : Folders(home)) {
    const auto root = Resolve(folder, true);
    if (!root) return std::nullopt;
    const auto comparableRoot = Comparable(*root);
    if (!comparableRoot) return std::nullopt;
    roots.push_back(*comparableRoot);
  }
  return roots;
}

inline bool InsideRoots(const std::string &comparable, const std::vector<std::string> &roots) {
  for (const auto &root : roots)
    if (comparable == root || comparable.rfind(root == "/" ? root : root + "/", 0) == 0) return true;
  return false;
}

inline std::optional<std::string> OwnPath(const std::string &path, const std::string &home) {
  const auto resolved = Resolve(path);
  if (!resolved) return std::nullopt;
  const auto candidate = Comparable(*resolved);
  if (!candidate) return std::nullopt;
  const auto roots = ProtectedRoots(home);
  if (!roots || InsideRoots(*candidate, *roots)) return std::nullopt;
  return resolved;
}

inline bool CanName(const std::string &path) {
  if (path.empty() || path.size() >= PATH_MAX) return false;
  for (const auto &part : Components(path))
    if (part.size() > NAME_MAX) return false;
  return true;
}

inline bool ReachesProtected(const std::string &path, const std::string &workingDirectory, const std::vector<std::string> &roots) {
  if (!CanName(path)) return false;
  if (path[0] != '/' && (workingDirectory.empty() || workingDirectory[0] != '/')) return true;
  const auto resolved = Resolve(path[0] == '/' ? path : workingDirectory + "/" + path, true);
  if (!resolved) return true;
  const auto comparable = Comparable(*resolved);
  return !comparable || InsideRoots(*comparable, roots);
}

inline bool IsEntryName(const std::string &name) {
  return !name.empty() && name != "." && name != ".." && name.find('/') == std::string::npos && name.find('\0') == std::string::npos;
}

using FileIdentity = std::pair<dev_t, ino_t>;

inline FileIdentity IdentityOf(const struct stat &info) { return {info.st_dev, info.st_ino}; }

struct Protection {
  std::vector<std::string> roots;
  std::vector<std::string> folders;
  std::set<FileIdentity> identities;
};

inline std::optional<Protection> ProtectionOf(const std::string &home) {
  auto roots = ProtectedRoots(home);
  if (!roots) return std::nullopt;
  Protection protection{std::move(*roots), {}, {}};
  for (const auto &folder : Folders(home)) {
    const auto resolved = Resolve(folder, true);
    if (!resolved) return std::nullopt;
    protection.folders.push_back(*resolved);
    struct stat info;
    if (stat(resolved->c_str(), &info) == 0) protection.identities.insert(IdentityOf(info));
  }
  return protection;
}

inline bool PassesThroughProtected(const std::string &absolute, const Protection &protection) {
  std::string prefix;
  for (const auto &part : Components(absolute)) {
    prefix += "/" + part;
    struct stat info;
    if (stat(prefix.c_str(), &info) != 0) return false;
    if (protection.identities.count(IdentityOf(info))) return true;
  }
  return false;
}

inline bool LeadsIntoProtected(const std::string &absolute, const Protection &protection) {
  if (ReachesProtected(absolute, "", protection.roots) || PassesThroughProtected(absolute, protection)) return true;
  const auto resolved = Resolve(absolute, true);
  return !resolved || PassesThroughProtected(*resolved, protection);
}

enum class Listing { listed, gone, unreadable, stopped };

template <typename Visit>
inline Listing ListTree(const std::string &directory, std::string &unreadable, Visit visit) {
  unreadable.clear();
  DIR *dir = opendir(directory.c_str());
  if (!dir) return errno == ENOENT || errno == ENOTDIR ? Listing::gone : Listing::unreadable;
  const int fd = dirfd(dir);
  Listing listing = Listing::listed;
  struct stat info;
  while (const dirent *entry = readdir(dir)) {
    const char *name = entry->d_name;
    if (name[0] == '.' && (!name[1] || (name[1] == '.' && !name[2]))) continue;
    if (fstatat(fd, name, &info, AT_SYMLINK_NOFOLLOW) != 0) {
      if (errno == ENOENT) continue;
      unreadable = name;
      listing = Listing::unreadable;
      break;
    }
    if (!visit(name, info)) {
      listing = Listing::stopped;
      break;
    }
  }
  closedir(dir);
  return listing;
}

inline std::optional<std::string> SharedFileInProtected(const std::map<FileIdentity, std::string> &shared, const Protection &protection) {
  std::vector<std::string> pending(protection.folders.begin(), protection.folders.end());
  std::string unreadable;
  std::optional<std::string> found;
  while (!pending.empty() && !found) {
    const std::string directory = pending.back();
    pending.pop_back();
    const Listing listing = ListTree(directory, unreadable, [&](const char *name, const struct stat &info) {
      if (S_ISDIR(info.st_mode)) {
        pending.push_back(directory + "/" + name);
      } else if (S_ISREG(info.st_mode) && info.st_nlink > 1) {
        if (auto match = shared.find(IdentityOf(info)); match != shared.end()) found = match->second;
      }
      return !found;
    });
    if (listing == Listing::unreadable) return shared.begin()->second;
  }
  return found;
}

inline std::optional<std::string> UnownedWithin(const std::string &directory, const std::string &label, const Protection &protection) {
  if (LeadsIntoProtected(directory, protection)) return label;
  std::set<FileIdentity> walked;
  std::map<FileIdentity, std::string> shared;
  std::vector<std::pair<std::string, std::string>> pending = {{directory, label}};
  struct stat top;
  if (stat(directory.c_str(), &top) == 0) walked.insert(IdentityOf(top));
  std::string unreadable;
  std::optional<std::string> unowned;
  while (!pending.empty() && !unowned) {
    const auto [path, shown] = pending.back();
    pending.pop_back();
    const Listing listing = ListTree(path, unreadable, [&](const char *name, const struct stat &entry) {
      struct stat info = entry;
      if (S_ISLNK(entry.st_mode)) {
        const std::string linked = path + "/" + name;
        if (LeadsIntoProtected(linked, protection)) {
          unowned = shown + "/" + name;
          return false;
        }
        if (stat(linked.c_str(), &info) != 0) return true;
      }
      if (protection.identities.count(IdentityOf(info))) {
        unowned = shown + "/" + name;
        return false;
      }
      if (S_ISDIR(info.st_mode)) {
        if (walked.insert(IdentityOf(info)).second) pending.push_back({path + "/" + name, shown + "/" + name});
      } else if (S_ISREG(info.st_mode) && info.st_nlink > 1) {
        shared.emplace(IdentityOf(info), shown + "/" + name);
      }
      return true;
    });
    if (listing == Listing::unreadable) return unreadable.empty() ? shown : shown + "/" + unreadable;
  }
  if (unowned) return unowned;
  if (!shared.empty()) return SharedFileInProtected(shared, protection);
  return std::nullopt;
}

inline std::string WithinName(const std::string &label, const std::string &name) {
  return name.size() > label.size() + 1 ? name.substr(label.size() + 1) : name;
}

inline bool IsOwnEntry(const std::string &dataDirectory, const std::string &name, const Protection &protection) {
  return IsEntryName(name) && !UnownedWithin(dataDirectory + "/" + name, name, protection);
}

inline constexpr const char *kDefaultProfile = "Default";

inline std::optional<std::string> UnownedEntry(const std::string &dataDirectory, const Protection &protection) {
  if (LeadsIntoProtected(dataDirectory + "/" + kDefaultProfile, protection)) return kDefaultProfile;
  const std::string label = ".";
  const auto unowned = UnownedWithin(dataDirectory, label, protection);
  if (!unowned) return std::nullopt;
  return *unowned == label ? dataDirectory : WithinName(label, *unowned);
}

#ifdef __OBJC__
inline bool IsOwnFolder(NSString *path) {
  if (!path.length) return false;
  return OwnPath(path.fileSystemRepresentation, NSHomeDirectory().fileSystemRepresentation).has_value();
}

inline std::optional<std::vector<std::string>> HomeProtectedRoots() {
  return ProtectedRoots(NSHomeDirectory().fileSystemRepresentation);
}

inline NSString *UnownedDataEntry(NSString *dataDirectory) {
  const auto protection = ProtectionOf(NSHomeDirectory().fileSystemRepresentation);
  if (!protection || !dataDirectory.length) return dataDirectory ?: @"";
  const auto entry = UnownedEntry(dataDirectory.fileSystemRepresentation, *protection);
  return entry ? @(entry->c_str()) : nil;
}

inline bool IsOwnProfileFolder(NSString *dataDirectory, NSString *directoryName) {
  const auto protection = ProtectionOf(NSHomeDirectory().fileSystemRepresentation);
  return protection && dataDirectory.length && directoryName.length &&
         IsOwnEntry(dataDirectory.fileSystemRepresentation, directoryName.fileSystemRepresentation, *protection);
}
#endif

}
