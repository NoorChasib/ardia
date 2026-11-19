#import "ArdiaPictureInPictureInternal.h"
#import "ArdiaPiPThrowMath.h"
#import "ArdiaRuntime.h"

namespace {

BOOL WhereTheThrowMathsMayPutIt(NSRect rect) {
  const auto screens = nilla_pip::ThrowScreens();
  return !screens.empty() && nilla_pip_throw::Shortfall(nilla_pip::ThrowRect(rect), screens.data(), (int)screens.size()) <= 1e-9;
}

}

@implementation NillaPiPController (Placement)

+ (void)load {
  SEL constrain = @selector(constrainFrameRect:toScreen:);
  nilla_runtime::ReplaceMethod(NSClassFromString(@"NativeWidgetMacFramelessNSWindow"), constrain, ^id(IMP original) {
    return ^NSRect(NSWindow *window, NSRect rect, NSScreen *screen) {
      if ([NillaPiPController forWindow:window] && WhereTheThrowMathsMayPutIt(rect)) return rect;
      return ((NSRect (*)(id, SEL, NSRect, NSScreen *))original)(window, constrain, rect, screen);
    };
  });
}

@end
