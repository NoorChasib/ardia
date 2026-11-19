#import "../ios/ArdiaLaunchConfig.h"

#include <cstdio>

static int failures = 0;
#define CHECK(cond)                                                \
  do {                                                             \
    if (!(cond)) {                                                 \
      std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);  \
      failures++;                                                  \
    }                                                              \
  } while (0)

static NSString *gScratch;

static void Write(NSString *name, NSString *text) {
  [[text dataUsingEncoding:NSUTF8StringEncoding] writeToFile:[gScratch stringByAppendingPathComponent:name] atomically:YES];
}

static NillaLaunchConfig *Config(NSDictionary<NSString *, NSString *> *extra, BOOL signedForDistribution = NO) {
  NSMutableDictionary<NSString *, NSString *> *environment = [@{@"ARDIA_DATA_DIR" : gScratch} mutableCopy];
  [environment addEntriesFromDictionary:extra];
  return [[NillaLaunchConfig alloc] initWithEnvironment:environment signedForDistribution:^BOOL { return signedForDistribution; }];
}

static NSDictionary<NSString *, NSString *> *Services(NSString *name, NSString *json) {
  Write(name, json);
  return @{@"ARDIA_TEST" : [@"services=" stringByAppendingString:[gScratch stringByAppendingPathComponent:name]]};
}

int main() {
  @autoreleasepool {
    gScratch = [NSTemporaryDirectory() stringByAppendingPathComponent:NSUUID.UUID.UUIDString];
    [NSFileManager.defaultManager createDirectoryAtPath:gScratch withIntermediateDirectories:YES attributes:nil error:nil];
    Write(@"switches-cache.json", @"{\"fetchedAt\":1,\"switches\":{\"launchTab\":false,\"updatePrewarm\":false}}");

    NillaLaunchConfig *bare = Config(@{});
    CHECK(!bare.remoteSwitchesConfigured);
    CHECK([bare switchOn:@"launchTab"]);
    CHECK([bare switchOn:@"updatePrewarm"]);

    NillaLaunchConfig *nullEndpoint = Config(Services(@"null.json", @"{\"switchesUrl\":null,\"issueUrl\":\"https://github.com/NoorChasib/nilla/issues/new\"}"));
    CHECK(!nullEndpoint.remoteSwitchesConfigured);
    CHECK([nullEndpoint switchOn:@"launchTab"]);

    NillaLaunchConfig *httpEndpoint = Config(Services(@"http.json", @"{\"switchesUrl\":\"http://switches.example.test/switches.json\"}"));
    CHECK(!httpEndpoint.remoteSwitchesConfigured);
    CHECK([httpEndpoint switchOn:@"launchTab"]);

    NillaLaunchConfig *refused = Config(Services(@"refused.json", @"{\"switchesUrl\":\"https://switches.example.test/switches.json\",\"switchesURL\":\"x\"}"));
    CHECK(!refused.remoteSwitchesConfigured);
    CHECK([refused switchOn:@"launchTab"]);

    NillaLaunchConfig *badRepo = Config(Services(@"repo.json", @"{\"switchesUrl\":\"https://switches.example.test/switches.json\",\"sourceRepo\":\"no slash\"}"));
    CHECK(!badRepo.remoteSwitchesConfigured);

    NillaLaunchConfig *unreadable = Config(@{@"ARDIA_TEST" : [@"services=" stringByAppendingString:[gScratch stringByAppendingPathComponent:@"missing.json"]]});
    CHECK(!unreadable.remoteSwitchesConfigured);
    CHECK([unreadable switchOn:@"launchTab"]);

    NSDictionary<NSString *, NSString *> *configured = Services(@"on.json", @"{\"switchesUrl\":\"https://switches.example.test/switches.json\",\"ingestKeys\":null,\"windowsTrustedPrefix\":\"https://u.example.test/r/\"}");
    NillaLaunchConfig *trusted = Config(configured);
    CHECK(trusted.remoteSwitchesConfigured);
    CHECK(![trusted switchOn:@"launchTab"]);
    CHECK(![trusted switchOn:@"updatePrewarm"]);
    CHECK([trusted switchOn:@"serverWindowDrag"]);

    NillaLaunchConfig *distribution = Config(configured, YES);
    CHECK(!distribution.remoteSwitchesConfigured);
    CHECK([distribution switchOn:@"launchTab"]);

    NillaLaunchConfig *local = Config(@{@"ARDIA_SWITCHES" : @"launchTab=off,updatePrewarm=on"});
    CHECK(![local switchOn:@"launchTab"]);
    CHECK([local switchOn:@"updatePrewarm"]);

    NSMutableDictionary<NSString *, NSString *> *both = [configured mutableCopy];
    both[@"ARDIA_SWITCHES"] = @"launchTab=on";
    NillaLaunchConfig *overridden = Config(both);
    CHECK([overridden switchOn:@"launchTab"]);
    CHECK(![overridden switchOn:@"updatePrewarm"]);

    [NSFileManager.defaultManager removeItemAtPath:gScratch error:nil];
  }
  if (failures) return 1;
  std::printf("launch-config-switches: ok\n");
  return 0;
}
