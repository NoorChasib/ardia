#pragma once

#include "NillaUpstreamFolders.h"

#include <algorithm>
#include <cctype>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace nilla_switches {

enum class Syntax { posix, windows };

#if defined(_WIN32)
inline constexpr Syntax kNativeSyntax = Syntax::windows;
#else
inline constexpr Syntax kNativeSyntax = Syntax::posix;
#endif

inline constexpr std::string_view kUserDataDir = "user-data-dir";
inline constexpr std::string_view kAsciiWhitespace = "\t\v\f \n\r";
inline constexpr std::string_view kUnicodeWhitespace[] = {
    "\xC2\x85",     "\xC2\xA0",     "\xE1\x9A\x80", "\xE2\x80\x80", "\xE2\x80\x81", "\xE2\x80\x82", "\xE2\x80\x83",
    "\xE2\x80\x84", "\xE2\x80\x85", "\xE2\x80\x86", "\xE2\x80\x87", "\xE2\x80\x88", "\xE2\x80\x89", "\xE2\x80\x8A",
    "\xE2\x80\xA8", "\xE2\x80\xA9", "\xE2\x80\xAF", "\xE2\x81\x9F", "\xE3\x80\x80",
};

inline size_t LeadingWhitespace(std::string_view text, Syntax syntax) {
  if (!text.empty() && kAsciiWhitespace.find(text.front()) != std::string_view::npos) return 1;
  if (syntax == Syntax::windows)
    for (std::string_view space : kUnicodeWhitespace)
      if (text.starts_with(space)) return space.size();
  return 0;
}

inline size_t TrailingWhitespace(std::string_view text, Syntax syntax) {
  if (!text.empty() && kAsciiWhitespace.find(text.back()) != std::string_view::npos) return 1;
  if (syntax == Syntax::windows)
    for (std::string_view space : kUnicodeWhitespace)
      if (text.ends_with(space)) return space.size();
  return 0;
}

inline std::string_view Trimmed(std::string_view arg, Syntax syntax = kNativeSyntax) {
  while (size_t size = LeadingWhitespace(arg, syntax)) arg.remove_prefix(size);
  while (size_t size = TrailingWhitespace(arg, syntax)) arg.remove_suffix(size);
  return arg;
}

inline size_t SwitchPrefixLength(std::string_view arg, Syntax syntax) {
  if (arg.starts_with("--")) return 2;
  if (arg.starts_with("-")) return 1;
  if (syntax == Syntax::windows && arg.starts_with("/")) return 1;
  return 0;
}

struct Switch {
  std::string name;
  std::optional<std::string> value;
};

inline std::optional<Switch> ParsedSwitch(std::string_view raw, Syntax syntax = kNativeSyntax) {
  const std::string_view arg = Trimmed(raw, syntax);
  const size_t prefix = SwitchPrefixLength(arg, syntax);
  if (prefix == 0 || prefix == arg.size()) return std::nullopt;
  const size_t equals = arg.find('=');
  std::string key(arg.substr(0, equals));
  if (syntax == Syntax::windows)
    for (char &c : key) c = (char)std::tolower((unsigned char)c);
  Switch parsed{key.substr(SwitchPrefixLength(key, syntax)), std::nullopt};
  if (equals != std::string_view::npos) parsed.value = std::string(arg.substr(equals + 1));
  return parsed;
}

inline std::string SwitchName(std::string_view arg, Syntax syntax = kNativeSyntax) {
  const auto parsed = ParsedSwitch(arg, syntax);
  return parsed ? parsed->name : std::string();
}

inline bool StartsIgnoringCase(std::string_view text, std::string_view start) {
  if (text.size() < start.size()) return false;
  for (size_t i = 0; i < start.size(); i++)
    if (std::tolower((unsigned char)text[i]) != std::tolower((unsigned char)start[i])) return false;
  return true;
}

inline bool NamesUserDataDir(std::string_view arg, Syntax syntax = kNativeSyntax) {
  const std::string name = SwitchName(arg, syntax);
  return name.size() == kUserDataDir.size() && StartsIgnoringCase(name, kUserDataDir);
}

inline bool IsReserved(std::string_view arg, std::string_view enginePrefix, Syntax syntax = kNativeSyntax) {
  const std::string name = SwitchName(arg, syntax);
  return !name.empty() && (NamesUserDataDir(arg, syntax) || (!enginePrefix.empty() && StartsIgnoringCase(name, enginePrefix)));
}

inline constexpr std::string_view kPathBoundaries = "=,;:\"'\t\v\f \n\r";
inline constexpr std::string_view kPathListSeparators[] = {",", ";", ":", "\"'", "\t\v\f \n\r"};

inline bool IsPathBoundary(char c) { return kPathBoundaries.find(c) != std::string_view::npos; }

inline std::vector<std::string_view> PathCandidates(std::string_view arg) {
  std::vector<std::string_view> candidates;
  for (size_t start = 0; start < arg.size(); start++) {
    if (IsPathBoundary(arg[start]) || (start > 0 && !IsPathBoundary(arg[start - 1]))) continue;
    std::vector<size_t> ends = {arg.size()};
    for (std::string_view separators : kPathListSeparators) ends.push_back(std::min(arg.find_first_of(separators, start), arg.size()));
    std::sort(ends.begin(), ends.end());
    ends.erase(std::unique(ends.begin(), ends.end()), ends.end());
    for (size_t end : ends) candidates.push_back(arg.substr(start, end - start));
  }
  return candidates;
}

enum class Refusal { none, userDataDir, engineSwitch, protectedPath };

struct Forwarding {
  std::string argument;
  Refusal refusal;
  std::string path;
};

inline Forwarding ForwardedArgument(std::string_view raw, std::string_view enginePrefix, const std::string &workingDirectory,
                                    const std::vector<std::string> &protectedRoots, Syntax syntax = kNativeSyntax) {
  Forwarding forwarding{std::string(Trimmed(raw, syntax)), Refusal::none, {}};
  if (NamesUserDataDir(forwarding.argument, syntax)) forwarding.refusal = Refusal::userDataDir;
  else if (IsReserved(forwarding.argument, enginePrefix, syntax)) forwarding.refusal = Refusal::engineSwitch;
  else
    for (std::string_view candidate : PathCandidates(forwarding.argument))
      if (nilla_upstream::ReachesProtected(std::string(candidate), workingDirectory, protectedRoots)) {
        forwarding.refusal = Refusal::protectedPath;
        forwarding.path = std::string(candidate);
        break;
      }
  return forwarding;
}

}
