import { useEffect, useRef, type ReactNode } from "react";
import { View } from "react-native";
import { Button, iconButton, useHover } from "../ui";

const CLOSE_BOX = iconButton.s.box;

const COVERED = { opacity: 0 } as const;
const OVER_ICON = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" } as const;

export function LeadingClose({ iconBox, close, badges, children }: { iconBox: number; close: ReactNode; badges?: ReactNode; children: ReactNode }) {
  const bleed = Math.max(0, (CLOSE_BOX - iconBox) / 2);
  const shown = close != null && close !== false;
  return (
    <View style={{ margin: -bleed, padding: bleed }}>
      <View pointerEvents={shown ? "none" : "box-none"} style={shown ? COVERED : undefined}>
        {children}
      </View>
      {shown ? <View style={OVER_ICON}>{close}</View> : null}
      {badges ? (
        <View pointerEvents="none" style={{ position: "absolute", top: bleed, left: bleed, right: bleed, bottom: bleed }}>
          {badges}
        </View>
      ) : null}
    </View>
  );
}

export function TrailingBackToPin({ tooltip, onPress, onHover }: { tooltip: string; onPress(): void; onHover(hovered: boolean): void }) {
  const { hovered, hoverProps } = useHover();
  const report = useRef(onHover);
  report.current = onHover;
  useEffect(() => report.current(hovered), [hovered]);
  useEffect(() => () => report.current(false), []);
  return (
    <View {...hoverProps}>
      <Button variant="icon" icon="arrow.uturn.backward" size="s" weight="semibold" onPress={onPress} tooltip={tooltip} />
    </View>
  );
}
