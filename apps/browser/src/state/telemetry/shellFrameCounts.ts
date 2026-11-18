let source: (() => Record<string, number>) | null = null;

export function setShellFrameCountSource(take: (() => Record<string, number>) | null) {
  source = take;
}

export function takeShellFrameCounts(sharing: boolean): Record<string, number> {
  const counts = source?.() ?? {};
  return sharing ? counts : {};
}
