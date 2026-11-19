#import "ArdiaChromeWindowInternal.h"
#import "ArdiaServices.h"
#import "ArdiaWebViewInternal.h"

using namespace nilla_window;

namespace nilla_window {

BOOL (^gRefusesUnhandledKey)(NSWindow *, NSEvent *);

NSMapTable<NSWindow *, NillaWindowController *> *Controllers() {
  static NSMapTable *controllers = [NSMapTable weakToStrongObjectsMapTable];
  return controllers;
}
}

namespace {

void AnnounceStrayTab(ArdiaCoreTab *tab, int tries) {
  if (tab.closed) return;
  NSString *url = tab.url;
  if ((!url.length || [url isEqualToString:@"about:blank"]) && tries < 20) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 25 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{ AnnounceStrayTab(tab, tries + 1); });
    return;
  }
  if (![NillaEvents listens:@"extensions"]) return;
  [NillaEvents emit:@"extensions.tabs"
               data:@{
                 @"action" : @"adopt", @"url" : url ?: @"", @"profile" : nilla_host::ProfileName(tab.profile),
                 @"adoptId" : [NillaTabRegistry offerTab:tab prefix:@"tab"]
               }];
}

void HandOffTab(ArdiaCoreTab *tab) {
  ArdiaCoreProfile *profile = tab.profile;
  if (!profile) return (void)dispatch_async(dispatch_get_main_queue(), ^{ [tab closeNow]; });
  NillaWebView *view = [NillaWindowController hostingViewForProfile:profile];
  if (view || !profile.offTheRecord) {
    if (view && (view.visible || ![NillaEvents listens:@"extensions"]) &&
        ([view.profile isEqualToString:nilla_host::ProfileName(profile)] || nilla_host::IsOffTheRecordOf(profile, view.profile)))
      [view openedTab:tab adoptId:[NillaTabRegistry offerTab:tab prefix:@"tab"] disposition:@"foreground"];
    else
      AnnounceStrayTab(tab, 0);
    return;
  }
  if (!(view = [NillaWindowController hostingViewForProfile:nil])) return;
  [view openedTab:tab adoptId:[NillaTabRegistry offerTab:tab prefix:@"tab"] disposition:@"incognito"];
}

}

@implementation NillaWindowController {
  NSHashTable<ArdiaCoreTab *> *_closing;
  NSString *_chromeToken;
  BOOL _awaitingApp;
  BOOL _showInactive;
  BOOL _announced;
  __weak ArdiaCoreTab *_chromeActive;
  id _willCloseObserver;
}

+ (BOOL)userSees:(NSWindow *)window {
  NillaWindowController *controller = [self forNSWindow:window];
  if (!controller || controller.stray || controller.standalone) return YES;
  return [[NillaWindowFullScreen ofWindow:controller.coreWindow create:YES] seen];
}

+ (void)reconsiderSightOf:(NSWindow *)window {
  NillaWindowController *controller = [self forNSWindow:window];
  if (!controller || controller.stray || controller.standalone) return;
  [[NillaWindowFullScreen ofWindow:controller.coreWindow create:YES] reconsiderSight];
}

+ (BOOL)userSeesOnlyThroughWindowServer:(NSWindow *)window {
  NillaWindowController *controller = [self forNSWindow:window];
  if (!controller || controller.stray || controller.standalone) return NO;
  return [[NillaWindowFullScreen ofWindow:controller.coreWindow create:YES] seenOnlyByWindowServer];
}

+ (instancetype)strayWindowForProfile:(ArdiaCoreProfile *)profile {
  ArdiaCoreWindow *coreWindow = [[ArdiaCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, 800, 600)];
  if (!coreWindow.window) return nil;
  NillaWindowController *controller = [[NillaWindowController alloc] initWithCoreWindow:coreWindow];
  controller->_stray = YES;
  [Controllers() setObject:controller forKey:coreWindow.window];
  return controller;
}

NSMutableDictionary<NSString *, NillaWindowController *> *ChromeMadeWindows() {
  static NSMutableDictionary *windows = [NSMutableDictionary dictionary];
  return windows;
}

+ (instancetype)chromeMadeWindowForProfile:(ArdiaCoreProfile *)profile {
  ArdiaCoreWindow *coreWindow = [[ArdiaCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1360, 860)];
  NSWindow *window = coreWindow.window;
  if (!window) return nil;
  ConfigureWindow(window);
  NillaWindowController *controller = [[NillaWindowController alloc] initWithCoreWindow:coreWindow];
  controller->_chromeToken = NSUUID.UUID.UUIDString;
  controller->_awaitingApp = YES;
  [Controllers() setObject:controller forKey:window];
  ChromeMadeWindows()[controller->_chromeToken] = controller;
  __weak NillaWindowController *weakController = controller;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 20 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    [weakController stopAwaitingApp];
  });
  return controller;
}

+ (instancetype)claimChromeMadeWindow:(NSString *)token {
  NillaWindowController *controller = token.length ? ChromeMadeWindows()[token] : nil;
  if (!controller) return nil;
  [ChromeMadeWindows() removeObjectForKey:token];
  if (!controller->_awaitingApp || !controller.coreWindow.window) return nil;
  controller->_awaitingApp = NO;
  return controller;
}

- (void)stopAwaitingApp {
  if (!_awaitingApp) return;
  _awaitingApp = NO;
  [ChromeMadeWindows() removeObjectForKey:_chromeToken];
  _stray = YES;
  NSArray<ArdiaCoreTab *> *tabs = @[];
  for (ArdiaCoreProfile *profile in nilla_host::LoadedProfiles())
    tabs = [tabs arrayByAddingObjectsFromArray:[_coreWindow tabsForProfile:profile]];
  if (!tabs.count) return [_coreWindow close];
  for (ArdiaCoreTab *tab in tabs)
    if (![NillaTabRegistry viewForTab:tab]) HandOffTab(tab);
}

- (void)announceChromeMadeTab:(ArdiaCoreTab *)tab tries:(int)tries {
  if (_stray || tab.closed || ![[_coreWindow tabsForProfile:tab.profile] containsObject:tab]) return;
  NSString *moving = [NillaTabRegistry viewForTab:tab].transferKey;
  NSString *url = tab.url;
  const BOOL blank = !moving.length && (!url.length || [url isEqualToString:@"about:blank"]);
  if ((blank && tries < 20) || (![NillaEvents listens:@"extensions"] && tries < 400)) {
    __weak NillaWindowController *weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 25 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      [weakSelf announceChromeMadeTab:tab tries:tries + 1];
    });
    return;
  }
  if (![NillaEvents listens:@"extensions"]) return;
  NSDictionary *request;
  if (moving.length) {
    request = @{@"action" : @"moveInto", @"chromeWindow" : _chromeToken, @"tabId" : moving, @"focused" : @(!_showInactive)};
  } else if ([NillaTabRegistry viewForTab:tab]) {
    return;
  } else {
    request = @{
      @"action" : @"adoptInto", @"chromeWindow" : _chromeToken, @"adoptId" : [NillaTabRegistry offerTab:tab prefix:@"tab"],
      @"url" : url ?: @"", @"profile" : nilla_host::ProfileName(tab.profile), @"active" : @(!_chromeActive || _chromeActive == tab),
      @"focused" : @(!_showInactive)
    };
  }
  _announced = YES;
  [NillaEvents emit:@"extensions.tabs" data:request];
}

- (void)window:(ArdiaCoreWindow *)window showRequestedActive:(BOOL)active {
  if (_awaitingApp) _showInactive = !active;
}

NSMapTable<ArdiaCoreProfile *, NillaWindowController *> *StandaloneWindows() {
  static NSMapTable *windows = [NSMapTable weakToStrongObjectsMapTable];
  return windows;
}

+ (instancetype)standaloneWindowForProfile:(ArdiaCoreProfile *)profile {
  NSMapTable<ArdiaCoreProfile *, NillaWindowController *> *windows = StandaloneWindows();
  NillaWindowController *controller = [windows objectForKey:profile];
  if (controller && controller.coreWindow.window) return controller;
  ArdiaCoreWindow *coreWindow = [[ArdiaCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, 800, 600)];
  if (!coreWindow.window) return nil;
  coreWindow.internal = YES;
  controller = [[NillaWindowController alloc] initWithCoreWindow:coreWindow];
  controller->_standalone = YES;
  [Controllers() setObject:controller forKey:coreWindow.window];
  [windows setObject:controller forKey:profile];
  return controller;
}

+ (NillaWebView *)hostingViewForProfile:(ArdiaCoreProfile *)profile {
  NillaWebView *any = nil;
  for (NSWindow *window in NSApp.orderedWindows) {
    NillaWindowController *c = [Controllers() objectForKey:window];
    if (!c || c.stray || c.standalone) continue;
    if (NillaWebView *view = profile ? [c anyShownViewForProfile:profile] : nil) return view;
    any = any ?: [c anyView];
  }
  return profile.offTheRecord ? nil : any;
}

+ (instancetype)holding:(ArdiaCoreTab *)tab {
  ArdiaCoreProfile *profile = tab.profile;
  if (!profile) return nil;
  for (NillaWindowController *c in Controllers().objectEnumerator)
    if ([[c.coreWindow tabsForProfile:profile] containsObject:tab]) return c;
  return nil;
}

- (void)noteClosing:(ArdiaCoreTab *)tab {
  if (!_closing) _closing = [NSHashTable weakObjectsHashTable];
  [_closing addObject:tab];
  __weak NillaWindowController *weakSelf = self;
  __weak ArdiaCoreTab *weakTab = tab;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    NillaWindowController *c = weakSelf;
    ArdiaCoreTab *t = weakTab;
    if (c && t) [c->_closing removeObject:t];
  });
}

- (BOOL)appChanging {
  return _hostChanges > 0 || _closing.count > 0;
}

+ (instancetype)forNSWindow:(NSWindow *)window {
  return window ? [Controllers() objectForKey:window] : nil;
}

+ (NSArray<NillaWindowController *> *)all {
  return Controllers().objectEnumerator.allObjects;
}

- (instancetype)initWithCoreWindow:(ArdiaCoreWindow *)coreWindow {
  if ((self = [super init])) {
    _coreWindow = coreWindow;
    coreWindow.delegate = self;
    __weak NillaWindowController *weakSelf = self;
    _willCloseObserver = [NSNotificationCenter.defaultCenter addObserverForName:NSWindowWillCloseNotification
                                                                         object:coreWindow.window
                                                                          queue:nil
                                                                     usingBlock:^(NSNotification *) {
                                                                       if (NillaWindowController *c = weakSelf) [NillaTabStrip windowClosed:c];
                                                                     }];
  }
  return self;
}

- (void)dealloc {
  if (_willCloseObserver) [NSNotificationCenter.defaultCenter removeObserver:_willCloseObserver];
}

- (NillaWebView *)viewFor:(ArdiaCoreTab *)tab {
  return tab ? [NillaTabRegistry viewForTab:tab] : nil;
}

- (NillaWebView *)anyShownViewForProfile:(ArdiaCoreProfile *)profile {
  for (ArdiaCoreTab *tab in [_coreWindow tabsForProfile:profile]) {
    NillaWebView *view = [NillaTabRegistry viewForTab:tab];
    if (view.visible) return view;
  }
  return nil;
}

- (NillaWebView *)anyView {
  for (ArdiaCoreProfile *profile in nilla_host::LoadedProfiles())
    for (ArdiaCoreTab *tab in [_coreWindow tabsForProfile:profile])
      if (NillaWebView *view = [NillaTabRegistry viewForTab:tab]) return view;
  return nil;
}

- (void)window:(ArdiaCoreWindow *)window didInsertTab:(ArdiaCoreTab *)tab opener:(ArdiaCoreTab *)opener disposition:(NSString *)disposition {
  [NillaTabStrip changedInWindow:self profile:tab.profile];
  if (_hostChanges > 0) return;
  if (_awaitingApp) {
    __weak NillaWindowController *weakSelf = self;
    dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf announceChromeMadeTab:tab tries:0]; });
    return;
  }
  if ([NillaTabRegistry viewForTab:tab]) return;
  if (_stray) return HandOffTab(tab);
  NillaWebView *openerView = [self viewFor:opener];
  if ([disposition isEqualToString:@"popup"]) {
    return nilla_host::OpenPopupWindow(tab, openerView);
  }
  if (openerView) {
    [openerView openedLinkTab:tab adoptId:[NillaTabRegistry offerTab:tab] disposition:nilla_host::AppDisposition(disposition)];
  } else if (NillaWebView *view = [self anyShownViewForProfile:tab.profile]) {
    [view openedTab:tab adoptId:[NillaTabRegistry offerTab:tab prefix:@"tab"] disposition:@"foreground"];
  } else {
    HandOffTab(tab);
  }
}

- (void)window:(ArdiaCoreWindow *)window didRemoveTab:(ArdiaCoreTab *)tab {
  [NillaTabStrip removed:tab fromWindow:self];
  if (ArdiaCoreProfile *profile = tab.profile) [NillaTabStrip changedInWindow:self profile:profile];
  [[self viewFor:tab] tabRemovedFromWindow:window];
  if (_stray || _standalone || _awaitingApp) {
    __weak NillaWindowController *weakSelf = self;
    ArdiaCoreProfile *removedProfile = tab.profile;
    dispatch_async(dispatch_get_main_queue(), ^{
      NillaWindowController *c = weakSelf;
      if (!c) return;
      NSMutableArray<ArdiaCoreProfile *> *profiles = [nilla_host::LoadedProfiles() mutableCopy];
      if (removedProfile) [profiles addObject:removedProfile];
      for (ArdiaCoreProfile *p in profiles)
        if ([c.coreWindow tabsForProfile:p].count) return;
      if (c->_awaitingApp) {
        c->_awaitingApp = NO;
        [ChromeMadeWindows() removeObjectForKey:c->_chromeToken];
        if (c->_announced) [NillaEvents emit:@"extensions.tabs" data:@{@"action" : @"closeWindow", @"chromeWindow" : c->_chromeToken}];
      } else if (!c.stray && !c.standalone) {
        return;
      }
      if (c.standalone) {
        NSMapTable<ArdiaCoreProfile *, NillaWindowController *> *windows = StandaloneWindows();
        for (ArdiaCoreProfile *p in windows.keyEnumerator.allObjects)
          if ([windows objectForKey:p] == c) [windows removeObjectForKey:p];
      }
      [c.coreWindow close];
    });
  }
  dispatch_async(dispatch_get_main_queue(), ^{ [self->_closing removeObject:tab]; });
}

- (void)window:(ArdiaCoreWindow *)window didActivateTab:(ArdiaCoreTab *)tab {
  if (_awaitingApp) _chromeActive = tab;
  [NillaTabStrip activated:tab inWindow:self];
  [NillaTabStrip changedInWindow:self profile:tab.profile];
  [[self viewFor:tab] tabActivatedByChrome:!self.appChanging];
}

- (void)window:(ArdiaCoreWindow *)window devToolsDidChangeForTab:(ArdiaCoreTab *)tab view:(NSView *)devToolsView {
  [[self viewFor:tab] devToolsChanged:devToolsView];
}

- (void)window:(ArdiaCoreWindow *)window tab:(ArdiaCoreTab *)tab didChangeFullscreen:(BOOL)fullscreen {
  [FullScreenChanges() setObject:@([FullScreenChanges() objectForKey:tab].unsignedIntegerValue + 1) forKey:tab];
  __weak NillaWindowController *weakSelf = self;
  __weak ArdiaCoreTab *weakTab = tab;
  void (^tell)(void) = ^{
    ArdiaCoreTab *t = weakTab;
    if (t) [[weakSelf viewFor:t] emit:@"fullscreen" payload:@{@"fullscreen" : @(fullscreen)}];
  };
  if (_stray || _standalone) return tell();
  [[NillaWindowFullScreen ofWindow:window create:YES] tab:tab fullScreen:fullscreen tell:tell];
}

- (void)window:(ArdiaCoreWindow *)window passwordPrompt:(NSDictionary<NSString *, id> *)prompt forTab:(ArdiaCoreTab *)tab {
  NillaWebView *view = [self viewFor:tab];
  if (view) nilla_host::NotePasswordPromptSource(view, nil);
  [view emit:@"passwordPrompt" payload:prompt];
}

- (void)window:(ArdiaCoreWindow *)window autofillPrompt:(NSDictionary<NSString *, id> *)prompt forTab:(ArdiaCoreTab *)tab {
  [[self viewFor:tab] emit:@"autofillPrompt" payload:prompt];
}

- (BOOL)windowShouldClose:(ArdiaCoreWindow *)window {
  return [NillaChromeWindowHost windowShouldClose:window.window];
}

- (void)windowDidCancelClose:(ArdiaCoreWindow *)window {
  NSLog(@"[ardiacore] window close cancelled");
  [NillaWebView retryPagesInWindow:self];
}

- (void)windowCanTakeTabs:(ArdiaCoreWindow *)window {
  [NillaWebView retryPagesInWindow:self];
}

- (void)window:(ArdiaCoreWindow *)window confirmCloseWithDownloads:(int)count completion:(void (^)(BOOL))completion {
  completion(YES);
}

- (BOOL)window:(ArdiaCoreWindow *)window preHandleKeyEvent:(NSEvent *)event {
  if (KeepsReservedKeyInDevTools(window.window, event)) {
    if (event.type == NSEventTypeKeyDown && !event.isARepeat) [NillaEvents emit:@"engine.devToolsKeyKept" data:@{}];
    return NO;
  }
  return NillaPerformReservedKey(event);
}

- (BOOL)window:(ArdiaCoreWindow *)window handleKeyEvent:(NSEvent *)event {
  if (KeepsUnhandledSidebarKeyInPage(window.window, event)) return YES;
  const NSEventModifierFlags mods = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
  if (event.type == NSEventTypeKeyDown && event.keyCode == 53 && !(mods & (NSEventModifierFlagCommand | NSEventModifierFlagOption | NSEventModifierFlagControl))) {
    NSResponder *focused = window.window.firstResponder;
    NillaWebView *target = nil;
    for (ArdiaCoreProfile *profile in nilla_host::LoadedProfiles()) {
      for (ArdiaCoreTab *tab in [window tabsForProfile:profile]) {
        NillaWebView *view = [NillaTabRegistry viewForTab:tab];
        if (view.visible && [focused isKindOfClass:NSView.class] && [(NSView *)focused isDescendantOf:tab.view]) target = view;
      }
      if (target) break;
    }
    [target emit:@"command" payload:@{@"command" : @"escape", @"text" : @""}];
  }
  return gRefusesUnhandledKey && gRefusesUnhandledKey(window.window, event);
}

@end
