import { useEffect } from "react";
import { Image, StyleSheet, View } from "react-native";
import { useSettings } from "../../state/browser/hooks";
import { noteTabPreviewDrawn, previewAspect, useTabPreview } from "../../state/tabs/tabPreview";
import { pagePreviewOn } from "../../state/tabs/tabPictures";
import { useTheme } from "../ui/theme";
import { TAB_PREVIEW, TAB_SWITCHER } from "./tokens";

export function TabCardPreview({ windowId, tabId }: { windowId: string; tabId: string }) {
  const on = useSettings(pagePreviewOn);
  return on ? <PagePreview windowId={windowId} tabId={tabId} /> : null;
}

function PagePreview({ windowId, tabId }: { windowId: string; tabId: string }) {
  const theme = useTheme();
  const { state, picture, uri } = useTabPreview(windowId, tabId);
  useEffect(() => noteTabPreviewDrawn(state), [tabId, state]);
  if (!picture || !uri) return null;
  return (
    <View
      testID="ardia.tabHoverPreview"
      accessible
      accessibilityLabel="Page preview"
      style={{ marginTop: TAB_PREVIEW.gap, alignSelf: "stretch", maxHeight: TAB_PREVIEW.maxHeight, borderRadius: TAB_PREVIEW.radius, overflow: "hidden", backgroundColor: TAB_PREVIEW.pageFill }}
    >
      <Image source={{ uri }} resizeMode="cover" style={{ width: "100%", aspectRatio: previewAspect(picture.frame, TAB_SWITCHER.shotAspect) }} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: TAB_PREVIEW.radius, borderWidth: TAB_PREVIEW.ring, borderColor: theme.divider }]} />
    </View>
  );
}
