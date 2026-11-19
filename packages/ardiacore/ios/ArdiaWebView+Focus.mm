#import "ArdiaWebViewInternal.h"
#import "ArdiaEarlyWindow.h"

using namespace nilla_web_view;

namespace {

constexpr CFTimeInterval kFocusRestoreWindow = 1;
}

@implementation NillaWebView (Focus)

static BOOL InTabPage(NSView *view) {
  for (NSView *v = view; v; v = v.superview)
    if ([v isKindOfClass:NillaWebView.class]) return !((NillaWebView *)v)->_standalone;
  return NO;
}

+ (void)keepOutgoingFocusFrom:(NSResponder *)responder {
  if (NillaWebView *view = [NillaWebView holding:responder]) {
    [view storePageFocusFrom:responder];
    view->_focus.keepsOutgoing = YES;
  }
}

+ (void)endOutgoingFocusFrom:(NSResponder *)responder {
  if (NillaWebView *view = [NillaWebView holding:responder]) view->_focus.keepsOutgoing = NO;
}

+ (NillaWebView *)holding:(id)responder {
  NSView *outgoing = [responder isKindOfClass:NSView.class] ? responder : nil;
  for (NillaWebView *view in LiveViews().allObjects)
    if (outgoing && view.window == outgoing.window && [outgoing isDescendantOf:view]) return view;
  return nil;
}

+ (BOOL)focusVisiblePageIn:(NSWindow *)window {
  NillaWebView *chosen = nil;
  for (NillaWebView *view in LiveViews().allObjects) {
    NSView *page = view->_tab.view;
    if (view.window != window || !view->_visible || view->_standalone || !page || page.superview != view ||
        page.isHiddenOrHasHiddenAncestor)
      continue;
    if (!chosen || (view->_focus.page == NillaPageFocus::Page && chosen->_focus.page != NillaPageFocus::Page)) chosen = view;
  }
  if (!chosen) return NO;
  [chosen focusPage];
  return YES;
}

- (void)storePageFocus {
  NSResponder *responder = self.window.firstResponder;
  const BOOL unfocused = !responder || responder == self.window;
  const BOOL snapshotted = _focus.keepsOutgoing;
  _focus.keepsOutgoing = NO;
  if (snapshotted && unfocused) {
    _focus.onActivate = NO;
    return;
  }
  [self storePageFocusFrom:responder];
}

- (void)storePageFocusFrom:(NSResponder *)responder {
  _focus.onActivate = NO;
  _focus.devTools = nil;
  _focus.elsewhere = nil;
  NSWindow *window = self.window;
  if (!window || !_tab) return;
  NSView *view = [responder isKindOfClass:NSView.class] ? (NSView *)responder : nil;
  if (view && _tab.view && [view isDescendantOf:_tab.view]) {
    _focus.page = NillaPageFocus::Page;
  } else if (view && _devtoolsView && [view isDescendantOf:_devtoolsView]) {
    _focus.page = NillaPageFocus::DevTools;
    _focus.devTools = view;
  } else if (!responder || responder == window || (view && InTabPage(view))) {
    _focus.page = NillaPageFocus::Unknown;
  } else {
    _focus.page = NillaPageFocus::Elsewhere;
    _focus.elsewhere = view;
  }
}

- (void)requestFocusRestore {
  [self requestFocusRestoreIn:self.window];
}

- (void)requestFocusRestoreIn:(NSWindow *)window {
  if (_standalone || !_tab || !window) return;
  _focus.onActivate = YES;
  _focus.activatedAt = CACurrentMediaTime();
  _focus.activatedIn = window;
  [self restoreFocusIfDue];
  if (_focus.onActivate) [self schedulePainting];
}

- (void)settleFirstShowFocus {
  NSWindow *window = self.window;
  NSView *page = _tab.view;
  if (!_tab || !_visible || !window || _standalone || !page || page.superview != self || page.isHiddenOrHasHiddenAncestor) return;
  NillaWindowController *controller = self.controller;
  if (!controller || [NillaTabStrip activeTabInWindow:controller profile:_tab.profile] != _tab) return;
  if (![NillaTabRegistry takeFirstShowFocusOfTab:_tab]) return;
  [self requestFocusRestoreIn:window];
}

- (void)restoreFocusIfDue {
  if (!_focus.onActivate) return;
  NSWindow *window = self.window;
  NSView *page = _tab.view;
  if (!window || window != _focus.activatedIn || !page || _standalone || page.superview != self ||
      CACurrentMediaTime() - _focus.activatedAt > kFocusRestoreWindow) {
    _focus.onActivate = NO;
    return;
  }
  if (!_visible || page.isHiddenOrHasHiddenAncestor) return;
  [self takeFocusFromLingeringPane];
  _focus.onActivate = NO;
  NSResponder *responder = window.firstResponder;
  NSView *view = [responder isKindOfClass:NSView.class] ? (NSView *)responder : nil;
  if (view && [view isDescendantOf:self]) return;
  if (responder && responder != window && !(view && InTabPage(view))) return;
  if ([self focusRememberedDevToolsIn:window]) return;
  if (_focus.page != NillaPageFocus::Elsewhere || _focus.elsewhere.window != window) [self focusPage];
}

- (BOOL)focusRememberedDevToolsIn:(NSWindow *)window {
  NSView *devTools = _focus.devTools;
  if (_focus.page != NillaPageFocus::DevTools || devTools.window != window || !_devtoolsView || ![devTools isDescendantOf:_devtoolsView]) return NO;
  [window makeFirstResponder:devTools];
  return YES;
}

- (void)focusAfterLingeringPane {
  NSWindow *window = self.window;
  NSView *page = _tab.view;
  if (!window || !_visible || _standalone || !page || page.superview != self || page.isHiddenOrHasHiddenAncestor) return;
  if (![self focusRememberedDevToolsIn:window]) [self focusPage];
}

- (void)focusAfterLoad {
  if (!_tab) return;
  if (_visible) return [self focusPage];
  _focus.page = NillaPageFocus::Page;
  _focus.devTools = nil;
  [self requestFocusRestore];
}

- (void)focusPage {
  if ([NillaEarlyWindow veils:_tab]) return [NillaEarlyWindow requestFocus:_tab];
  [_tab focus];
}

- (void)tabDidGainFocus:(ArdiaCoreTab *)tab {
  [self emit:@"focus" payload:@{}];
}

@end
