#import "ArdiaLaunchSequence.h"

@interface NillaLaunchWaiter : NSObject
@property(nonatomic) NillaLaunchMilestone milestones;
@property(nonatomic, copy) dispatch_block_t block;
@end

@implementation NillaLaunchWaiter
@end

@implementation NillaLaunchSequence {
  NillaLaunchMilestone _reached;
  NSMutableArray<NillaLaunchWaiter *> *_waiters;
}

+ (NillaLaunchSequence *)shared {
  static NillaLaunchSequence *shared = [NillaLaunchSequence new];
  return shared;
}

- (instancetype)init {
  if ((self = [super init])) _waiters = [NSMutableArray array];
  return self;
}

- (BOOL)reached:(NillaLaunchMilestone)milestones {
  return (_reached & milestones) == milestones;
}

- (void)reach:(NillaLaunchMilestone)milestone {
  if (_shutDown) return;
  _reached |= milestone;
  for (;;) {
    NSUInteger ready = [_waiters indexOfObjectPassingTest:^BOOL(NillaLaunchWaiter *waiter, NSUInteger, BOOL *) {
      return [self reached:waiter.milestones];
    }];
    if (ready == NSNotFound || _shutDown) return;
    NillaLaunchWaiter *waiter = _waiters[ready];
    [_waiters removeObjectAtIndex:ready];
    waiter.block();
  }
}

- (void)appKitFinishedHidden:(BOOL)hidden forDocuments:(BOOL)documents {
  _launchedHidden = hidden;
  _launchedForDocuments = documents;
  [self reach:NillaLaunchAppKitDidFinish];
}

- (void)after:(NillaLaunchMilestone)milestones do:(dispatch_block_t)block {
  if (_shutDown) return;
  NillaLaunchWaiter *waiter = [NillaLaunchWaiter new];
  waiter.milestones = milestones;
  waiter.block = block;
  [_waiters addObject:waiter];
  [self reach:0];
}

- (void)engineShutDown {
  _engineRunning = NO;
  _shutDown = YES;
  [_waiters removeAllObjects];
}

@end
