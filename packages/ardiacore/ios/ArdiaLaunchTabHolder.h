#import "ArdiaTabParking.h"

@class NillaWebView;

@interface NillaLaunchTabHolder : NSObject <NillaParkedPageHolder>
@property (nonatomic, copy) NSString *url;
@property (nonatomic, copy) NSString *profile;
@property (nonatomic, readonly) BOOL closedByChrome;
- (void)replayTo:(NillaWebView *)view tab:(ArdiaCoreTab *)tab;
@end
