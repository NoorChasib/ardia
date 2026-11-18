import type { TabMemory } from "../../state/tabs/tabMemory";

const MB = 1024 * 1024;

export function memoryAmount(bytes: number): string {
  const mb = bytes / MB;
  if (mb < 1) return "<1 MB";
  const whole = Math.round(mb);
  return whole < 1024 ? `${whole} MB` : `${(mb / 1024).toFixed(1)} GB`;
}

export function tabMemoryLabel(memory: TabMemory): string {
  switch (memory.kind) {
    case "measuring":
      return "Memory: measuring…";
    case "exact":
      return `Memory: ${memoryAmount(memory.bytes)}`;
    case "estimate":
      return `Memory: about ${memoryAmount(memory.bytes)}, partly shared`;
    case "shared":
      return memory.unnamed || memory.tabs < 2
        ? `Memory: ${memoryAmount(memory.bytes)}, shared with other pages`
        : `Memory: ${memoryAmount(memory.bytes)}, shared by ${memory.tabs} tabs`;
    case "unavailable":
      return "Memory: not available";
    case "asleep":
      return "Memory: freed while asleep";
  }
}
