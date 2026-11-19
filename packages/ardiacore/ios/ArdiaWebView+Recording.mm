#import "ArdiaWebViewInternal.h"
#import "ArdiaPictureInPictureInternal.h"
#import "ArdiaWindowController.h"

static const NSTimeInterval kRecordingPictureTimeout = 0.5;

@implementation NillaWebView (Recording)

- (void)copyRecordingPicture:(void (^)(CGImageRef _Nullable picture))completion {
  if (!self.recordingShowsPage || !self.window || self.isHiddenOrHasHiddenAncestor) return completion(NULL);
  [_tab copyPicture:kRecordingPictureTimeout completion:completion];
}

- (BOOL)recordingShowsPage {
  NSView *page = _tab.view;
  return page && page.superview == self && !page.hidden && page.alphaValue > 0.01;
}

+ (NSArray<NSWindow *> *)recordingPictureInPictureWindowsOfWindow:(NSWindow *)window {
  NillaWindowController *owner = [NillaWindowController forNSWindow:window];
  if (!owner || owner.coreWindow.window != window) return @[];
  NSMutableArray<NSWindow *> *owned = [NSMutableArray array];
  for (NSWindow *candidate in NSApp.windows) {
    NillaPiPController *controller = [NillaPiPController forWindow:candidate];
    NillaWebView *view = controller.view;
    ArdiaCoreTab *tab = view ? view->_tab : nil;
    if (controller.window == candidate && tab && !tab.closed && [NillaWindowController holding:tab] == owner) [owned addObject:candidate];
  }
  return owned;
}

+ (BOOL)recordingWindowIsPrivate:(NSWindow *)window {
  NillaWindowController *owner = [NillaWindowController forNSWindow:window];
  ArdiaCoreProfile *profile = owner.coreWindow.activeProfile;
  return !owner || !profile || profile.offTheRecord;
}

+ (CGFloat)recordingCornerRadiusOfWindow:(NSWindow *)window {
  NillaPiPController *controller = [NillaPiPController forWindow:window];
  return controller ? controller.cornerRadius : window.contentView.layer.cornerRadius;
}

+ (void)copyRecordingPictureOfWindow:(NSWindow *)window completion:(void (^)(CGImageRef _Nullable picture))completion {
  [ArdiaCoreWindow copyPictureOfChromeWindow:window completion:completion];
}

+ (NSView *)recordingControlsOfWindow:(NSWindow *)window {
  return [NillaPiPController forWindow:window].overlay;
}

@end
