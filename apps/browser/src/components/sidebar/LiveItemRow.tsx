import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Pressable, View } from "react-native";
import { closeTab } from "../../state/browser/actions";
import { COMPLETION_MS, openLiveItem, returnLiveTab } from "../../state/live/engine";
import { prBadge } from "../../state/live/github";
import { SOURCES } from "../../state/live/sources";
import { hideItems, useLive } from "../../state/live/store";
import type { CompletedItem, LiveItem } from "../../state/live/types";
import { usePageProfileId } from "../../state/browser/hooks";
import { useIsActiveIn, useLiveItemTab, useLiveTabOpen, useTabAwayFromPin } from "../../state/sidebar/hooks";
import type { CloseControl } from "../../state/sidebar/closeControl";
import { noteLiveRowHide } from "../../state/telemetry/liveHides";
import { HoverSlot } from "../ui/HoverSlot";
import { Badge, Button, ContextMenuArea, Dot, hairline, ink, space, Symbol, Text, useHover, withAlpha } from "../ui";
import { curve, springs } from "../ui/motion";
import { hex, layout, useTheme } from "../ui/theme";
import { useLiveColors, type LiveColors } from "../live/tokens";
import { modifiersOf } from "../../lib/keys";
import { dismissHover } from "../../state/sidebar/hover";
import { useRowHover } from "./hoverController";
import { openLiveItemMenu } from "../../state/sidebar/liveMenus";
import { registerRow } from "../../state/sidebar/sidebarUi";
import { withShortcut } from "../../state/commands/commandShortcuts";
import { sidebarTabIconSize, TabIcon } from "./TabIcon";
import { SIDEBAR_MOTION, sidebarTokens, TAB_ROW, useSidebarTokens } from "./tokens";
import { useSidebarRowLook } from "./rowLook";
import { LeadingClose, TrailingBackToPin } from "./LeadingClose";
import { rowEnds } from "../../state/sidebar/closeSide";
import { noteTabCloseButtonPress } from "../../state/telemetry/hoverCardCounts";
import { SidebarRowLabel, SidebarRowSurface } from "./SidebarRow";

const liveRowKey = (folderId: string, itemId: string) => `live|${folderId}|${itemId}`;

export function LiveItemRow({ folderId, item, windowId, inStack = false }: { folderId: string; item: LiveItem; windowId: string; inStack?: boolean }) {
  const indent = inStack ? STACK_INDENT : 0;
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const { closeTabHint: closeHint, backToPinHint, quiet, closeLeft } = useSidebarRowLook();
  const backToPin = useHover();
  const [trailingBackHovered, setTrailingBackHovered] = useState(false);
  const colors = useLiveColors();
  const key = liveRowKey(folderId, item.id);
  const profileId = usePageProfileId();
  const tabId = useLiveItemTab(windowId, profileId, folderId, item.id);
  const active = useIsActiveIn(windowId, profileId, tabId);
  const away = useTabAwayFromPin(tabId);
  const tabOpen = useLiveTabOpen(folderId, [item.id]);
  const unread = useLive((s) => !!s.unread[folderId]?.includes(item.id));
  const completion = useLive((s) => (s.completing[folderId]?.includes(item.id) ? (s.completed[folderId]?.find((c) => c.item.id === item.id)?.state ?? "merged") : null));
  const { hovered, hoverProps } = useRowHover(windowId, completion ? null : { kind: "live", id: key });
  const fold = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!completion) return;
    fold.setValue(1);
    Animated.sequence([
      Animated.delay(COMPLETION_MS - 420),
      Animated.timing(fold, { toValue: 0, duration: SIDEBAR_MOTION.liveFold, easing: curve.enter, useNativeDriver: false }),
    ]).start();
  }, [completion]);
  const fill = quiet ? (active ? tokens.quietWash : hovered ? tokens.quietHover : ink.clear) : active ? theme.tabSelected : hovered ? theme.tabHover : ink.clear;
  const border = active && !quiet ? 0.5 : 0;
  const pressedFill = quiet ? tokens.quietPressed : theme.tabPressed;
  const titleColor = completion ? theme.textSecondary : quiet ? hex(withAlpha(theme.textTab, active ? tokens.quietActiveText : tokens.quietText)) : active ? theme.rowSelectedText : theme.textTab;
  const resettable = away && !completion;
  const resetting = resettable && (closeLeft ? trailingBackHovered && hovered : backToPin.hovered);
  const control = liveRowControl(folderId, item, tabId, tabOpen, closeHint);
  const ends = rowEnds(closeLeft ? "left" : "right", hovered && !!control && !completion, resettable);
  const backToPinTooltip = withShortcut("Back to Pinned URL", backToPinHint);
  const closeButton = control ? (
    <Button
      variant="icon"
      icon={control.icon}
      size="s"
      weight="semibold"
      onPress={() => {
        if (control.closesTab) noteTabCloseButtonPress(closeLeft);
        control.press();
      }}
      tooltip={control.tooltip}
    />
  ) : null;
  const itemIcon = <ItemIcon item={item} completion={completion} colors={colors} />;

  return (
    <Animated.View style={completion ? { height: fold.interpolate({ inputRange: [0, 1], outputRange: [0, layout.rowHeight] }), opacity: fold, overflow: "hidden" } : null}>
      <View ref={(v) => registerRow(windowId, key, v)} {...hoverProps}>
        <ContextMenuArea
          onContextMenu={() => {
            dismissHover();
            void openLiveItemMenu(windowId, folderId, item, tabId);
          }}
        >
          <Pressable
            onPress={(e) => {
              dismissHover();
              openLiveItem(windowId, folderId, item, { background: modifiersOf(e).metaKey });
            }}
          >
            {({ pressed }) => (
              <SidebarRowSurface fill={!active && pressed ? pressedFill : fill} selected={active && !quiet} border={border} padLeft={TAB_ROW.contentLeft + indent - border} padRight={TAB_ROW.trailing - border}>
                {unread ? <Dot size={5} color={theme.accent} style={{ position: "absolute", left: UNREAD_DOT_LEFT + indent - border }} /> : null}
                {closeLeft ? (
                  <LeadingClose iconBox={item.pr ? LIVE_GLYPH : sidebarTabIconSize(false)} close={ends.lead === "close" ? closeButton : null}>
                    {itemIcon}
                  </LeadingClose>
                ) : (
                  <View {...backToPin.hoverProps}>
                    {resettable ? (
                      <Pressable
                        onPress={() => tabId && returnLiveTab(tabId)}
                        tooltip={backToPinTooltip}
                        accessibilityRole="button"
                        accessibilityLabel="Back to Pinned URL"
                      >
                        {resetting ? (
                          <Symbol name="arrow.uturn.backward" size={11} weight="semibold" color={active ? theme.rowSelectedText : theme.textTab} style={{ width: LIVE_GLYPH, height: LIVE_GLYPH }} />
                        ) : (
                          itemIcon
                        )}
                      </Pressable>
                    ) : (
                      itemIcon
                    )}
                  </View>
                )}
                <SidebarRowLabel
                  text={resetting ? "Back to Pinned URL" : item.title}
                  weight={unread ? "medium" : undefined}
                  color={titleColor}
                />
                {inStack && item.pr?.stack ? <PositionChip position={item.pr.stack.position} /> : null}
                <HoverSlot
                  hovered={hovered && !!control && !completion}
                  reserve={inStack && item.pr?.stack ? "always" : "hover"}
                  hover={ends.trail === "close" ? closeButton : null}
                >
                  <Trailing item={item} completion={completion} colors={colors} />
                </HoverSlot>
                {ends.trailingBackToPin === "none" ? null : (
                  <HoverSlot hovered={ends.trailingBackToPin === "shown"} hover={<TrailingBackToPin tooltip={backToPinTooltip} onPress={() => tabId && returnLiveTab(tabId)} onHover={setTrailingBackHovered} />} />
                )}
              </SidebarRowSurface>
            )}
          </Pressable>
        </ContextMenuArea>
      </View>
    </Animated.View>
  );
}

const UNREAD_DOT_LEFT = 2;
const LIVE_GLYPH = 16;
const LIVE_GLYPH_BOX = { width: LIVE_GLYPH, height: LIVE_GLYPH } as const;
const STACK_INDENT = 10;
const POSITION_CHIP = { marginLeft: space.xs } as const;

type LiveRowControl = CloseControl & { closesTab: boolean; press(): void };

function liveRowControl(folderId: string, item: LiveItem, tabId: string | null, tabOpen: boolean, closeHint: string | undefined): LiveRowControl | null {
  if (tabId) return { icon: "minus", tooltip: withShortcut("Close Tab", closeHint), closesTab: true, press: () => void closeTab(tabId) };
  if (item.pr && !tabOpen)
    return {
      icon: "xmark",
      tooltip: "Hide Until Refresh",
      closesTab: false,
      press: () => {
        hideItems(folderId, [item]);
        noteLiveRowHide();
      },
    };
  return null;
}

function PositionChip({ position }: { position: number }) {
  return (
    <View style={POSITION_CHIP}>
      <Badge text={position} tone="chip" size="m" />
    </View>
  );
}

export const COMPLETION_GLYPH: Record<CompletedItem["state"], { symbol: string; color: keyof LiveColors }> = {
  merged: { symbol: "checkmark.circle.fill", color: "merged" },
  reviewed: { symbol: "checkmark.circle.fill", color: "success" },
  closed: { symbol: "xmark.circle.fill", color: "draft" },
};

function ItemIcon({ item, completion, colors }: { item: LiveItem; completion: CompletedItem["state"] | null; colors: LiveColors }) {
  const pop = useRef(new Animated.Value(completion ? 0 : 1)).current;
  useEffect(() => {
    if (!completion) return;
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, ...springs.bouncy, useNativeDriver: true }).start();
  }, [completion]);
  if (completion) {
    const glyph = COMPLETION_GLYPH[completion];
    return (
      <Animated.View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center", transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }}>
        <Symbol name={glyph.symbol} size={14} weight="semibold" color={colors[glyph.color]} style={{ width: 16, height: 16 }} />
      </Animated.View>
    );
  }
  if (item.pr) {
    return <Symbol name="arrow.triangle.pull" size={12} weight="semibold" color={item.pr.draft ? colors.draft : colors.success} style={LIVE_GLYPH_BOX} />;
  }
  if (item.icon && /^https?:/.test(item.icon)) return <TabIcon url={item.url} favicon={item.icon} direct />;
  return <TabIcon url={item.source === "confluence" && !item.icon ? SOURCES.confluence.site : item.url} icon={item.icon} />;
}

const BADGES: Record<NonNullable<ReturnType<typeof prBadge>>, { symbol: string | null; color: keyof LiveColors; tip: string }> = {
  conflict: { symbol: "exclamationmark.triangle.fill", color: "conflict", tip: "Merge conflicts" },
  failing: { symbol: "xmark.circle.fill", color: "failure", tip: "Checks are failing" },
  changesRequested: { symbol: "arrow.uturn.backward.circle.fill", color: "failure", tip: "Changes Requested" },
  pending: { symbol: null, color: "pending", tip: "Some checks haven't completed yet" },
  approved: { symbol: "checkmark.circle.fill", color: "success", tip: "Approved" },
  passed: { symbol: "checkmark", color: "success", tip: "All checks have passed" },
};

const COMPLETION_LABEL = { marginRight: space.xs } as const;

function Trailing({ item, completion, colors }: { item: LiveItem; completion: CompletedItem["state"] | null; colors: LiveColors }): ReactNode {
  const theme = useTheme();
  if (completion) {
    return (
      <Text size="caption" weight="medium" color={colors[COMPLETION_GLYPH[completion].color]} style={COMPLETION_LABEL}>
        {completion === "merged" ? "Merged" : completion === "reviewed" ? "Reviewed" : "Closed"}
      </Text>
    );
  }
  const badge = item.pr ? prBadge(item.pr) : null;
  if (!badge) return null;
  const spec = BADGES[badge];
  return (
    <View tooltip={spec.tip} style={{ width: TAB_ROW.closeSlot, height: TAB_ROW.closeSlot, alignItems: "center", justifyContent: "center" }}>
      {spec.symbol ? (
        <Symbol name={spec.symbol} size={11} weight="semibold" color={colors[spec.color]} style={{ width: 16, height: 16 }} />
      ) : (
        <Dot size={7} color={colors[spec.color]} ring={sidebarTokens(theme).liveDotRing} ringWidth={hairline.ring} />
      )}
    </View>
  );
}
