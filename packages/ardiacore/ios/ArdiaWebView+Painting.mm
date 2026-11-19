#import "ArdiaWebViewInternal.h"
#import "ArdiaInterfaceScale.h"
#import "ArdiaEarlyWindow.h"
#import "ArdiaRuntime.h"

#import <QuartzCore/QuartzCore.h>
#import <React/UIView+React.h>

using namespace nilla_web_view;
using namespace nilla_runtime;

namespace {

constexpr CFTimeInterval kLeaveScreenDelay = 0.1;
constexpr CFTimeInterval kFirstFrameHoldSeconds = 0.25;
constexpr CFTimeInterval kHolderBackstopSeconds = kFirstFrameHoldSeconds + 0.05;
constexpr CFTimeInterval kLingeringPaneSunkSeconds = 0.5;
constexpr CFTimeInterval kSwapReportSeconds = 10;
NSString *const kLingeringPane = @"nilla.lingeringPane";
}

namespace nilla_web_view {

NSView *RenderWidgetIn(NSView *page) {
  static Class widgetClass = NSClassFromString(@"RenderWidgetHostViewCocoa");
  if (!page || !widgetClass) return nil;
  NSMutableArray<NSView *> *queue = [NSMutableArray arrayWithObject:page];
  while (queue.count) {
    NSView *view = queue.firstObject;
    [queue removeObjectAtIndex:0];
    if ([view isKindOfClass:widgetClass]) return view;
    [queue addObjectsFromArray:view.subviews];
  }
  return nil;
}

NSArray *FrameMarkOf(NSView *widget) {
  NSMutableArray *mark = [NSMutableArray array];
  for (CALayer *tree in widget.layer.sublayers)
    for (CALayer *content in tree.sublayers) {
      [mark addObject:content];
      [mark addObject:content.contents ?: NSNull.null];
    }
  return mark;
}

}

@interface NillaNeighbourWake : NSObject
@property(nonatomic) CFTimeInterval committedUntil;
@property(nonatomic) CFTimeInterval speculativeUntil;
@property(nonatomic, readonly) CFTimeInterval until;
@end

@implementation NillaNeighbourWake
- (CFTimeInterval)until {
  return MAX(_committedUntil, _speculativeUntil);
}
@end

namespace {
constexpr CGFloat kContentDriftCounted = 0.5;
constexpr CAAutoresizingMask kFillsWidget = kCALayerWidthSizable | kCALayerHeightSizable;
NSUInteger gContentDriftFits = 0;
NSUInteger gWidgetLayouts = 0;
CGFloat gContentDriftMaxPoints = 0;
}

@interface NillaWidgetLayerFit : NSObject <CALayoutManager>
@end

@implementation NillaWidgetLayerFit

+ (instancetype)shared {
  static NillaWidgetLayerFit *fit = [NillaWidgetLayerFit new];
  return fit;
}

- (void)layoutSublayersOfLayer:(CALayer *)layer {
  gWidgetLayouts++;
  const CGRect bounds = layer.bounds;
  for (CALayer *sublayer in layer.sublayers) {
    const CGRect frame = sublayer.frame;
    if (sublayer.autoresizingMask != kFillsWidget || CGRectEqualToRect(frame, bounds)) continue;
    const CGFloat drift = MAX(MAX(fabs(CGRectGetMinX(frame) - CGRectGetMinX(bounds)), fabs(CGRectGetMaxX(frame) - CGRectGetMaxX(bounds))),
                              MAX(fabs(CGRectGetMinY(frame) - CGRectGetMinY(bounds)), fabs(CGRectGetMaxY(frame) - CGRectGetMaxY(bounds))));
    if (drift >= kContentDriftCounted) {
      gContentDriftFits++;
      gContentDriftMaxPoints = MAX(gContentDriftMaxPoints, drift);
    }
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    sublayer.frame = bounds;
    [CATransaction commit];
  }
}

@end

namespace {

NSMapTable<NSWindow *, NillaNeighbourWake *> *NeighbourPagesAwake() {
  static NSMapTable *windows = [NSMapTable weakToStrongObjectsMapTable];
  return windows;
}

NSHashTable<NillaWebView *> *PendingPainting() {
  static NSHashTable *views = [NSHashTable weakObjectsHashTable];
  return views;
}
bool gPaintingScheduled = false;

NSHashTable<NillaWebView *> *AwaitingFrames() {
  static NSHashTable *views = [NSHashTable weakObjectsHashTable];
  return views;
}
bool gFrameWatchScheduled = false;

void FitRenderWidgetsIn(NSView *page) {
  static Class widgetClass = NSClassFromString(@"RenderWidgetHostViewCocoa");
  if (!page || !widgetClass) return;
  NSMutableArray<NSView *> *queue = [NSMutableArray arrayWithObject:page];
  while (queue.count) {
    NSView *view = queue.firstObject;
    [queue removeObjectAtIndex:0];
    if (![view isKindOfClass:widgetClass]) {
      [queue addObjectsFromArray:view.subviews];
      continue;
    }
    CALayer *layer = view.layer;
    if (!layer) continue;
    if (layer.layoutManager != NillaWidgetLayerFit.shared) layer.layoutManager = NillaWidgetLayerFit.shared;
    [layer setNeedsLayout];
  }
}

NSRect InWindow(NSView *view) {
  return [view convertRect:view.bounds toView:nil];
}


NSView *LingeringPaneOver(NSView *view) {
  for (NSView *ancestor = view.superview; ancestor; ancestor = ancestor.superview)
    for (NSView *sibling in ancestor.subviews)
      if ([sibling.nativeID isEqualToString:kLingeringPane] && !sibling.hidden) return sibling;
  return nil;
}

BOOL Above(NSView *a, NSView *b) {
  const CGFloat za = a.layer.zPosition, zb = b.layer.zPosition;
  if (za != zb) return za > zb;
  NSArray<NSView *> *order = a.superview.subviews;
  return [order indexOfObjectIdenticalTo:a] > [order indexOfObjectIdenticalTo:b];
}
}

@implementation NillaWebView (Painting)

- (void)setFrameSize:(NSSize)newSize {
  [super setFrameSize:newSize];
  [NillaInterfaceScale fitPageHost:self];
  [self layoutPage];
  if (_visible) [NillaEarlyWindow noteLayoutChangeIn:self.window];
}

- (void)interfaceScaleChanged {
  [NillaInterfaceScale fitPageHost:self];
  [self layoutPage];
}

- (void)setFrameOrigin:(NSPoint)newOrigin {
  [super setFrameOrigin:newOrigin];
  if (_visible) [NillaEarlyWindow noteLayoutChangeIn:self.window];
}

- (void)layoutPage {
  if (NSView *fronted = _reveal.frontedPage; fronted.superview == self) fronted.frame = self.bounds;
  if (NSView *standIn = _standIn.page; standIn.superview == self) standIn.frame = self.bounds;
  NSView *page = _tab.view;
  if (!page || page.superview != self) return;
  if (NSIsEmptyRect(self.bounds) && !NSIsEmptyRect(page.frame) && !self.paints) return;
  if (_devtoolsView) {
    NSRect devtools = NSZeroRect, pageFrame = self.bounds;
    [_tab devToolsLayoutForSize:self.bounds.size devTools:&devtools page:&pageFrame];
    _devtoolsView.frame = devtools;
    page.frame = pageFrame;
  } else {
    page.frame = self.bounds;
  }
  FitRenderWidgetsIn(page);
}

+ (NSDictionary<NSString *, NSNumber *> *)takeContentDrift {
  NSDictionary *drift = @{@"layouts" : @(gWidgetLayouts), @"fits" : @(gContentDriftFits), @"maxPoints" : @(gContentDriftMaxPoints)};
  gWidgetLayouts = 0;
  gContentDriftFits = 0;
  gContentDriftMaxPoints = 0;
  return drift;
}

- (BOOL)paints {
  return _visible || (_warm && !self.neighbourPageAsleep) || _leave.active || _reveal.active || _frameHold.holding;
}

- (BOOL)neighbourPageAsleep {
  if (!_warm || !_neighbour || _visible) return NO;
  NSWindow *window = self.window;
  if (!window) return NO;
  return [NeighbourPagesAwake() objectForKey:window].until <= CACurrentMediaTime();
}

+ (void)wakeNeighbourPagesIn:(NSWindow *)window {
  [self wakeNeighbourPagesIn:window seconds:kNeighbourPagesAwakeSeconds committed:YES];
}

+ (void)wakeNeighbourPagesIn:(NSWindow *)window seconds:(CFTimeInterval)seconds committed:(BOOL)committed {
  const CFTimeInterval now = CACurrentMediaTime();
  NillaNeighbourWake *wake = [NeighbourPagesAwake() objectForKey:window];
  const BOOL wasAwake = wake.until > now;
  if (!wake) [NeighbourPagesAwake() setObject:(wake = [NillaNeighbourWake new]) forKey:window];
  if (committed) wake.committedUntil = MAX(wake.committedUntil, now + seconds);
  else wake.speculativeUntil = MAX(wake.speculativeUntil, now + seconds);
  if (wasAwake) return;
  [self repaintWarmPagesIn:window];
  [self sleepNeighbourPagesIn:window after:seconds];
}

+ (void)releaseNeighbourPagesIn:(NSWindow *)window {
  NillaNeighbourWake *wake = [NeighbourPagesAwake() objectForKey:window];
  const CFTimeInterval now = CACurrentMediaTime();
  if (!wake || wake.speculativeUntil <= now) return;
  wake.speculativeUntil = 0;
  if (wake.committedUntil <= now) [self repaintWarmPagesIn:window];
}

+ (void)sleepNeighbourPagesIn:(NSWindow *)window after:(CFTimeInterval)delay {
  __weak NSWindow *weakWindow = window;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    NSWindow *window = weakWindow;
    NillaNeighbourWake *wake = window ? [NeighbourPagesAwake() objectForKey:window] : nil;
    if (!wake) return;
    const CFTimeInterval left = wake.until - CACurrentMediaTime();
    if (left > 0) return [self sleepNeighbourPagesIn:window after:left];
    [NeighbourPagesAwake() removeObjectForKey:window];
    [self repaintWarmPagesIn:window];
  });
}

+ (void)repaintWarmPagesIn:(NSWindow *)window {
  for (NillaWebView *view in LiveViews().allObjects)
    if (view->_warm && view.window == window) [view schedulePainting];
}

- (void)applyPainting {
  if (_frameHold.awaiting && !_visible && !_reveal.active) [self finishFrameHold];
  if (_visible || _reveal.active) [self exposePage];
  if (_visible) [self sinkLingeringPane];
  [self beginFrameHoldIfCold];
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  self.alphaValue = _frameHold.awaiting && (_standIn.page.superview != self || _standIn.leaving) ? 0 : _visible || _reveal.active || _frameHold.holding || !(_warm || _leave.active) ? 1 : 0;
  const BOOL shown = self.paints;
  if (shown && NSIsEmptyRect(self.bounds)) [self layoutPage];
  for (NSView *sub in self.subviews) {
    sub.hidden = !shown;
    AcceptDrops(sub, _visible);
  }
  [CATransaction commit];
  if (_visible) [self takeFocusFromLingeringPane];
  if (TraceVisibility())
    NSLog(@"[ardiacore-vis] %@ paint visible=%d warm=%d tab=%d page=%@ inWindow=%ld hiddenAncestor=%d alpha=%d reveal=%d awaiting=%d",
          _transferKey, _visible, _warm, _tab ? (int)_tab.tabId : -1, _tab.view.superview == self ? @"here" : @"elsewhere",
          (long)self.window.windowNumber, _tab.view.isHiddenOrHasHiddenAncestor, (int)self.alphaValue, _reveal.active,
          _frameHold.awaiting);
  if (_swapReport && _visible && shown && !_frameHold.awaiting && _tab.view.superview == self) [self finishSwapReport:NO];
}

- (void)reportSwapShown:(void (^)(BOOL))report {
  _swapReport = [report copy];
  _swapReportAt = CACurrentMediaTime();
  [self schedulePainting];
}

- (void)finishSwapReport:(BOOL)heldTimedOut {
  void (^report)(BOOL) = _swapReport;
  _swapReport = nil;
  if (report && CACurrentMediaTime() - _swapReportAt <= kSwapReportSeconds) report(heldTimedOut);
}

+ (void)noteShown:(ArdiaCoreTab *)tab {
  if (!tab) return;
  static NSMapTable<ArdiaCoreTab *, NSNumber *> *changes = [NSMapTable weakToStrongObjectsMapTable];
  const NSUInteger change = [changes objectForKey:tab].unsignedIntegerValue + 1;
  [changes setObject:@(change) forKey:tab];
  NillaWebView *view = [NillaTabRegistry viewForTab:tab];
  if (view.seenByUser) return [tab noteShownByHost:YES];
  if (view.autoPictureInPicture) return [tab noteShownByHost:NO];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 300 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
    if ([changes objectForKey:tab].unsignedIntegerValue != change) return;
    NillaWebView *now = [NillaTabRegistry viewForTab:tab];
    if (!now.seenByUser) [tab noteShownByHost:NO];
  });
}

- (void)markTemporary {
  if (_tab.temporary != _temporary) _tab.temporary = _temporary;
  ArdiaCoreTab *source = nil;
  if (_temporary && _temporarySource.length)
    for (NillaWebView *view in LiveViews().allObjects)
      if ([view.transferKey isEqualToString:_temporarySource]) source = view->_tab;
  [_tab setTemporarySource:source];
}

- (BOOL)seenByUser {
  return _visible && [NillaWindowController userSees:self.window];
}

- (void)userSightChanged {
  if (_tab) [NillaWebView noteShown:_tab];
  const BOOL seen = self.seenByUser;
  const BOOL kept = seen && _visible && [NillaWindowController userSeesOnlyThroughWindowServer:self.window];
  if (!kept) {
    _reports.keptByWindowServer = NO;
  } else if (!_reports.keptByWindowServer && self.playsForAutoPictureInPicture) {
    _reports.keptByWindowServer = YES;
    [self traceAutoPictureInPicture:@"app: the window server still shows the tab, AppKit's occlusion overruled"];
    [self emit:@"autoPictureInPictureKept" payload:@{@"appSwitch" : @NO}];
  }
  if (seen == _reports.seenByUser) return;
  _reports.seenByUser = seen;
  if (_reports.autoPictureInPictureActive || _reports.inPictureInPicture || self.playsForAutoPictureInPicture) {
    [self notePictureInPictureSight:seen ? @"sight seen" : @"sight left"];
  }
  [self traceAutoPictureInPicture:seen ? @"app: the user sees the tab" : @"app: the user left the tab"];
  [self updateAutoPictureInPicture];
}

- (void)schedulePainting {
  [PendingPainting() addObject:self];
  if (gPaintingScheduled) return;
  gPaintingScheduled = true;
  CFRunLoopObserverRef observer = CFRunLoopObserverCreateWithHandler(nil, kCFRunLoopBeforeWaiting | kCFRunLoopExit, false, 0, ^(CFRunLoopObserverRef, CFRunLoopActivity) {
    [NillaWebView drainPainting];
  });
  CFRunLoopAddObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);
  CFRelease(observer);
}

+ (void)drainPainting {
  gPaintingScheduled = false;
  NSArray<NillaWebView *> *views = PendingPainting().allObjects;
  [PendingPainting() removeAllObjects];
  for (NillaWebView *view in views)
    if (view->_visible) [view beginFrameHoldIfCold];
  for (NillaWebView *view in views) {
    if (view->_visible) continue;
    [view leaveScreen];
    [view applyPainting];
  }
  for (NillaWebView *view in views)
    if (view->_visible) [view applyPainting];
  for (NillaWebView *view in views) {
    if (!view->_visible) continue;
    [view settleFirstShowFocus];
    [view restoreFocusIfDue];
  }
}

- (void)leaveScreen {
  const NSUInteger generation = ++_leave.generation;
  NSView *page = _tab.view;
  const BOOL shown = !_visible && !_warm && !_reveal.active && page.superview == self && !page.hidden && self.alphaValue > 0;
  [self stopHolding];
  if (NillaWebView *awaited = shown ? [self awaitedOver] : nil) {
    _leave.active = NO;
    return [self holdFor:awaited];
  }
  _leave.active = shown;
  if (!_leave.active) return;
  __weak NillaWebView *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kLeaveScreenDelay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    NillaWebView *view = weakSelf;
    if (!view || view->_leave.generation != generation) return;
    view->_leave.active = NO;
    [view schedulePainting];
  });
}

- (BOOL)sharesScreenWith:(NillaWebView *)other {
  return other != self && other.window == self.window && [other->_profile isEqualToString:_profile] &&
         NSEqualRects(InWindow(other), InWindow(self));
}

- (BOOL)showsPageFor:(NillaWebView *)incoming {
  NSView *page = _tab.view;
  return [self sharesScreenWith:incoming] && page.superview == self && !page.hidden && !_frameHold.awaiting &&
         self.alphaValue > 0 && !self.isHiddenOrHasHiddenAncestor;
}

- (void)exposePage {
  if (_tab && self.window && _tab.view.superview == self) [_tab noteInShownSlot];
}

- (void)beginFrameHoldIfCold {
  NSView *page = _tab.view;
  NSWindow *window = self.window;
  if (_frameHold.awaiting || _standalone || !window || page.superview != self || !page.hidden || !(_visible || _reveal.active) ||
      [window.identifier isEqualToString:@"ardia.window.small"])
    return;
  if (NSIsEmptyRect(InWindow(self))) return;
  NillaWebView *outgoing = nil;
  for (NillaWebView *other in LiveViews().allObjects)
    if ([other showsPageFor:self]) outgoing = other;
  NSView *lingering = outgoing || !_visible ? nil : LingeringPaneOver(self);
  NSView *widget = outgoing || lingering ? RenderWidgetIn(page) : nil;
  if (!widget.hidden) return;
  _frameHold.awaiting = YES;
  _frameHold.tookOverFrom = outgoing;
  _frameHold.tookOverAt = CACurrentMediaTime();
  _frameHold.mark = FrameMarkOf(widget);
  const NSUInteger generation = ++_frameHold.generation;
  [AwaitingFrames() addObject:self];
  [NillaWebView watchFrames];
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ waits for its first frame over %@", _transferKey, outgoing ? outgoing->_transferKey : @"a lingering pane");
  __weak NillaWebView *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kFirstFrameHoldSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    NillaWebView *view = weakSelf;
    if (view && view->_frameHold.awaiting && view->_frameHold.generation == generation) [view frameShown:NO];
  });
}

+ (void)watchFrames {
  if (gFrameWatchScheduled) return;
  gFrameWatchScheduled = true;
  CFRunLoopObserverRef observer = CFRunLoopObserverCreateWithHandler(nil, kCFRunLoopBeforeWaiting, true, 0, ^(CFRunLoopObserverRef watching, CFRunLoopActivity) {
    [NillaWebView checkFrames];
    if (AwaitingFrames().count) return;
    CFRunLoopObserverInvalidate(watching);
    gFrameWatchScheduled = false;
  });
  CFRunLoopAddObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);
  CFRelease(observer);
}

+ (void)checkFrames {
  for (NillaWebView *view in AwaitingFrames().allObjects) {
    if (!view->_frameHold.awaiting) {
      [AwaitingFrames() removeObject:view];
      continue;
    }
    NSView *widget = RenderWidgetIn(view->_tab.view);
    if (!widget || ![FrameMarkOf(widget) isEqualToArray:view->_frameHold.mark]) [view frameShown:YES];
  }
}

- (void)frameShown:(BOOL)drawn {
  if (!_frameHold.awaiting) return;
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ first frame %@", _transferKey, drawn ? @"drawn" : @"late, shown anyway");
  if (_visible) [self finishSwapReport:!drawn];
  WithoutActions(^{
    [self finishFrameHold];
    [self applyPainting];
  });
}

- (void)finishFrameHold {
  [self dropStandIn];
  if (!_frameHold.awaiting) return;
  _frameHold.awaiting = NO;
  _frameHold.mark = nil;
  _frameHold.generation++;
  [AwaitingFrames() removeObject:self];
  if (NSView *pane = _frameHold.pane) pane.layer.zPosition = _frameHold.paneZ;
  _frameHold.pane = nil;
  for (NillaWebView *view in LiveViews().allObjects)
    if (view->_frameHold.holding && view->_frameHold.holdingFor == self) [view releaseHold];
}

- (NillaWebView *)awaitedOver {
  if (!self.window) return nil;
  for (NillaWebView *other in AwaitingFrames().allObjects)
    if (other->_frameHold.awaiting && [self sharesScreenWith:other]) return other;
  return nil;
}

- (void)holdFor:(NillaWebView *)awaited {
  _frameHold.holding = YES;
  _frameHold.holdingFor = awaited;
  const NSUInteger generation = ++_frameHold.holdGeneration;
  [awaited keepPaneBelow:self];
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ keeps its page up for %@", _transferKey, awaited->_transferKey);
  __weak NillaWebView *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kHolderBackstopSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    NillaWebView *view = weakSelf;
    if (!view || !view->_frameHold.holding || view->_frameHold.holdGeneration != generation) return;
    WithoutActions(^{
      [view releaseHold];
    });
  });
}

- (void)stopHolding {
  _frameHold.holding = NO;
  _frameHold.holdingFor = nil;
  _frameHold.holdGeneration++;
}

- (void)releaseHold {
  [self stopHolding];
  [self leaveScreen];
  [self applyPainting];
}

- (void)takeFocusFromLingeringPane {
  NSWindow *window = self.window;
  NSResponder *responder = window.firstResponder;
  NSView *focused = [responder isKindOfClass:NSView.class] ? (NSView *)responder : nil;
  NSView *lingering = focused ? LingeringPaneOver(self) : nil;
  if (!lingering || ![focused isDescendantOf:lingering]) return;
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ takes focus from the lingering New Tab pane", _transferKey);
  if ([window makeFirstResponder:nil]) [self focusAfterLingeringPane];
}

- (void)sinkLingeringPane {
  NSView *lingering = LingeringPaneOver(self);
  NSView *mine = lingering ? PaneUnder(self, lingering.superview) : nil;
  if (!mine || mine == lingering || !mine.layer || !lingering.layer || !Above(lingering, mine)) return;
  const CGFloat was = lingering.layer.zPosition, sunk = mine.layer.zPosition - 1;
  WithoutActions(^{
    lingering.layer.zPosition = sunk;
  });
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ shows over the lingering New Tab pane", _transferKey);
  __weak NSView *weakPane = lingering;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kLingeringPaneSunkSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    NSView *pane = weakPane;
    if (pane.layer.zPosition == sunk) pane.layer.zPosition = was;
  });
}

- (void)keepPaneBelow:(NillaWebView *)held {
  NSView *shared = SharedAncestor(self, held);
  NSView *mine = PaneUnder(self, shared);
  NSView *theirs = PaneUnder(held, shared);
  if (!shared || !mine || !theirs || mine == theirs || !mine.layer || !theirs.layer) return;
  const CGFloat below = theirs.layer.zPosition;
  NSArray<NSView *> *order = shared.subviews;
  const BOOL above = mine.layer.zPosition > below ||
                     (mine.layer.zPosition == below && [order indexOfObjectIdenticalTo:mine] > [order indexOfObjectIdenticalTo:theirs]);
  if (!above) return;
  if (_frameHold.pane != mine) {
    if (NSView *previous = _frameHold.pane) previous.layer.zPosition = _frameHold.paneZ;
    _frameHold.pane = mine;
    _frameHold.paneZ = mine.layer.zPosition;
  }
  WithoutActions(^{
    mine.layer.zPosition = below - 1;
  });
}

@end
