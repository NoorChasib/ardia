#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <string_view>

#include <shlobj.h>

namespace Nilla::Paths {

inline std::string Utf8(std::wstring_view wide) noexcept {
  if (wide.empty()) return {};
  int size = WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()), nullptr, 0, nullptr, nullptr);
  std::string utf8(static_cast<size_t>(size), '\0');
  WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()), utf8.data(), size, nullptr, nullptr);
  return utf8;
}

inline std::wstring Wide(std::string_view utf8) noexcept {
  if (utf8.empty()) return {};
  int size = MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), nullptr, 0);
  std::wstring wide(static_cast<size_t>(size), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), wide.data(), size);
  return wide;
}

inline std::wstring Environment(const wchar_t *name) noexcept {
  DWORD size = GetEnvironmentVariableW(name, nullptr, 0);
  if (size == 0) return {};
  std::wstring value(size, L'\0');
  DWORD written = GetEnvironmentVariableW(name, value.data(), size);
  value.resize(written);
  return value;
}

inline std::filesystem::path KnownFolder(REFKNOWNFOLDERID folder) noexcept {
  PWSTR raw = nullptr;
  std::filesystem::path found;
  if (SUCCEEDED(SHGetKnownFolderPath(folder, KF_FLAG_CREATE, nullptr, &raw)) && raw) found = raw;
  if (raw) CoTaskMemFree(raw);
  return found;
}

inline std::filesystem::path UserFolder(REFKNOWNFOLDERID folder, const wchar_t *variable) noexcept {
  std::filesystem::path found = KnownFolder(folder);
  if (!found.empty()) return found;
  std::wstring fromEnvironment = Environment(variable);
  if (!fromEnvironment.empty()) return fromEnvironment;
  std::error_code ignored;
  return std::filesystem::temp_directory_path(ignored);
}

inline std::filesystem::path Ensured(std::filesystem::path directory) noexcept {
  std::error_code ignored;
  std::filesystem::create_directories(directory, ignored);
  return directory;
}

inline std::optional<std::wstring> FinalPathOf(HANDLE handle, DWORD volume) noexcept {
  DWORD flags = volume | FILE_NAME_NORMALIZED;
  DWORD size = GetFinalPathNameByHandleW(handle, nullptr, 0, flags);
  if (size == 0) return std::nullopt;
  std::wstring value(size, L'\0');
  DWORD written = GetFinalPathNameByHandleW(handle, value.data(), size, flags);
  if (written == 0 || written >= size) return std::nullopt;
  value.resize(written);
  return value;
}

inline std::optional<std::wstring> OpenedFinalPath(std::filesystem::path const &path, DWORD volume) noexcept {
  constexpr DWORD share = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
  HANDLE handle = CreateFileW(path.c_str(), 0, share, nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, nullptr);
  if (handle == INVALID_HANDLE_VALUE) return std::nullopt;
  std::optional<std::wstring> found = FinalPathOf(handle, volume);
  CloseHandle(handle);
  return found;
}

inline std::optional<std::wstring> Resolved(std::filesystem::path const &path, DWORD volume) noexcept {
  std::error_code error;
  std::filesystem::file_status entry = std::filesystem::symlink_status(path, error);
  if (error && error != std::errc::no_such_file_or_directory) return std::nullopt;
  if (std::filesystem::exists(entry)) {
    if (!std::filesystem::exists(path, error)) return std::nullopt;
    return OpenedFinalPath(path, volume);
  }
  if (!path.has_parent_path() || path.parent_path() == path || !path.has_filename()) return std::nullopt;
  std::optional<std::wstring> parent = Resolved(path.parent_path(), volume);
  if (!parent) return std::nullopt;
  std::wstring joined = *parent;
  if (joined.empty() || joined.back() != L'\\') joined.push_back(L'\\');
  return joined + path.filename().wstring();
}

inline std::wstring OneDriveFolder() noexcept {
  for (wchar_t const *variable : {L"OneDrive", L"OneDriveConsumer", L"OneDriveCommercial"}) {
    std::wstring folder = Environment(variable);
    DWORD attributes = folder.empty() ? INVALID_FILE_ATTRIBUTES : GetFileAttributesW(folder.c_str());
    if (attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY)) return folder;
  }
  return {};
}

inline std::wstring const &RequestedDataDirectory() noexcept {
  static const std::wstring requested = Environment(L"ARDIA_DATA_DIR");
  return requested;
}

inline bool HasCustomDataDirectory() noexcept {
  return !RequestedDataDirectory().empty();
}

inline const std::filesystem::path &DataDirectory() noexcept {
  static const std::filesystem::path directory = [] {
    std::wstring const &chosen = RequestedDataDirectory();
    return Ensured(chosen.empty() ? UserFolder(FOLDERID_LocalAppData, L"LOCALAPPDATA") / L"Nilla" : std::filesystem::path(chosen));
  }();
  return directory;
}

inline bool HasSwitch(std::wstring_view name) noexcept {
  int count = 0;
  LPWSTR *arguments = CommandLineToArgvW(GetCommandLineW(), &count);
  if (!arguments) return false;
  bool found = false;
  for (int i = 1; i < count && !found; i++) found = name == arguments[i];
  LocalFree(arguments);
  return found;
}

}
