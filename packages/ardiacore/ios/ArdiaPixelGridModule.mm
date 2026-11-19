#import <AppKit/AppKit.h>
#import <React/RCTBridge.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTInvalidating.h>
#import <React/RCTRootView.h>
#import <React/RCTShadowView.h>
#import <React/RCTUIManager.h>
#import <React/RCTUIManagerObserverCoordinator.h>
#import <React/RCTUIManagerUtils.h>
#import <yoga/Yoga.h>

#include <atomic>

#import "ArdiaChromeWindowHost.h"
#import "ArdiaInterfaceScale.h"

namespace {

enum { kRelayoutNone, kRelayoutAsked, kRelayoutRunning };

CGFloat CoarsestRootWindowScale(BOOL visibleOnly) {
  CGFloat coarsest = 0;
  for (NSWindow *window in NSApp.windows) {
    const CGFloat scale = window.backingScaleFactor;
    if ((visibleOnly && !window.visible) || scale <= 0 || (coarsest > 0 && scale >= coarsest) || ![NillaInterfaceScale rootOfWindow:window]) continue;
    coarsest = scale;
  }
  return coarsest;
}

CGFloat CoarsestReactWindowScale() {
  const CGFloat shown = CoarsestRootWindowScale(YES);
  return shown > 0 ? shown : CoarsestRootWindowScale(NO);
}

NSArray<NSNotificationName> *GridChangingNotifications() {
  return @[
    NillaInterfaceScaleDidChange, NillaInterfaceScaleRootDidAttach, NSWindowDidChangeBackingPropertiesNotification, NSWindowDidChangeScreenNotification, NSWindowDidChangeOcclusionStateNotification,
    NSWindowWillCloseNotification, NSApplicationDidChangeScreenParametersNotification
  ];
}

}

@interface NillaPixelGridModule : NSObject <RCTBridgeModule, RCTInvalidating, RCTUIManagerObserver>
@end

@implementation NillaPixelGridModule {
  NSMutableArray<id> *_observers;
  CGFloat _applied;
  BOOL _pending;
  BOOL _observesMounting;
  std::atomic<int> _relayout;
}

@synthesize bridge = _bridge;

RCT_EXPORT_MODULE(ACPixelGrid)

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

- (instancetype)init {
  if ((self = [super init])) {
    _observers = [NSMutableArray array];
    __weak NillaPixelGridModule *weakSelf = self;
    for (NSNotificationName name in GridChangingNotifications()) {
      [_observers addObject:[NSNotificationCenter.defaultCenter addObserverForName:name
                                                                           object:nil
                                                                            queue:NSOperationQueue.mainQueue
                                                                       usingBlock:^(NSNotification *) {
                                                                         [weakSelf followWindowsSoon];
                                                                       }]];
    }
    [self followWindowsSoon];
  }
  return self;
}

- (void)invalidate {
  if (_observesMounting) [_bridge.uiManager.observerCoordinator removeObserver:self];
  NSArray<id> *observers = _observers;
  _observers = nil;
  dispatch_async(dispatch_get_main_queue(), ^{
    for (id observer in observers) [NSNotificationCenter.defaultCenter removeObserver:observer];
  });
}

- (void)followWindowsSoon {
  if (_pending || !_observers) return;
  _pending = YES;
  __weak NillaPixelGridModule *weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    NillaPixelGridModule *me = weakSelf;
    if (!me) return;
    me->_pending = NO;
    [me followWindows];
  });
}

- (void)followWindows {
  const CGFloat scale = CoarsestReactWindowScale() * NillaInterfaceScale.scale;
  RCTUIManager *uiManager = _bridge.uiManager;
  if (scale <= 0 || scale == _applied || !uiManager || !_observers) return;
  _applied = scale;
  if (!_observesMounting) {
    _observesMounting = YES;
    [uiManager.observerCoordinator addObserver:self];
  }
  __weak NillaPixelGridModule *weakSelf = self;
  RCTExecuteOnUIManagerQueue(^{
    YGConfigRef config = [RCTShadowView yogaConfig];
    if (YGConfigGetPointScaleFactor(config) == (float)scale) return;
    YGConfigSetPointScaleFactor(config, (float)scale);
    if (NillaPixelGridModule *me = weakSelf) me->_relayout = kRelayoutAsked;
    [uiManager setNeedsLayout];
  });
}

- (void)uiManagerWillPerformLayout:(RCTUIManager *)manager {
  int asked = kRelayoutAsked;
  _relayout.compare_exchange_strong(asked, kRelayoutRunning);
}

- (void)uiManagerDidPerformMounting:(RCTUIManager *)manager {
  int running = kRelayoutRunning;
  if (!_relayout.compare_exchange_strong(running, kRelayoutNone)) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    [NillaInterfaceScale layoutSettled];
  });
}

@end
