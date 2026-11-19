#import "ArdiaCore.h"

@class NillaWebView;

NS_ASSUME_NONNULL_BEGIN

@interface NillaWindowController : NSObject <ArdiaCoreWindowDelegate>
+ (nullable NillaWindowController *)forNSWindow:(nullable NSWindow *)window;
+ (NSArray<NillaWindowController *> *)all;
@property(nonatomic, readonly) ArdiaCoreWindow *coreWindow;
@property(nonatomic, strong, nullable) NSView *root;
@property(nonatomic) NSInteger hostChanges;
@property(nonatomic, copy, nullable) NSString *appWindowId;
+ (NillaWindowController *)strayWindowForProfile:(ArdiaCoreProfile *)profile;
+ (nullable NillaWindowController *)chromeMadeWindowForProfile:(ArdiaCoreProfile *)profile;
@property(nonatomic, readonly) BOOL stray;
+ (NillaWindowController *)standaloneWindowForProfile:(ArdiaCoreProfile *)profile;
@property(nonatomic, readonly) BOOL standalone;
- (void)noteClosing:(ArdiaCoreTab *)tab;
+ (nullable NillaWindowController *)holding:(ArdiaCoreTab *)tab;
+ (nullable NillaWebView *)hostingViewForProfile:(nullable ArdiaCoreProfile *)profile;
+ (BOOL)userSees:(nullable NSWindow *)window;
+ (BOOL)userSeesOnlyThroughWindowServer:(nullable NSWindow *)window;
+ (void)reconsiderSightOf:(nullable NSWindow *)window;
+ (nullable instancetype)claimChromeMadeWindow:(nullable NSString *)token;
- (instancetype)initWithCoreWindow:(ArdiaCoreWindow *)coreWindow;
@end
extern NSNotificationName const NillaWindowSeenDidChange;
extern NSString *const NillaWindowSeenLeftAppKey;

NS_ASSUME_NONNULL_END
