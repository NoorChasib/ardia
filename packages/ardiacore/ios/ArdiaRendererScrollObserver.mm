#import "ArdiaSwipeInternal.h"

#import <objc/runtime.h>

using namespace nilla_swipe;

@interface NillaRendererScroll ()
- (void)acked:(ArdiaCorePageScrollAck)ack consumed:(BOOL)consumed;
- (void)overscrolledAllowingHorizontal:(BOOL)allowed;
@end

@implementation NillaRendererScroll

- (void)reset {
  _scroll = RendererScroll::AwaitingBegin;
  _overscrolled = NO;
  _overscrollAllowed = NO;
}

- (void)acked:(ArdiaCorePageScrollAck)ack consumed:(BOOL)consumed {
  if (ack == ArdiaCorePageScrollAckBegin) {
    if (_scroll == RendererScroll::AwaitingBegin) _scroll = RendererScroll::AwaitingFirstUpdate;
  } else if (_scroll == RendererScroll::AwaitingFirstUpdate) {
    _scroll = consumed ? RendererScroll::FirstUpdateConsumed : RendererScroll::FirstUpdateUnconsumed;
  }
}

- (void)overscrolledAllowingHorizontal:(BOOL)allowed {
  _overscrolled = YES;
  _overscrollAllowed = allowed;
}

@end

@interface NillaRendererScrollAcks : NSObject <ArdiaCorePageScrollObserver>
@end

namespace {

const void *const kRendererScrollKey = &kRendererScrollKey;

NillaRendererScroll *ExistingScroll(NSView *page) {
  return objc_getAssociatedObject(page, kRendererScrollKey);
}

}

@implementation NillaRendererScrollAcks

- (void)pageView:(NSView *)view ackedScroll:(ArdiaCorePageScrollAck)ack consumed:(BOOL)consumed {
  if (gTrace) [gTrace addObject:@{@"ack" : @"gesture", @"kind" : ack == ArdiaCorePageScrollAckBegin ? @"begin" : @"update", @"consumed" : @(consumed)}];
  [ExistingScroll(view) acked:ack consumed:consumed];
}

- (void)pageView:(NSView *)view overscrolledAllowingHorizontal:(BOOL)allowed {
  if (gTrace) [gTrace addObject:@{@"ack" : @"overscroll", @"allowsX" : @(allowed)}];
  [ExistingScroll(view) overscrolledAllowingHorizontal:allowed];
}

@end

namespace nilla_swipe {

NSView *PageViewOf(NSView *hit) {
  for (NSView *v = hit; v; v = v.superview)
    if ([ArdiaCorePageView isPageView:v]) return v;
  return nil;
}

NillaRendererScroll *RendererScrollFor(NSView *hit) {
  static NillaRendererScrollAcks *acks;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    acks = [NillaRendererScrollAcks new];
    [ArdiaCorePageView setScrollObserver:acks];
  });
  NSView *page = PageViewOf(hit);
  if (!page || ![ArdiaCorePageView takeSwipes:page]) return nil;
  NillaRendererScroll *scroll = ExistingScroll(page);
  if (!scroll) {
    scroll = [NillaRendererScroll new];
    objc_setAssociatedObject(page, kRendererScrollKey, scroll, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  return scroll;
}

}
