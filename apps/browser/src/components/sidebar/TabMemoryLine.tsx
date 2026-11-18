import { useSettings } from "../../state/browser/hooks";
import { attributesTabMemory, useTabMemoryLine } from "../../state/tabs/tabMemory";
import { space, Text } from "../ui";
import { tabMemoryLabel } from "./tabMemoryLabel";

const LINE = { marginTop: space.xs } as const;

export function TabMemoryLine({ tabId }: { tabId: string }) {
  const on = useSettings((s) => s.showMemoryInTabHoverMenu) && attributesTabMemory();
  return on ? <MemoryLine tabId={tabId} /> : null;
}

function MemoryLine({ tabId }: { tabId: string }) {
  const memory = useTabMemoryLine(tabId);
  return (
    <Text testID="ardia.tabHoverMemory" lines={2} size="caption" tone="textTertiary" style={LINE}>
      {tabMemoryLabel(memory)}
    </Text>
  );
}
