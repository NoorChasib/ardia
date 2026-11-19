#import "ArdiaPictureInPicture.h"
#import "ArdiaWebViewInternal.h"
#import "ArdiaPiPThrowMath.h"

#include <vector>

@interface NSWindow (NillaPreventsActivation)
- (void)_setPreventsActivation:(BOOL)prevents;
- (BOOL)_preventsActivation;
- (NSInteger)_resizeDirectionForMouseLocation:(NSPoint)location;
- (BOOL)_isNonactivatingPanel;
@end

namespace nilla_pip {

constexpr CGFloat kPeek = 28;
constexpr CGFloat kReturnMargin = 16;
constexpr CGFloat kButtonMargin = 12, kButtonSize = 28;
constexpr CFTimeInterval kCornerBendDuration = 0.2;
constexpr CGFloat kRimAlpha = 0.17;

}

typedef NS_ENUM(NSInteger, NillaPiPEdge) { NillaPiPEdgeNone = 0, NillaPiPEdgeLeft = -1, NillaPiPEdgeRight = 1 };

@interface NillaPiPControl : NSView
@property (nonatomic, copy) void (^onClick)(void);
@property (nonatomic) BOOL hovered;
@end

@interface NillaPiPHandle : NillaPiPControl
@property (nonatomic) NillaPiPEdge edge;
@end

@interface NillaPiPOverlay : NSView
@property (nonatomic, readonly) NillaPiPHandle *handle;
@end

@interface NillaPiPController : NSObject
@property (nonatomic, readonly) NSWindow *window;
@property (nonatomic, weak) NillaWebView *view;
@property (nonatomic, copy) NSString *host;
@property (nonatomic, readonly) NillaPiPOverlay *overlay;
@property (nonatomic, readonly) NillaPiPEdge stashedEdge;
@property (nonatomic) BOOL keepOnTop;
+ (instancetype)forWindow:(NSWindow *)window;
- (instancetype)initWithWindow:(NSWindow *)window;
- (void)roundCorners;
- (CGFloat)cornerRadius;
- (void)backToTab;
- (void)unstash;
- (NSMenu *)menu;
- (void)stopMotion;
- (void)abandonSwipe;
- (NSScreen *)gestureHome;
- (NSDictionary *)throwInfo;
@end

@interface NillaPiPController () {
  NSWindow *_window;
  __weak NillaWebView *_view;
  NSString *_host;
  NillaPiPOverlay *_overlay;
  NillaPiPEdge _stashedEdge;
  BOOL _keepOnTop;
  NSMutableArray *_observers;
  NSTimer *_slide;
  BOOL _animating;
  BOOL _sawDrag;
  BOOL _swiping;
  NSPoint _swipeGrab;
  NSPoint _swipeLastDelta;
  NSPoint _swipePointer;
  CFTimeInterval _swipeBeganAt;
  NSTimeInterval _swipeLastAt;
  NSRect _swipeStart;
  BOOL _dragging;
  BOOL _dragMoving;
  NSPoint _dragGrab;
  NSPoint _dragFrom;
  NSTimeInterval _dragBeganAt;
  NSInteger _dragOffCursor;
  double _dragMaxOff;
  double _dragSlowestMove;
  NSMutableArray *_dragTrace;
  std::vector<nilla_pip_throw::Sample> _dragSamples;
  __weak NSScreen *_dragHome;
  NSDictionary *_lastDrag;
  NSDictionary *_lastRelease;
  NSDictionary *_lastSkip;
  NSInteger _skips;
  NSDictionary *_lastSwipe;
  NSMutableDictionary *_lastThrow;
  NSDictionary *_lastScreenFit;
  __weak NSScreen *_lastScreen;
  __weak NSScreen *_swipeHome;
  __weak NSScreen *_stashScreen;
}
- (void)detach;
- (void)toggleKeepOnTop:(id)sender;
- (void)backToTabFromMenu:(id)sender;
- (void)windowMoved;
- (void)fitCorners:(BOOL)animated;
- (void)bendCornersTo:(CGFloat)radius animated:(BOOL)animated;
- (void)screenChanged;
- (NSScreen *)homeScreen;
- (NillaPiPEdge)edgeBeyond;
- (BOOL)throwFrom:(NSPoint)grab velocity:(NSPoint)velocity;
- (void)throwTo:(NSRect)target velocity:(NSPoint)velocity corner:(int)corner;
- (void)settle;
- (void)rescueIfLost;
- (NSRect)frameStashedAt:(NillaPiPEdge)edge;
- (void)stashAt:(NillaPiPEdge)edge;
- (void)animateTo:(NSRect)target;
- (void)swipeBegan:(NSEvent *)event;
- (void)moveBy:(nilla_pip_throw::Point)delta;
- (void)swipeMoved:(NSEvent *)event;
- (void)swipeEnded:(NSEvent *)event cancelled:(BOOL)cancelled;
- (void)dragReleasedAt:(NSPoint)pointer velocity:(NSPoint)velocity;
@end

@interface NillaPiPController (Workspaces)
@end

@interface NillaPiPController (Placement)
@end

@interface NillaPiPController (Swipe)
+ (BOOL)handleSwipe:(NSEvent *)event;
+ (void)abandonSwipeOn:(NSWindow *)window;
- (void)dragBegan:(NSEvent *)event;
- (void)followPointer:(NSEvent *)event;
- (void)dragMoved:(NSEvent *)event;
- (void)dragEnded:(NSEvent *)event;
- (void)devSwipe:(NSArray<NSString *> *)args;
- (void)devDrag:(NSArray<NSString *> *)args;
@end

@interface NillaPiPController (Skip)
- (BOOL)skipBy:(double)seconds at:(NSPoint)point clickCount:(NSInteger)clickCount;
- (NSDictionary *)skipInfo;
@end

@interface NillaPiPController (SelfTest)
- (NSString *)snapshot:(NSString *)name;
- (void)runSelfTest;
- (void)runButtonSelfTest:(NSString *)button;
- (void)runHoverSelfTest;
- (void)devMouse:(NSArray<NSString *> *)args;
@end

@interface NillaPiPZoom : NSObject
+ (BOOL)handle:(NSEvent *)event;
@end

namespace nilla_pip {

extern NSString *const kZoomDefault;
extern const void *const kZoomKey;
BOOL IsChromeFloatingWindow(NSWindow *window);
BOOL IsChromeVideoPictureInPicture(NSWindow *window);
BOOL IsChromeDocumentPictureInPicture(NSWindow *window);
BOOL JoinsFullScreenSpaces(NSWindow *window);
void JoinFullScreenSpaces(NSWindow *window);
void FloatOverActiveSpace(NSWindow *window);
NSScreen *ScreenFor(NSRect frame);
void PreventActivation(NSWindow *window);
BOOL PreventsActivation(NSWindow *window);
extern NSInteger gActivations;
void ActivateApp(NSString *why);
BOOL ThrowEnabled();
NSPoint PointerOf(NSEvent *event);
nilla_pip_throw::Rect ThrowRect(NSRect r);
int ScreenIndex(NSScreen *screen);
std::vector<nilla_pip_throw::Screen> ThrowScreens();

}
