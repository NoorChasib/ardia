#pragma once

#import <AppKit/AppKit.h>

@class NillaWebView;

namespace nilla_pip {

void WatchZoom();

NSWindow *GrabbedWindow();

void VideoEntered(NillaWebView *view, NSString *host);

void DocumentEntered(NillaWebView *view);

void TabRequestedActivation(NillaWebView *view);

}
