#import "ArdiaSwipe.h"
#import "ArdiaCore.h"

namespace nilla_swipe {

enum class RendererScroll { Idle, AwaitingBegin, AwaitingFirstUpdate, FirstUpdateUnconsumed, FirstUpdateConsumed };

}

@interface NillaRendererScroll : NSObject
- (void)reset;
@property (nonatomic) nilla_swipe::RendererScroll scroll;
@property (nonatomic) BOOL overscrolled;
@property (nonatomic) BOOL overscrollAllowed;
@end

namespace nilla_swipe {

enum class State { Idle, Pending, Tracking, Ignored };

struct Gesture {
  State state = State::Idle;
  __weak NSView<NillaSwipeTarget> *target;
  __weak NillaRendererScroll *renderer;
  __weak NSView *hit;
  BOOL rendererHit = NO;
  CGFloat dx = 0, dy = 0;
  int direction = 0;
  BOOL available = NO;
  NSTimeInterval times[6] = {};
  CGFloat deltas[6] = {};
  int samples = 0;
  BOOL ignoreSystemPreference = NO;
  int seq = 0;
  int emitted = 0;
  NSTimeInterval time = 0;
};

}

namespace nilla_swipe {

extern NSMutableArray *gTrace;
extern BOOL gWrongRendererHit;
extern BOOL gLegacyHitRouting;
extern Gesture gGesture;
NSEvent *HandleScroll(NSEvent *event, NSWindow *window, NSPoint location, BOOL ignoreSystemPreference);
BOOL HandleDiscreteSwipe(NSWindow *window, NSPoint location, CGFloat deltaX);

NSArray *RectValue(NSRect r);
NSHashTable<NSView<NillaSwipeTarget> *> *Targets();
NSView *PageViewOf(NSView *hit);
NillaRendererScroll *RendererScrollFor(NSView *hit);
NSView *HitView(NSWindow *window, NSPoint locationInWindow);
NSView<NillaSwipeTarget> *TargetAt(NSWindow *window, NSPoint locationInWindow, NSView *hit, NSMutableArray *why = nil);
NSArray *HitChain(NSView *hit);
BOOL IsPager(NSView<NillaSwipeTarget> *target);
BOOL HasNativePager(NSView<NillaSwipeTarget> *target);
NSView *FirstRenderer(NSView *view);
NSView *ReactRoot(NSView *view, NSWindow *window);
NSView<NillaSwipeTarget> *MisroutedRendererTarget(NSWindow *window, NSPoint location, NSView *hit);
NSView *ResolveHit(NSWindow *window, NSPoint location, NSView<NillaSwipeTarget> *__strong *target, BOOL *fallback);
BOOL NativeContentScrolls(NSView *hit, NSView *container, int direction);
NSArray *NativeScrollReport(NSView *hit, NSView *container);

}
