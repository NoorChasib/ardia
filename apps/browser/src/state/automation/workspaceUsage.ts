import type { EngineTask } from "../../platform/performance";
import { sampleTasks } from "../tabs/taskSampler";
import type { FolderNode, GroupNode, TabNode, Workspace } from "./workspaceTree";

export type TabUsage = { pid: number | null; cpu: number | null; memory: number | null };

const NO_PROCESS: TabUsage = { pid: null, cpu: null, memory: null };

export function usageByTab(tasks: EngineTask[]): Map<string, TabUsage> {
  const usage = new Map<string, TabUsage>();
  for (const t of tasks) {
    const own: TabUsage = {
      pid: typeof t.pid === "number" && t.pid > 0 ? t.pid : null,
      cpu: Number.isFinite(t.cpu) ? Math.round(t.cpu * 10) / 10 : null,
      memory: t.memory > 0 ? Math.round(t.memory) : null,
    };
    for (const id of t.tabIds) if (id && !usage.has(id)) usage.set(id, own);
  }
  return usage;
}

export async function sampleTabUsage(): Promise<Map<string, TabUsage>> {
  return usageByTab((await sampleTasks()).tasks);
}

type Node = TabNode | GroupNode | FolderNode;

const withUsage = <T extends Node>(node: T, usage: Map<string, TabUsage>): T =>
  node.type === "tab" ? { ...node, ...(usage.get(node.id) ?? NO_PROCESS) } : { ...node, items: node.items.map((item) => withUsage(item, usage)) };

export function workspaceWithUsage(tree: Workspace, usage: Map<string, TabUsage>): Workspace {
  return {
    ...tree,
    windows: tree.windows.map((w) => ({
      ...w,
      spaces: w.spaces.map((space) => ({
        ...space,
        topApps: space.topApps.map((node) => withUsage(node, usage)),
        pinned: space.pinned.map((node) => withUsage(node, usage)),
        tabs: space.tabs.map((node) => withUsage(node, usage)),
      })),
    })),
  };
}
