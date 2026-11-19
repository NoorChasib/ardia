#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_OPTIONS(NSUInteger, NillaLaunchMilestone) {
  NillaLaunchEngineStarted = 1 << 0,
  NillaLaunchAppKitWillFinish = 1 << 1,
  NillaLaunchAppKitDidFinish = 1 << 2,
  NillaLaunchJSStarted = 1 << 3,
};

@interface NillaLaunchSequence : NSObject

@property(class, readonly) NillaLaunchSequence *shared;

@property(nonatomic) BOOL engineRunning;
@property(nonatomic) double mainStartedAt;
@property(nonatomic) double startupPreparedAt;
@property(nonatomic) double chromiumEnteredAt;
@property(nonatomic) double appKitWillFinishAt;
@property(nonatomic) double appKitDidFinishAt;
@property(nonatomic) double engineStartedAt;
@property(nonatomic) double reactNativeStartedAt;
@property(nonatomic) double earlyWindowShownAt;
@property(nonatomic, readonly) BOOL launchedHidden;
@property(nonatomic, readonly) BOOL launchedForDocuments;
@property(nonatomic, readonly) BOOL shutDown;

- (BOOL)reached:(NillaLaunchMilestone)milestones;
- (void)reach:(NillaLaunchMilestone)milestone;
- (void)appKitFinishedHidden:(BOOL)hidden forDocuments:(BOOL)documents;
- (void)after:(NillaLaunchMilestone)milestones do:(dispatch_block_t)block;
- (void)engineShutDown;

@end

NS_ASSUME_NONNULL_END
