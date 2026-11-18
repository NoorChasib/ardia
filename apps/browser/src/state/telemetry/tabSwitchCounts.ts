let source: (() => Record<string, number>) | null = null;

export function setTabSwitchCountSource(take: (() => Record<string, number>) | null) {
  source = take;
}

export const takeTabSwitchCounts = (): Record<string, number> => source?.() ?? {};
