#import "ArdiaWebViewInternal.h"

#import <QuartzCore/QuartzCore.h>

using namespace nilla_web_view;

namespace {

constexpr CFTimeInterval kHeldPageSeconds = 4;
constexpr CFTimeInterval kLoadedFrameWaitSeconds = 0.5;
constexpr CFTimeInterval kScriptedLoadWaitSeconds = 1;
constexpr CFTimeInterval kFrameCheckSeconds = 1.0 / 120;

struct FirstPaintHolds {
  NSUInteger held{};
  NSUInteger painted{};
  NSUInteger loaded{};
  NSUInteger pressed{};
  NSUInteger timedOut{};
  double heldMs{};

  void note(NillaHeldPageEnd end, CFTimeInterval seconds) {
    switch (end) {
      case NillaHeldPageEnd::Painted: painted++; break;
      case NillaHeldPageEnd::Loaded: loaded++; break;
      case NillaHeldPageEnd::Pressed: pressed++; break;
      case NillaHeldPageEnd::TimedOut: timedOut++; break;
      case NillaHeldPageEnd::Detached: return;
    }
    held++;
    heldMs += seconds * 1000;
  }

  NSDictionary<NSString *, NSNumber *> *report() const {
    return @{@"held" : @(held), @"painted" : @(painted), @"loaded" : @(loaded), @"pressed" : @(pressed), @"timedOut" : @(timedOut),
             @"heldMs" : @(llround(heldMs))};
  }
};
FirstPaintHolds gFirstPaintHolds;
}

@implementation NillaWebView (FirstPaint)

- (void)holdPageUntilPainted:(BOOL)created {
  NSView *page = _tab.view;
  const BOOL little = [self.window.identifier isEqualToString:@"ardia.window.small"];
  const BOOL coldTab = created && !little && !_temporary && !_standalone && !_extensionHost.length && (_visible || _reveal.active);
  if (_firstPaint.held || _firstPaint.settled || !page || page.superview != self || !(little || coldTab)) return;
  _firstPaint.held = YES;
  _firstPaint.coldTab = coldTab;
  _firstPaint.heldAt = CACurrentMediaTime();
  page.wantsLayer = YES;
  _firstPaint.opacity = page.layer.opacity;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  page.layer.opacity = 0;
  [CATransaction commit];
  [self callFrame:@"" kind:@"firstPaint" json:@"{}"];
  const NSUInteger generation = ++_firstPaint.generation;
  __weak NillaWebView *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kHeldPageSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    NillaWebView *view = weakSelf;
    if (view && view->_firstPaint.generation == generation) [view showHeldPage:NillaHeldPageEnd::TimedOut];
  });
}

- (void)holdCreatedPageShown {
  if (!_tab || !_firstPaint.created) return;
  _firstPaint.created = NO;
  if (_tab.loading) [self holdPageUntilPainted:YES];
}

- (void)showHeldPage:(NillaHeldPageEnd)end {
  if (!_firstPaint.held) return;
  _firstPaint.held = NO;
  _firstPaint.settled = YES;
  _firstPaint.generation++;
  if (_firstPaint.coldTab) gFirstPaintHolds.note(end, CACurrentMediaTime() - _firstPaint.heldAt);
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ shows its held page after %.0f ms (end %d)", _transferKey, (CACurrentMediaTime() - _firstPaint.heldAt) * 1000, (int)end);
  CALayer *layer = _tab.view.layer;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  layer.opacity = _firstPaint.opacity;
  if (end != NillaHeldPageEnd::Detached) {
    CABasicAnimation *fade = [CABasicAnimation animationWithKeyPath:@"opacity"];
    fade.fromValue = @0;
    fade.toValue = @(_firstPaint.opacity);
    fade.duration = 0.16;
    fade.timingFunction = [CAMediaTimingFunction functionWithControlPoints:0.23 :1 :0.32 :1];
    [layer addAnimation:fade forKey:@"nilla.held.page"];
  }
  [CATransaction commit];
}

- (void)showHeldPageOnNextFrame {
  if (!_firstPaint.held) return;
  NSView *widget = RenderWidgetIn(_tab.view);
  if (!widget) return [self showHeldPage:NillaHeldPageEnd::Loaded];
  [self showHeldPageWhenFrameLeaves:FrameMarkOf(widget) generation:_firstPaint.generation until:CACurrentMediaTime() + kLoadedFrameWaitSeconds];
}

- (void)showHeldPageAfterLoad {
  if (!_firstPaint.held) return;
  if (!_firstPaint.scripted) return [self showHeldPageOnNextFrame];
  const NSUInteger generation = _firstPaint.generation;
  __weak NillaWebView *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kScriptedLoadWaitSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    NillaWebView *view = weakSelf;
    if (view && view->_firstPaint.held && view->_firstPaint.generation == generation) [view showHeldPage:NillaHeldPageEnd::Loaded];
  });
}

- (void)showHeldPageWhenFrameLeaves:(NSArray *)mark generation:(NSUInteger)generation until:(CFTimeInterval)deadline {
  __weak NillaWebView *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kFrameCheckSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    NillaWebView *view = weakSelf;
    if (!view || !view->_firstPaint.held || view->_firstPaint.generation != generation) return;
    NSView *widget = RenderWidgetIn(view->_tab.view);
    if (!widget || ![FrameMarkOf(widget) isEqualToArray:mark] || CACurrentMediaTime() >= deadline)
      return [view showHeldPage:NillaHeldPageEnd::Loaded];
    [view showHeldPageWhenFrameLeaves:mark generation:generation until:deadline];
  });
}

+ (NSDictionary<NSString *, NSNumber *> *)takeFirstPaintHolds {
  NSDictionary *holds = gFirstPaintHolds.report();
  gFirstPaintHolds = {};
  return holds;
}

@end
