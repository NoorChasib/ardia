#pragma once

#include <cctype>
#include <string_view>

namespace nilla_switches {

inline constexpr std::string_view kUserDataDir = "user-data-dir";

inline std::string_view SwitchName(std::string_view arg) {
  if (arg.size() < 2 || arg[0] != '-' || arg == "--") return {};
  arg.remove_prefix(arg[1] == '-' ? 2 : 1);
  return arg.substr(0, arg.find('='));
}

inline bool StartsIgnoringCase(std::string_view text, std::string_view start) {
  if (text.size() < start.size()) return false;
  for (size_t i = 0; i < start.size(); i++)
    if (std::tolower((unsigned char)text[i]) != std::tolower((unsigned char)start[i])) return false;
  return true;
}

inline bool NamesUserDataDir(std::string_view arg) {
  const std::string_view name = SwitchName(arg);
  return name.size() == kUserDataDir.size() && StartsIgnoringCase(name, kUserDataDir);
}

inline bool IsReserved(std::string_view arg, std::string_view enginePrefix) {
  const std::string_view name = SwitchName(arg);
  return !name.empty() && (NamesUserDataDir(arg) || (!enginePrefix.empty() && StartsIgnoringCase(name, enginePrefix)));
}

}
