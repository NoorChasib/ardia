type TakeCounts = () => Record<string, number>;

const sources = new Map<string, TakeCounts>();

export function addShellCountSource(name: string, take: TakeCounts) {
  sources.set(name, take);
  return () => {
    if (sources.get(name) === take) sources.delete(name);
  };
}

export function takeShellCounts(sharing: boolean): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const take of sources.values()) Object.assign(counts, take());
  return sharing ? counts : {};
}
