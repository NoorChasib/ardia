#pragma once

#include <Security/Security.h>

namespace nilla_signing {

enum class Team { absent, present, unknown };

inline bool RefusesToStart(Team team) { return team != Team::absent; }

using CopySelf = OSStatus (*)(SecCSFlags, SecCodeRef *);
using CopyInformation = OSStatus (*)(SecStaticCodeRef, SecCSFlags, CFDictionaryRef *);

inline Team ReadTeam(CopySelf copySelf = SecCodeCopySelf, CopyInformation copyInformation = SecCodeCopySigningInformation) {
  SecCodeRef code = nullptr;
  const OSStatus copied = copySelf(kSecCSDefaultFlags, &code);
  if (copied != errSecSuccess || !code) {
    if (code) CFRelease(code);
    return Team::unknown;
  }
  CFDictionaryRef info = nullptr;
  const OSStatus status = copyInformation((SecStaticCodeRef)code, kSecCSSigningInformation, &info);
  CFRelease(code);
  if (status != errSecSuccess || !info) {
    if (info) CFRelease(info);
    return Team::unknown;
  }
  const Team team = CFDictionaryGetValue(info, kSecCodeInfoTeamIdentifier) ? Team::present : Team::absent;
  CFRelease(info);
  return team;
}

}
