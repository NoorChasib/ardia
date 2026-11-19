import { useSettings } from "../../state/browser/hooks";
import { memoryLineOn, useTabMemoryLine } from "../../state/tabs/tabMemory";
import { space, Text } from "../ui";
import { tabMemoryLabel } from "./tabMemoryLabel";

const LINE = { marginTop: space.xs } as const;

export function TabMemoryLine({ tabId }: { tabId: string }) {
  const on = useSettings(memoryLineOn);
  return on ? <MemoryLine tabId={tabId} /> : null;
}

function MemoryLine({ tabId }: { tabId: string }) {
  const memory = useTabMemoryLine(tabId);
  return (
    <Text testID="nilla.tabHoverMemory" lines={2} size="caption" tone="textTab" style={LINE}>
      {tabMemoryLabel(memory)}
    </Text>
  );
}
