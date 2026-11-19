#import "ArdiaChromeWindowHost.h"
#import "ArdiaLittleFitMath.h"

#import <CoreGraphics/CoreGraphics.h>

namespace {

nilla_little_fit::Rect FromNSRect(NSRect rect) { return {rect.origin.x, rect.origin.y, rect.size.width, rect.size.height}; }

NSRect ToNSRect(nilla_little_fit::Rect rect) { return NSMakeRect(rect.x, rect.y, rect.w, rect.h); }

}

@implementation NillaChromeWindowHost (LittleFit)

+ (NSValue *)littleFrameFittingLandingOf:(NSWindow *)window minimumSize:(NSSize)minimum {
  NSArray<NSScreen *> *screens = NSScreen.screens;
  if (window.windowNumber <= 0 || screens.count == 0) return nil;
  NSArray *list = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, (CGWindowID)window.windowNumber));
  NSDictionary *info = list.firstObject;
  if (![info[(id)kCGWindowIsOnscreen] boolValue]) return nil;
  CGRect bounds = CGRectZero;
  if (!CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)info[(id)kCGWindowBounds], &bounds)) return nil;
  const nilla_little_fit::Rect landed = nilla_little_fit::FlipFromTopLeft(FromNSRect(bounds), NSHeight(screens.firstObject.frame));
  std::vector<nilla_little_fit::Display> displays;
  for (NSScreen *screen in screens) displays.push_back({FromNSRect(screen.frame), FromNSRect(screen.visibleFrame)});
  nilla_little_fit::Rect fitted;
  if (!nilla_little_fit::FitLanding(landed, displays, {minimum.width, minimum.height}, &fitted)) return nil;
  return [NSValue valueWithRect:ToNSRect(fitted)];
}

@end
