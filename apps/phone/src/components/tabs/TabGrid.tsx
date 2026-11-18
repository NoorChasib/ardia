import { memo, useCallback, useMemo, useRef, useState } from "react";
import { haptics } from "../../state/app/haptics";
import { countRender } from "../../state/app/interactionPerf";
import { type LayoutChangeEvent, Pressable, ScrollView, type ScrollViewInstance, StyleSheet, Text, View } from "react-native";
import Animated, { FadeOut, LinearTransition, useAnimatedStyle, useSharedValue, withSpring, type BaseAnimationBuilder, type LayoutAnimationFunction } from "react-native-reanimated";
import type { DeckGeometry } from "../../lib/deckGeometry";
import { shownTone } from "../../lib/pageTone";
import { useHeldPageTone } from "../../state/browse/deckHold";
import { menuOpenedHaptic } from "../../state/browse/tabMenus";
import { display } from "../../state/search/omnibox";
import type { BrowserTab } from "../../state/tabs/tabModels";
import { isUnseenReceived } from "../../lib/tabFace";
import { capsule, ChromeSurface, deckChromeLayout, FadeView, font, screenReaderActions, Symbol, TabFace, tabsLayout, tabsMotion, useTheme } from "../ui";
import { CardIcon, CardMenu, ReceivedBadge } from "./DeckCard";
import { deckHeaderBottom } from "./DeckHeader";
import { centredGridOffset, tabGridColumns, tabGridInk, tabGridInsets, tabGridLayout, tabGridMotion, tabGridRowHeight, tabGridStartOffset } from "./tabGridLayout";

type Props = {
  tabs: readonly BrowserTab[];
  selectedId: string | null;
  geometry: DeckGeometry;
  reduceMotion: boolean;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
};

export const TabGrid = memo(function TabGrid({ tabs, selectedId, geometry: g, reduceMotion, onOpen, onClose }: Props) {
  countRender("TabGrid");
  const insets = tabGridInsets(g.safeTop, deckHeaderBottom(), g.height, g.barCenterY, deckChromeLayout.barCircle, g.safeSide + deckChromeLayout.headerSide);
  const columns = tabGridColumns(g.width - insets.side * 2);
  const aspect = g.width / Math.max(g.height, 1);
  const viewportTop = insets.top - tabGridLayout.topFade;
  const [focusId] = useState(() => (selectedId && tabs.some((tab) => tab.id === selectedId) ? selectedId : (tabs[tabs.length - 1]?.id ?? null)));
  const [startOffset] = useState(() => {
    const focus = tabs.findIndex((tab) => tab.id === focusId);
    return tabGridStartOffset(focus, tabs.length, columns.count, tabGridRowHeight(columns.width, aspect), g.height - viewportTop, insets.bottom);
  });
  const scroll = useRef<ScrollViewInstance>(null);
  const measured = useRef<{ viewport?: number; content?: number; cell?: { y: number; height: number }; centred?: boolean }>({});
  const centre = useCallback(() => {
    const m = measured.current;
    if (m.centred || m.viewport === undefined || m.content === undefined || !m.cell) return;
    m.centred = true;
    scroll.current?.scrollTo({ x: 0, y: centredGridOffset(m.cell.y, m.cell.height, m.viewport, m.content), animated: false });
  }, []);
  const focusLaidOut = useCallback(
    (event: LayoutChangeEvent) => {
      measured.current.cell = { y: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height };
      centre();
    },
    [centre],
  );
  const reflow = useMemo(() => (reduceMotion ? LinearTransition.duration(tabsMotion.fade) : LinearTransition.springify().stiffness(tabGridMotion.reflow.stiffness).damping(tabGridMotion.reflow.damping).mass(tabGridMotion.reflow.mass)), [reduceMotion]);
  return (
    <FadeView testID="tabGrid" top={{ length: tabGridLayout.topFade }} style={[styles.viewport, { top: viewportTop }]}>
      <ScrollView
        testID="tabGridScroll"
        ref={scroll}
        contentOffset={{ x: 0, y: startOffset }}
        onLayout={(event) => {
          measured.current.viewport = event.nativeEvent.layout.height;
          centre();
        }}
        onContentSizeChange={(_width, height) => {
          measured.current.content = height;
          centre();
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingTop: tabGridLayout.topFade, paddingBottom: insets.bottom, paddingHorizontal: insets.side }]}
      >
        {tabs.map((tab) => (
          <TabGridCell key={tab.id} tab={tab} selected={tab.id === selectedId} width={columns.width} aspect={aspect} reflow={reflow} onLaidOut={tab.id === focusId ? focusLaidOut : undefined} onOpen={onOpen} onClose={onClose} />
        ))}
      </ScrollView>
    </FadeView>
  );
});

const GRID_CELL_LEAVE = FadeOut.duration(tabsMotion.fade);

type CellProps = {
  tab: BrowserTab;
  selected: boolean;
  width: number;
  aspect: number;
  reflow: BaseAnimationBuilder | LayoutAnimationFunction;
  onLaidOut: ((event: LayoutChangeEvent) => void) | undefined;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
};

const TabGridCell = memo(function TabGridCell({ tab, selected, width, aspect, reflow, onLaidOut, onOpen, onClose }: CellProps) {
  countRender("TabGridCell");
  const theme = useTheme();
  const tone = shownTone(useHeldPageTone(tab.id), tab.themeColorHex);
  const host = display(tab.url).host;
  const title = tab.title || host || "New Tab";
  const open = () => onOpen(tab.id);
  const close = () => onClose(tab.id);
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const press = (to: number) => {
    scale.value = withSpring(to, tabGridMotion.press);
  };
  const fill = tone.top ?? theme.surface;
  return (
    <Animated.View testID="tabGridCell" layout={reflow} exiting={GRID_CELL_LEAVE} style={{ width }} onLayout={onLaidOut}>
    <View style={styles.cell}>
      <View testID="tabGridHeader" style={styles.header}>
        <CardIcon tab={tab} />
        <Text testID="tabGridTitle" style={[font.footnote, styles.title, { color: theme.headerText }]} numberOfLines={1}>
          {tab.isPrivate ? "Incognito" : title}
        </Text>
        <Pressable testID="tabGridClose" accessibilityRole="button" accessibilityLabel="Close Tab" onPress={close} style={styles.closeHit}>
          <ChromeSurface shape="circle" cornerRadius={capsule(tabGridLayout.closeCircle)} dark={theme.dark} style={styles.closeCircle}>
            <Symbol name="xmark" size={tabGridLayout.closeGlyph} color={theme.secondaryLabel} />
          </ChromeSurface>
        </Pressable>
      </View>
      <CardMenu testID="tabGridCardMenu" tab={tab} close={close} haptic={menuOpenedHaptic}>
        {({ onLongPress }) => (
          <Pressable
            testID="tabGridCard"
            accessibilityRole="button"
            accessibilityLabel={title}
            accessibilityValue={{ text: tab.isPrivate ? `Incognito, ${host}` : host }}
            accessibilityState={{ selected }}
            {...screenReaderActions([
              { name: "activate", run: open },
              { name: "close", label: "Close Tab", run: close },
            ])}
            onPress={open}
            onLongPress={onLongPress}
            onPressIn={() => {
              haptics.barPress();
              press(tabGridLayout.pressedScale);
            }}
            onPressOut={() => press(1)}
          >
            <Animated.View testID="tabGridFace" style={[styles.card, { width, height: width / aspect, backgroundColor: fill }, pressStyle]}>
              <TabFace tab={tab} title={title} host={host} tone={tone.top} roles={theme} />
              {isUnseenReceived(tab) ? <ReceivedBadge /> : null}
              <View
                testID="tabGridEdge"
                pointerEvents="none"
                style={[styles.edge, selected ? { borderWidth: tabGridLayout.selectedEdge, borderColor: theme.formAccent } : { borderWidth: tabGridLayout.edge, borderColor: theme.cardEdge }]}
              />
            </Animated.View>
          </Pressable>
        )}
      </CardMenu>
    </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  viewport: { position: "absolute", left: 0, right: 0, bottom: 0 },
  content: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", columnGap: tabGridLayout.columnSpacing, rowGap: tabGridLayout.rowSpacing },
  cell: { gap: tabGridLayout.cellSpacing },
  header: { flexDirection: "row", alignItems: "center", gap: tabGridLayout.headerSpacing, height: tabGridLayout.closeHit.height },
  title: { flex: 1, fontWeight: "500" },
  closeHit: { width: tabGridLayout.closeHit.width, height: tabGridLayout.closeHit.height, alignItems: "center", justifyContent: "center" },
  closeCircle: { width: tabGridLayout.closeCircle, height: tabGridLayout.closeCircle, alignItems: "center", justifyContent: "center" },
  card: { borderRadius: tabsLayout.cardRadius, borderCurve: "continuous", overflow: "hidden", boxShadow: tabGridInk.shadow },
  edge: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, borderRadius: tabsLayout.cardRadius, borderCurve: "continuous" },
});
