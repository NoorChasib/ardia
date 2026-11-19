#import <Foundation/Foundation.h>

enum class NillaTabPhase { Waiting, Creating, Attached, Closing };

struct NillaTabLifecycle {
  NillaTabPhase phase{NillaTabPhase::Waiting};
  NSUInteger createEpoch{};
  NSString *pendingURL;
  BOOL pendingUserInitiated{};
  NSString *creatingURL;
  CFTimeInterval creatingAt{};
  NSString *transferredURL;
  BOOL handingOff{};
  BOOL moving{};
  BOOL offerClosed{};
  BOOL launchCloseSent{};

  bool closed() const { return phase == NillaTabPhase::Closing; }

  bool canCreate() const { return phase == NillaTabPhase::Waiting; }

  NSUInteger beginCreating() {
    phase = NillaTabPhase::Creating;
    return ++createEpoch;
  }

  bool isCurrent(NSUInteger epoch) const { return epoch == createEpoch && !closed(); }

  void resumeCreating() {
    if (phase == NillaTabPhase::Waiting) phase = NillaTabPhase::Creating;
  }

  void leaveCreating() {
    if (phase == NillaTabPhase::Creating) phase = NillaTabPhase::Waiting;
  }

  bool canAttach(bool hasTab) const { return !closed() && !hasTab; }

  void attached() { phase = NillaTabPhase::Attached; }

  void detached() {
    if (phase == NillaTabPhase::Attached) phase = NillaTabPhase::Waiting;
  }

  void handOff() { createEpoch++; }

  void close() {
    createEpoch++;
    phase = NillaTabPhase::Closing;
  }
};
