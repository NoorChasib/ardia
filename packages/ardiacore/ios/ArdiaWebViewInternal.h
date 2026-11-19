#import "ArdiaInternal.h"
#import "ArdiaWebView.h"
#import "ArdiaNowPlaying.h"
#import "ArdiaTabLifecycle.h"

enum class NillaPageFocus { Unknown, Page, DevTools, Elsewhere };

@class NillaWebView;

struct NillaRequests {
  BOOL loadedOnce{};
  NSString *requestedURL;
};

struct NillaSentReports {
  BOOL navigationQueued{};
  NSDictionary *navigation;
  NSString *favicon;
  NSUInteger blockedGeneration{};
  BOOL blockedEmitQueued{};
  CFTimeInterval progressAt{};
  double progress{};
  BOOL progressQueued{};
};

struct NillaLeave {
  BOOL active{};
  NSUInteger generation{};
};

struct NillaFrameHold {
  BOOL awaiting{};
  NSUInteger generation{};
  NSArray *mark;
  __weak NSView *pane;
  CGFloat paneZ{};
  BOOL holding{};
  __weak NillaWebView *holdingFor;
  NSUInteger holdGeneration{};
  __weak NillaWebView *tookOverFrom;
  CFTimeInterval tookOverAt{};
};

struct NillaStandIn {
  __weak NSView *page;
  ArdiaCoreTab *tab;
  __weak NillaWebView *lender;
  BOOL closes{};
  BOOL leaving{};
  float opacity{};
  NSUInteger generation{};
  __weak NillaWebView *lentTo;
};

enum class NillaHeldPageEnd { Painted, Loaded, Pressed, TimedOut, Detached };

struct NillaFirstPaint {
  BOOL created{};
  BOOL held{};
  BOOL settled{};
  BOOL coldTab{};
  BOOL scripted{};
  CFTimeInterval heldAt{};
  float opacity{};
  NSUInteger generation{};
};

struct NillaReveal {
  BOOL active{};
  NSUInteger generation{};
  __weak NSView *loweredPane;
  CGFloat loweredPaneZ{};
  __weak NSView *frontedPage;
  NSUInteger frontGeneration{};
};

struct NillaPageReports {
  NSString *theme;
  NSString *themeSource;
  NSInteger blockedCount{};
  NSString *lastBlocked;
  NillaNowPlaying *nowPlaying;
  NSMutableDictionary<NSString *, NSString *> *notificationFrames;
  NSMutableDictionary<NSString *, NSDictionary *> *displayRequests;
  double pinchScale{};
  BOOL capturing{};
  BOOL crashed{};
  BOOL seenByUser{YES};
  BOOL inPictureInPicture{};
  BOOL autoPictureInPictureActive{};
  BOOL keptByWindowServer{};
  BOOL playedForAutoPictureInPicture{};
};

struct NillaCommits {
  __weak ArdiaCoreTab *tab;
  NSString *url;
  double at{};
  int httpStatus{};
  int documents{};
};

struct NillaPageFocusState {
  NillaPageFocus page{NillaPageFocus::Unknown};
  __weak NSView *devTools;
  __weak NSView *elsewhere;
  BOOL onActivate{};
  BOOL keepsOutgoing{};
  CFTimeInterval activatedAt{};
  __weak NSWindow *activatedIn;
};

@interface NillaWebView () <ArdiaCoreTabDelegate> {
  __weak id<NillaWebViewDelegate> _delegate;
  NillaTabLifecycle _life;
  NillaRequests _requests;
  NillaSentReports _sent;
  NillaLeave _leave;
  NillaFrameHold _frameHold;
  void (^_swapReport)(BOOL heldTimedOut);
  CFTimeInterval _swapReportAt;
  NillaStandIn _standIn;
  NillaFirstPaint _firstPaint;
  NillaReveal _reveal;
  NillaPageFocusState _focus;
  NillaPageReports _reports;
  NillaCommits _commits;
  NSString *_profile;
  NSString *_initialURL;
  NSString *_adoptId;
  NSString *_transferKey;
  BOOL _standalone;
  BOOL _temporary;
  NSString *_temporarySource;
  NSString *_extensionHost;
  NSColor *_pageBackgroundColor;
  NSColor *_contentsBackgroundColor;
  NSString *_pageColor;
  NSString *_shownURL;
  BOOL _visible;
  BOOL _warm;
  BOOL _neighbour;
  BOOL _autoPictureInPicture;
  BOOL _frozen;
  ArdiaCoreTab *_tab;
  BOOL _muted;
  NSInteger _tabIndex;
  BOOL _pinned;
  NSView *_devtoolsView;
  CFTimeInterval _linkDropAt;
  NSMutableArray<NSDictionary<NSString *, id> *> *_newTabLinks;
  id _sightObserver;
  id _interfaceScaleObserver;
}
- (NillaWindowController *)controller;
- (void)emit:(NSString *)name payload:(NSDictionary *)payload;
@end

typedef NS_ENUM(NSInteger, NillaTransfer) {
  NillaTransferNone,
  NillaTransferTaken,
  NillaTransferHeld,
};

@interface NillaWebView (TransferInternal)
+ (BOOL)keepTransfersOfWindow:(NSWindow *)window;
+ (void)retryPagesInWindow:(NillaWindowController *)controller;
- (void)waitForWindow;
- (BOOL)takeLinkTab:(NSString *)adoptId;
- (void)ensureTab;
- (BOOL)cloneTab:(NSString *)sourceKey profile:(ArdiaCoreProfile *)profile;
- (BOOL)canTake:(ArdiaCoreTab *)tab;
- (NillaTransfer)takeTransferredTab;
- (void)bindRestoreKey;
- (void)forgetRestoreKey;
@end

@interface NillaWebView (TabInternal)
- (ArdiaCoreAdoption)adoptIntoWindow;
- (ArdiaCoreAdoption)windowTakes:(ArdiaCoreTab *)tab;
- (void)adoptMovedPage;
- (BOOL)holdTransferOf:(ArdiaCoreTab *)tab;
- (void)attach:(ArdiaCoreTab *)tab;
- (void)detach;
@property(nonatomic, readonly) NSString *keptFromUnloadingBy;
- (BOOL)unloadKeepingHistory;
- (void)stashPageReports;
- (void)takePageReports;
- (void)placeTab;
- (void)openedTab:(ArdiaCoreTab *)tab adoptId:(NSString *)adoptId disposition:(NSString *)disposition;
- (void)openedLinkTab:(ArdiaCoreTab *)tab adoptId:(NSString *)adoptId disposition:(NSString *)disposition;
- (void)openedPopupTab:(ArdiaCoreTab *)tab;
- (BOOL)opensPopupsAsTabs;
- (void)announceOpenedTab:(ArdiaCoreTab *)tab
                  adoptId:(NSString *)adoptId
              disposition:(NSString *)disposition
                     link:(BOOL)link
                    tries:(int)tries;
- (void)noteNewTabLink:(nullable NSString *)url;
- (void)tabRemovedFromWindow:(ArdiaCoreWindow *)window;
- (void)tabActivatedByChrome:(BOOL)chromes;
- (void)devToolsChanged:(NSView *)devToolsView;
- (void)dropDevTools;
@end

@interface NillaWebView (PaintingInternal)
+ (void)sleepNeighbourPagesIn:(NSWindow *)window after:(CFTimeInterval)delay;
+ (void)repaintWarmPagesIn:(NSWindow *)window;
+ (void)noteShown:(ArdiaCoreTab *)tab;
+ (void)drainPainting;
- (void)layoutPage;
- (void)interfaceScaleChanged;
- (BOOL)paints;
- (BOOL)neighbourPageAsleep;
- (void)applyPainting;
- (void)markTemporary;
- (BOOL)seenByUser;
- (void)userSightChanged;
- (void)schedulePainting;
- (void)leaveScreen;
- (void)beginFrameHoldIfCold;
- (void)exposePage;
- (BOOL)releasePageForOffscreen;
- (void)reportSwapShown:(void (^)(BOOL heldTimedOut))report;
- (void)finishFrameHold;
- (void)stopHolding;
- (void)takeFocusFromLingeringPane;
@end

@interface NillaWebView (FirstPaintInternal)
- (void)holdPageUntilPainted:(BOOL)created;
- (void)holdCreatedPageShown;
- (void)showHeldPage:(NillaHeldPageEnd)end;
- (void)showHeldPageOnNextFrame;
- (void)showHeldPageAfterLoad;
@end

@interface NillaWebView (StandInInternal)
- (void)lendPageToSuccessor;
- (void)reclaimLentPage;
- (BOOL)closesLentTab:(ArdiaCoreTab *)tab;
- (void)dropStandIn;
- (void)finishStandIn;
@end

@interface NillaWebView (FocusInternal)
+ (NillaWebView *)holding:(id)responder;
- (void)storePageFocus;
- (void)storePageFocusFrom:(NSResponder *)responder;
- (void)requestFocusRestore;
- (void)requestFocusRestoreIn:(NSWindow *)window;
- (void)restoreFocusIfDue;
- (BOOL)focusRememberedDevToolsIn:(NSWindow *)window;
- (void)focusAfterLingeringPane;
- (void)settleFirstShowFocus;
- (void)focusAfterLoad;
@end

@interface NillaWebView (RevealsInternal)
+ (void)dropRevealsInWindow:(NSWindow *)window except:(NillaWebView *)keep;
- (BOOL)onlyShownInWindow;
- (void)frontPage:(NSView *)page profile:(ArdiaCoreProfile *)profile;
- (void)dropFront;
- (void)revealAhead;
- (void)endReveal;
- (void)dropReveal;
- (void)settleRevealsInWindow;
@end

@interface NillaWebView (PageMessagesInternal)
- (void)noteScriptFrame:(NSString *)frameId main:(BOOL)main;
- (void)forgetScriptFrame:(NSString *)frameId;
- (void)pushSelectionPopover;
- (void)callFrame:(NSString *)frameId kind:(NSString *)kind json:(NSString *)json;
- (void)resetPageMedia;
@end

@interface NillaWebView (PeekInternal)
- (void)pushPeekModifier;
- (BOOL)peeksLinksToOtherSites;
- (void)fallBackFromPeek:(NSDictionary *)dict url:(NSString *)url frame:(NSString *)frameId reason:(NSString *)reason test:(BOOL)test;
- (void)peekLink:(NSDictionary *)dict frame:(NSString *)frameId main:(BOOL)main;
@end

@interface NillaWebView (PictureInPictureInternal)
- (void)traceManualPictureInPicture:(NSString *)what;
- (void)traceAutoPictureInPicture:(NSString *)what;
- (void)notePictureInPictureSight:(NSString *)what;
- (void)awaitPictureInPicture:(int)tries completion:(void (^)(BOOL))completion;
- (void)updateAutoPictureInPicture;
- (BOOL)leftAppInPictureInPicture;
- (BOOL)playsForAutoPictureInPicture;
- (void)autoPictureInPictureInputsChanged;
- (void)noteStayedOnAppSwitch;
+ (BOOL)playsForAutoPictureInPictureInWindow:(NSWindow *)window;
@end

@interface NillaWebView (NavigationInternal)
- (void)emitNavigation;
- (void)queueNavigation;
- (NSString *)committedURL;
- (void)followCommitsOfTab;
- (void)resetBlocked:(BOOL)report;
- (void)sendProgress;
- (void)loadNow:(NSString *)url userInitiated:(BOOL)userInitiated;
- (BOOL)skipsNavigationDownload:(NSString *)url userInitiated:(BOOL)userInitiated;
@end

@interface NillaWebView (PageCommandsInternal)
- (void)emitMedia;
- (void)emitZoom;
- (void)runChromeCommand:(int)command;
- (void)thawHiddenPage;
- (BOOL)awaitsFirstDocument;
@end

@interface NillaWebView (InputMonitorsInternal)
+ (BOOL)prewarmForMouseEvent:(NSEvent *)event;
- (BOOL)canWakeFrames;
- (void)commandWheelFromPage:(NSDictionary *)reply;
@end

namespace nilla_web_view {

constexpr CFTimeInterval kNeighbourPagesAwakeSeconds = 10;

bool TraceVisibility();
NSHashTable<NillaWebView *> *LiveViews();
bool SamePage(NSString *a, NSString *b);
NSString *OriginOf(NSString *url);
NSString *VerifiedOrigin(NSString *origin);
void NoteEvent(int browserId, NSString *name, NSDictionary *payload);
void AcceptDrops(NSView *root, BOOL accept);
NSView *PaneUnder(NSView *view, NSView *ancestor);
NSView *SharedAncestor(NSView *a, NSView *b);
NSView *RenderWidgetIn(NSView *page);
NSArray *FrameMarkOf(NSView *widget);

template <typename T>
T *Field(NSDictionary *d, NSString *key) {
  id value = d[key];
  return [value isKindOfClass:[T class]] ? value : nil;
}

NSString *Text(NSDictionary *d, NSString *key, NSUInteger max);
bool Flag(NSDictionary *d, NSString *key);
bool Finite(NSDictionary *d, NSString *key, double *out);

void AnswerHello(ArdiaCoreTab *tab, NSString *profile, NSString *frameId, BOOL main, NSString *verifiedOrigin);
NSMutableOrderedSet<NSString *> *ScriptFramesOf(ArdiaCoreTab *tab);

extern NSString *gPeekModifier;
void InstallPeekMonitor();
BOOL PeekTracing();
void PeekTrace(NSDictionary *entry);
NSString *SplitLinkModifier();
NSString *PeekConfigJSON(NillaWebView *view);
NSDictionary *_Nullable RecentClickPoint(NillaWebView *view);

NSPoint RootPointFromWindow(NSWindow *window, NSPoint inWindow);
NSRect RootRectFromWindow(NSWindow *window, NSRect inWindow);
CGFloat RootPointsPerLocalPoint(NSView *view);
BOOL MayHoldUserActivation(NSWindow *window);
BOOL TakeShiftClick(NillaWebView *view);

void InstallControlPressMonitor();
BOOL TracingPictureInPicture();

}
