#import "ArdiaWebViewInternal.h"
#import "ArdiaEarlyWindow.h"
#import "ArdiaPaintProbeMath.h"
#import "ArdiaWindowController.h"

@interface NillaWebView (PaintProbe)
- (unsigned)paintProbeReasons;
@end

@implementation NillaWebView (PaintProbe)

- (unsigned)paintProbeReasons {
  NSView *page = _tab.view;
  nilla_paint_probe::View state;
  state.alphaZero = self.alphaValue <= 0.01;
  state.viewHidden = self.isHiddenOrHasHiddenAncestor;
  state.pageHidden = page && page.isHiddenOrHasHiddenAncestor;
  state.pageDetached = !page || page.superview != self;
  state.awaitingFrame = _frameHold.awaiting;
  state.standInLent = _standIn.lentTo || _standIn.tab || _standIn.page;
  state.standInLeaving = _standIn.leaving;
  state.veilUp = [NillaEarlyWindow veils:_tab];
  return nilla_paint_probe::ReasonsOf(state);
}

@end

@interface NillaPaintWatch : NSObject {
 @public
  nilla_paint_probe::Episode _episode;
  NSUInteger _generation;
}
@end

@implementation NillaPaintWatch
@end

namespace nilla_host {

namespace {

constexpr NSTimeInterval kPaintCheckAfter = 0.5;

NSString *gLastPaintCheck;
NSString *gLastPaintRecord;
NSUInteger gPaintEpisodeCount = 0;

NSMapTable<NSWindow *, NillaPaintWatch *> *PaintWatches() {
  static NSMapTable *watches = [NSMapTable weakToStrongObjectsMapTable];
  return watches;
}

NSString *ReasonNames(unsigned reasons) {
  if (!reasons) return @"none";
  NSArray<NSString *> *names =
      @[ @"alpha 0", @"view hidden", @"page hidden", @"page detached", @"frame hold", @"stand-in lent", @"stand-in leaving", @"veil" ];
  NSMutableArray<NSString *> *found = [NSMutableArray array];
  for (unsigned bit = 0; bit < nilla_paint_probe::kReasonCount; bit++)
    if (reasons & (1u << bit)) [found addObject:names[bit]];
  return [found componentsJoinedByString:@", "];
}

NSString *DescribePaint(NSDictionary *record) {
  return [NSString stringWithFormat:@"%@ window of %@, trigger %@, seen %d, occlusion %@, overruled %d, app active %d, views %@, unpainted %@ (%@)",
                                    record[@"window"], record[@"windows"], record[@"trigger"], [record[@"seen"] boolValue], record[@"occlusion"],
                                    [record[@"overruled"] boolValue], [record[@"appActive"] boolValue], record[@"views"], record[@"unpainted"],
                                    ReasonNames([record[@"reasons"] unsignedIntValue])];
}

NSUInteger OpenWindowCount() {
  NSUInteger open = 0;
  for (NillaWindowController *controller in [NillaWindowController all])
    if (controller.coreWindow.window.isVisible) open++;
  return open;
}

void CheckPainting(NSWindow *window, NSString *trigger) {
  NillaWindowController *owner = [NillaWindowController forNSWindow:window];
  NillaPaintWatch *watch = [PaintWatches() objectForKey:window];
  if (!owner || owner.coreWindow.window != window || !watch) return;
  nilla_paint_probe::Tally tally;
  for (NillaWebView *view in nilla_web_view::LiveViews().allObjects)
    if (view.window == window && view.visible) tally.Add([view paintProbeReasons]);
  const bool appKitShows = (window.occlusionState & NSWindowOcclusionStateVisible) != 0;
  NSDictionary *record = @{
    @"window" : owner.coreWindow.activeProfile.offTheRecord ? @"private" : @"regular",
    @"trigger" : trigger,
    @"seen" : @([NillaWindowController userSees:window]),
    @"occlusion" : appKitShows ? @"visible" : @"occluded",
    @"overruled" : @([NillaWindowController userSeesOnlyThroughWindowServer:window]),
    @"appActive" : @(NSApp.isActive),
    @"windows" : @(OpenWindowCount()),
    @"views" : @(tally.views),
    @"unpainted" : @(tally.unpainted),
    @"reasons" : @(tally.reasons),
  };
  gLastPaintCheck = DescribePaint(record);
  if (!watch->_episode.ShouldSend(tally)) return;
  gPaintEpisodeCount++;
  gLastPaintRecord = gLastPaintCheck;
  [NillaEvents emit:@"engine.windowUnpainted" data:record];
}

void SchedulePaintCheck(NSWindow *window, NSString *trigger) {
  if (![window isKindOfClass:NSWindow.class] || ![NillaWindowController forNSWindow:window]) return;
  NillaPaintWatch *watch = [PaintWatches() objectForKey:window];
  if (!watch) {
    watch = [[NillaPaintWatch alloc] init];
    [PaintWatches() setObject:watch forKey:window];
  }
  const NSUInteger generation = ++watch->_generation;
  __weak NSWindow *weakWindow = window;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kPaintCheckAfter * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    NSWindow *checked = weakWindow;
    NillaPaintWatch *current = checked ? [PaintWatches() objectForKey:checked] : nil;
    if (current && current->_generation == generation) CheckPainting(checked, trigger);
  });
}

}

NSString *PaintProbeLine() {
  return [NSString stringWithFormat:@"paint last check %@\npaint unpainted episodes %lu%@", gLastPaintCheck ?: @"not checked",
                                    (unsigned long)gPaintEpisodeCount,
                                    gLastPaintRecord ? [@", latest: " stringByAppendingString:gLastPaintRecord] : @""];
}

void WatchPainting() {
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  [center addObserverForName:NillaWindowSeenDidChange object:nil queue:nil usingBlock:^(NSNotification *note) {
    SchedulePaintCheck(note.object, @"seen");
  }];
  for (NSNotificationName name in @[ NSWindowDidBecomeKeyNotification, NSWindowDidResignKeyNotification ])
    [center addObserverForName:name object:nil queue:nil usingBlock:^(NSNotification *note) { SchedulePaintCheck(note.object, @"key"); }];
  [center addObserverForName:NSWindowWillCloseNotification object:nil queue:nil usingBlock:^(NSNotification *note) {
    if ([note.object isKindOfClass:NSWindow.class]) [PaintWatches() removeObjectForKey:note.object];
  }];
}

}
