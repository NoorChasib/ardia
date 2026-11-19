#include "../ios/NillaTeamSigning.h"

#include <cstdio>

using namespace nilla_signing;

static int failures = 0;
#define CHECK(cond)                                                \
  do {                                                             \
    if (!(cond)) {                                                 \
      std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);  \
      failures++;                                                  \
    }                                                              \
  } while (0)

static int selfCalls, informationCalls;
static OSStatus selfStatus;
static bool selfGivesCode;
static OSStatus informationStatus;
enum class Information { none, unsigned_, team };
static Information information;

static OSStatus FakeCopySelf(SecCSFlags, SecCodeRef *code) {
  selfCalls++;
  *code = selfGivesCode ? (SecCodeRef)CFStringCreateWithCString(nullptr, "code", kCFStringEncodingUTF8) : nullptr;
  return selfStatus;
}

static OSStatus FakeCopyInformation(SecStaticCodeRef, SecCSFlags, CFDictionaryRef *info) {
  informationCalls++;
  if (information == Information::none) {
    *info = nullptr;
  } else {
    CFMutableDictionaryRef made = CFDictionaryCreateMutable(nullptr, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFDictionarySetValue(made, kSecCodeInfoIdentifier, CFSTR("com.nilladigital.nilla"));
    if (information == Information::team) CFDictionarySetValue(made, kSecCodeInfoTeamIdentifier, CFSTR("ABCDE12345"));
    *info = made;
  }
  return informationStatus;
}

static Team Read(OSStatus self, bool code, OSStatus status, Information info) {
  selfCalls = informationCalls = 0;
  selfStatus = self;
  selfGivesCode = code;
  informationStatus = status;
  information = info;
  return ReadTeam(FakeCopySelf, FakeCopyInformation);
}

int main() {
  CHECK(Read(errSecSuccess, true, errSecSuccess, Information::unsigned_) == Team::absent);
  CHECK(selfCalls == 1 && informationCalls == 1);
  CHECK(!RefusesToStart(Team::absent));

  CHECK(Read(errSecSuccess, true, errSecSuccess, Information::team) == Team::present);
  CHECK(RefusesToStart(Team::present));

  CHECK(Read(errSecCSUnsigned, false, errSecSuccess, Information::unsigned_) == Team::unknown);
  CHECK(selfCalls == 1 && informationCalls == 0);
  CHECK(Read(errSecCSUnsigned, true, errSecSuccess, Information::unsigned_) == Team::unknown);
  CHECK(informationCalls == 0);
  CHECK(Read(errSecSuccess, false, errSecSuccess, Information::unsigned_) == Team::unknown);
  CHECK(informationCalls == 0);

  CHECK(Read(errSecSuccess, true, errSecCSSignatureInvalid, Information::none) == Team::unknown);
  CHECK(selfCalls == 1 && informationCalls == 1);
  CHECK(Read(errSecSuccess, true, errSecCSSignatureInvalid, Information::unsigned_) == Team::unknown);
  CHECK(Read(errSecSuccess, true, errSecSuccess, Information::none) == Team::unknown);
  CHECK(RefusesToStart(Team::unknown));

  const Team self = ReadTeam();
  std::printf("this test binary reads as %s\n", self == Team::absent ? "no team" : self == Team::present ? "team" : "unknown");

  if (failures) {
    std::printf("%d failure(s)\n", failures);
    return 1;
  }
  std::printf("team-signing: ok\n");
  return 0;
}
