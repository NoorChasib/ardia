let source: (() => Record<string, number>) | null = null;

export function setShellFrameCountSource(take: (() => Record<string, number>) | null) {
  source = take;
}

export const takeShellFrameCounts = (): Record<string, number> => source?.() ?? {};
