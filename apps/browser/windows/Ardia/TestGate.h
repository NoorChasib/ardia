#pragma once

#include <filesystem>
#include <initializer_list>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include <shlobj.h>

#include "Paths.h"

namespace Nilla::TestGate {

constexpr wchar_t TestBuildMarker[] = L"Ardia.test-build";

inline std::optional<std::wstring> CanonicalPath(std::filesystem::path const &path) noexcept { return Paths::Resolved(path, VOLUME_NAME_GUID); }

inline bool SameText(std::wstring_view a, std::wstring_view b) noexcept {
  return a.size() == b.size() && CompareStringOrdinal(a.data(), static_cast<int>(a.size()), b.data(), static_cast<int>(b.size()), TRUE) == CSTR_EQUAL;
}

inline bool WithinOrSame(std::wstring_view inner, std::wstring_view outer) noexcept {
  while (!outer.empty() && outer.back() == L'\\') outer.remove_suffix(1);
  if (inner.size() < outer.size() || !SameText(inner.substr(0, outer.size()), outer)) return false;
  return inner.size() == outer.size() || inner[outer.size()] == L'\\';
}

inline bool Overlaps(std::wstring_view a, std::wstring_view b) noexcept {
  return WithinOrSame(a, b) || WithinOrSame(b, a);
}

inline std::vector<std::filesystem::path> UpstreamFolders() noexcept {
  return {
      Paths::UserFolder(FOLDERID_LocalAppData, L"LOCALAPPDATA") / L"Ardia",
      Paths::UserFolder(FOLDERID_RoamingAppData, L"APPDATA") / L"Ardia",
  };
}

inline std::vector<std::filesystem::path> RealFolders() noexcept {
  std::vector<std::filesystem::path> folders = UpstreamFolders();
  folders.push_back(Paths::UserFolder(FOLDERID_LocalAppData, L"LOCALAPPDATA") / L"Nilla");
  folders.push_back(Paths::UserFolder(FOLDERID_RoamingAppData, L"APPDATA") / L"Nilla");
  return folders;
}

inline std::wstring ClashWith(std::vector<std::filesystem::path> const &realFolders, std::initializer_list<std::filesystem::path> checked, std::wstring_view variable) noexcept {
  for (std::filesystem::path const &real : realFolders) {
    std::optional<std::wstring> canonicalReal = CanonicalPath(real);
    if (!canonicalReal) return L"the real profile folder can't be resolved";
    for (std::filesystem::path const &mine : checked) {
      if (!mine.is_absolute()) return std::wstring{variable} + L" is not an absolute path";
      std::optional<std::wstring> canonicalMine = CanonicalPath(mine);
      if (!canonicalMine) return std::wstring{variable} + L" can't be resolved on a local volume";
      if (Overlaps(*canonicalMine, *canonicalReal)) return std::wstring{variable} + L" is or overlaps the real profile folder";
    }
  }
  return {};
}

inline std::wstring RealFolderClash(std::initializer_list<std::filesystem::path> checked, std::wstring_view variable) noexcept {
  return ClashWith(RealFolders(), checked, variable);
}

inline std::wstring UpstreamClash(std::initializer_list<std::filesystem::path> checked, std::wstring_view variable) noexcept {
  return ClashWith(UpstreamFolders(), checked, variable);
}

inline bool OpenedInsideUpstream(HANDLE opened) noexcept {
  std::optional<std::wstring> final = Paths::FinalPathOf(opened, VOLUME_NAME_GUID);
  if (!final) return true;
  for (std::filesystem::path const &upstream : UpstreamFolders()) {
    std::optional<std::wstring> canonical = CanonicalPath(upstream);
    if (!canonical || WithinOrSame(*final, *canonical)) return true;
  }
  return false;
}

inline std::filesystem::path RunningFolder() noexcept {
  std::wstring path(MAX_PATH, L'\0');
  while (true) {
    DWORD length = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
    if (length == 0) return {};
    if (length < path.size()) {
      path.resize(length);
      return std::filesystem::path(path).parent_path();
    }
    if (path.size() >= 32768) return {};
    path.resize(path.size() * 2);
  }
}

inline bool TestBuild() noexcept {
  std::filesystem::path folder = RunningFolder();
  if (folder.empty()) return false;
  std::error_code error;
  return std::filesystem::is_regular_file(folder / TestBuildMarker, error);
}

inline std::wstring Refusal() noexcept {
  std::filesystem::path requested{Paths::RequestedDataDirectory()};
  if (requested.empty()) return L"no scratch ARDIA_DATA_DIR";
  if (!requested.is_absolute()) return L"ARDIA_DATA_DIR is not an absolute path";
  std::wstring clash = RealFolderClash({Paths::DataDirectory(), Paths::DataDirectory() / L"Chromium", Paths::DataDirectory() / L"Sync"}, L"ARDIA_DATA_DIR");
  if (!clash.empty()) return clash;
  if (!TestBuild()) return std::wstring{L"not a test build: no "} + TestBuildMarker + L" beside the app";
  return {};
}

}
