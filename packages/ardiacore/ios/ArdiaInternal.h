#import <AppKit/AppKit.h>

#import "ArdiaCore.h"
#import "ArdiaEvents.h"
#import "ArdiaFavicons.h"
#import "ArdiaHost.h"
#import "ArdiaTabStrip.h"
#import "ArdiaTabRegistry.h"
#import "ArdiaWindowController.h"

@class NillaWebView;

NS_ASSUME_NONNULL_BEGIN

namespace nilla_host {

ArdiaCoreProfile *_Nullable LoadedProfile(NSString *name);
bool IsDeletedProfile(NSString *name);
void WithProfile(NSString *name, void (^completion)(ArdiaCoreProfile *_Nullable profile));
NSString *ProfileName(ArdiaCoreProfile *_Nullable profile);
ArdiaCoreProfile *_Nullable PersonalIfLoaded(ArdiaCoreEngine *engine);
bool IsPrivateProfile(NSString *_Nullable name);
bool IsPrivateSessionId(NSString *_Nullable name);
NSString *ProfileDirectoryName(NSString *_Nullable name);
NSString *ProfileNameOfDirectoryName(NSString *_Nullable directory);
NSString *OriginalProfileName(NSString *_Nullable name);
NSString *OriginalProfileNameOf(ArdiaCoreProfile *_Nullable profile);
bool IsOffTheRecordOf(ArdiaCoreProfile *_Nullable profile, NSString *_Nullable name);
NSArray<NSString *> *LoadedProfileNames();

int BrowserId(ArdiaCoreTab *tab);
ArdiaCoreTab *_Nullable TabWithBrowserId(int browserId);
NSString *_Nullable AppTabIdOf(ArdiaCoreTab *_Nullable tab);
id AppTabIdValue(ArdiaCoreTab *_Nullable tab);
ArdiaCoreTab *_Nullable TabWithAppTabId(NSString *_Nullable tabId);
void HoldUntilHosted(ArdiaCoreTab *tab, NSString *event, NSDictionary *payload);
void ReleaseHeldEvents(ArdiaCoreTab *tab);
void DropHeldEvent(NSString *event, NSString *eventId);

NSString *AppDisposition(NSString *chromeDisposition);

void InstallActivationGuardsEarly();
void InstallActivationGuardsLate();
bool Background();
void LogActivation(NSString *what);
void WatchFocusChanges();
void NotePointer(NSEvent *event, NSString *_Nullable swallowedBy);
void BeginPressLoop(NSString *name);
void EndPressLoop();
void NoteProfileSwitch(ArdiaCoreProfile *profile, NSWindow *_Nullable window);
NSString *FocusState();
NSString *PageMoveAt(NSWindow *window, NSPoint point);
NSString *HoverProbeDev(NSWindow *window, NSString *_Nullable argument);
NSString *HoverProbeLine();
void WatchHover();
void WatchPageCursor();
NSString *PageCursorDev(NSWindow *window, NSString *_Nullable argument);
NSString *PaintProbeLine();
void WatchPainting();
NSString *DescribeFocusWindow(NSWindow *_Nullable window);
void NoteFocusChange(NSString *what, NSWindow *_Nullable window);
void SetAppActive(bool active);
void ActToggleFullScreen(NSWindow *window);
void InstallTestCrashGuard(NSString *_Nullable dataDir);

void OpenPopupWindow(ArdiaCoreTab *tab, NillaWebView *_Nullable opener);
ArdiaCoreWindow *_Nullable PopupWindowForChromeBrowser(ArdiaCoreProfile *profile);
void ChromeMakesAppWindow(ArdiaCoreProfile *profile);
bool IsReservedKeyEvent(NSEvent *event);
bool IsReservedBinding(NSString *key, NSString *unshiftedKey, NSEventModifierFlags modifiers);
NSUInteger PopupWindowCount();
bool AskPermissionInPopupWindow(ArdiaCoreTab *tab, NSDictionary *request);
void DropPopupWindowPermission(NSString *requestId);
void NotePasswordPromptSource(NillaWebView *view, ArdiaCoreTab *_Nullable source);
ArdiaCoreTab *_Nullable PasswordPromptTab(NillaWebView *view, ArdiaCoreTab *_Nullable own);

}

@interface NillaTabStrip (Engine)
+ (void)changedInWindow:(NillaWindowController *)controller profile:(ArdiaCoreProfile *)profile;
+ (void)changedInWindow:(NillaWindowController *)controller profile:(ArdiaCoreProfile *)profile cause:(nullable id)cause;
+ (void)windowClosed:(NillaWindowController *)controller;
+ (void)activated:(ArdiaCoreTab *)tab inWindow:(NillaWindowController *)controller;
+ (nullable ArdiaCoreTab *)activeTabInWindow:(NillaWindowController *)controller profile:(ArdiaCoreProfile *)profile;
+ (void)removed:(ArdiaCoreTab *)tab fromWindow:(NillaWindowController *)controller;
+ (void)setPinned:(BOOL)pinned tab:(ArdiaCoreTab *)tab;
@end

namespace nilla_host {
NSArray<ArdiaCoreProfile *> *LoadedProfiles();
void LoadContentBlocker(NSString *profile);
void PrepareContentBlocker();
}

@interface NillaFavicons (Tabs)
+ (void)noteImage:(nullable NSImage *)image forURL:(nullable NSString *)url profile:(nullable NSString *)profile;
@end

NS_ASSUME_NONNULL_END
