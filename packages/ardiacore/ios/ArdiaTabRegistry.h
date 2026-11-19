#import "ArdiaCore.h"

@class NillaWebView;

NS_ASSUME_NONNULL_BEGIN

@interface NillaTabRegistry : NSObject
+ (void)setView:(nullable NillaWebView *)view forTab:(ArdiaCoreTab *)tab;
+ (nullable NillaWebView *)viewForTab:(ArdiaCoreTab *)tab;
+ (NSString *)offerTab:(ArdiaCoreTab *)tab;
+ (NSString *)offerTab:(ArdiaCoreTab *)tab prefix:(NSString *)prefix;
+ (nullable ArdiaCoreTab *)takeOffered:(NSString *)adoptId;
+ (nullable ArdiaCoreTab *)offeredTab:(NSString *)adoptId;
+ (void)expectFirstShowFocus:(BOOL)expects forTab:(ArdiaCoreTab *)tab;
+ (BOOL)takeFirstShowFocusOfTab:(ArdiaCoreTab *)tab;
+ (void)forget:(ArdiaCoreTab *)tab;
@end

NS_ASSUME_NONNULL_END
