#pragma once

#include <algorithm>
#include <cerrno>
#include <climits>
#include <cstdlib>
#include <optional>
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

inline std::optional<std::string> OwnPath(const std::string &path, const std::string &home) {
  const auto resolved = Resolve(path);
  if (!resolved) return std::nullopt;
  const auto candidate = Comparable(*resolved);
  if (!candidate) return std::nullopt;
  for (const auto &folder : Folders(home)) {
    const auto root = Resolve(folder, true);
    if (!root) return std::nullopt;
    const auto comparableRoot = Comparable(*root);
    if (!comparableRoot) return std::nullopt;
    if (*candidate == *comparableRoot || candidate->rfind(*comparableRoot + "/", 0) == 0) return std::nullopt;
  }
  return resolved;
}

#ifdef __OBJC__
inline bool IsOwnFolder(NSString *path) {
  if (!path.length) return false;
  return OwnPath(path.fileSystemRepresentation, NSHomeDirectory().fileSystemRepresentation).has_value();
}
#endif

}
