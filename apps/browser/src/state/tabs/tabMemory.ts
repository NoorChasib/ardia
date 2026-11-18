import { useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import type { EngineTask } from "../../platform/performance";
import { noteTabMemorySample, noteTabMemoryShown } from "../telemetry/hoverCardCounts";
import { isSleeping, useIsSleeping } from "./sleepingTabs";
import { sampleTasks } from "./taskSampler";

export type TabMemory =
  | { kind: "measuring" }
  | { kind: "exact"; bytes: number }
  | { kind: "estimate"; bytes: number }
  | { kind: "shared"; bytes: number; tabs: number; unnamed: boolean }
  | { kind: "unavailable" }
  | { kind: "asleep" };

export type TabMemorySnapshot = { at: number; tasks: EngineTask[] | null; reading: boolean; failed: boolean };

export const SNAPSHOT_KEPT_MS = 20_000;
export const SNAPSHOT_REREAD_MS = 2_000;

const MEASURING: TabMemory = { kind: "measuring" };
const UNAVAILABLE: TabMemory = { kind: "unavailable" };
const ASLEEP: TabMemory = { kind: "asleep" };
const PAGE_TASKS = new Set<EngineTask["type"]>(["renderer", "guest"]);
const NAMELESS_TASKS = new Set<EngineTask["type"]>(["renderer", "guest", "extension"]);

export const useTabMemorySnapshot = create<TabMemorySnapshot>()(() => ({ at: 0, tasks: null, reading: false, failed: false }));

const named = (task: EngineTask) => task.tabIds.filter((id): id is string => !!id);
const realPid = (task: EngineTask) => (typeof task.pid === "number" && task.pid > 0 ? task.pid : null);

export function attributeTabMemory(tasks: EngineTask[], tabId: string): TabMemory {
  const pids = new Set<number>();
  for (const task of tasks) {
    const pid = realPid(task);
    if (pid !== null && task.tabIds.includes(tabId)) pids.add(pid);
  }
  if (!pids.size) return UNAVAILABLE;
  let exclusiveBytes = 0;
  let splitBytes = 0;
  let sharedBytes = 0;
  let exclusive = 0;
  let unnamed = false;
  const sharers = new Set<string>([tabId]);
  for (const pid of pids) {
    const inProcess = tasks.filter((task) => realPid(task) === pid);
    const memory = Math.max(...inProcess.map((task) => (Number.isFinite(task.memory) ? task.memory : 0)));
    if (!(memory > 0)) return MEASURING;
    const tabs = new Set<string>([tabId]);
    for (const task of inProcess) if (PAGE_TASKS.has(task.type)) for (const id of named(task)) tabs.add(id);
    const nameless = inProcess.filter((task) => NAMELESS_TASKS.has(task.type) && !named(task).length).length;
    if (tabs.size === 1 && !nameless) {
      exclusive++;
      exclusiveBytes += memory;
      continue;
    }
    splitBytes += memory / (tabs.size + nameless);
    sharedBytes += memory;
    if (nameless) unnamed = true;
    for (const id of tabs) sharers.add(id);
  }
  if (exclusive === pids.size) return { kind: "exact", bytes: exclusiveBytes };
  if (exclusive) return { kind: "estimate", bytes: exclusiveBytes + splitBytes };
  return { kind: "shared", bytes: sharedBytes, tabs: sharers.size, unnamed };
}

const measured = (tasks: EngineTask[], tabId: string) => {
  const kind = attributeTabMemory(tasks, tabId).kind;
  return kind !== "measuring" && kind !== "unavailable";
};

export function measureTabMemory(tabId: string) {
  if (isSleeping(tabId)) return;
  const { at, tasks, reading } = useTabMemorySnapshot.getState();
  if (reading) return;
  const age = Date.now() - at;
  if (tasks && (age < SNAPSHOT_REREAD_MS || (age < SNAPSHOT_KEPT_MS && measured(tasks, tabId)))) return;
  useTabMemorySnapshot.setState({ reading: true });
  sampleTasks().then(
    (sample) => {
      useTabMemorySnapshot.setState({ at: Date.now(), tasks: sample.tasks, reading: false, failed: false });
      noteTabMemorySample(sample.waited, false);
    },
    () => {
      useTabMemorySnapshot.setState({ at: Date.now(), tasks: [], reading: false, failed: true });
      noteTabMemorySample(false, true);
    },
  );
}

export type TabMemoryReading = { memory: TabMemory; settled: boolean };

export function tabMemoryReading(snapshot: TabMemorySnapshot, asleep: boolean, tabId: string, now: number): TabMemoryReading {
  if (asleep) return { memory: ASLEEP, settled: true };
  if (!snapshot.tasks) return { memory: snapshot.failed ? UNAVAILABLE : MEASURING, settled: snapshot.failed && !snapshot.reading };
  const memory = attributeTabMemory(snapshot.tasks, tabId);
  const unmeasured = memory.kind === "measuring" || memory.kind === "unavailable";
  if (snapshot.reading) return { memory: unmeasured || now - snapshot.at >= SNAPSHOT_KEPT_MS ? MEASURING : memory, settled: false };
  return { memory: memory.kind === "measuring" ? UNAVAILABLE : memory, settled: true };
}

export function useTabMemory(tabId: string): TabMemoryReading {
  const asleep = useIsSleeping(tabId);
  const snapshot = useTabMemorySnapshot();
  return useMemo(() => tabMemoryReading(snapshot, asleep, tabId, Date.now()), [snapshot, asleep, tabId]);
}

export function useTabMemoryLine(tabId: string): TabMemory {
  useEffect(() => measureTabMemory(tabId), [tabId]);
  const { memory, settled } = useTabMemory(tabId);
  const noted = useRef<string | null>(null);
  useEffect(() => {
    if (!settled || noted.current === tabId || memory.kind === "measuring") return;
    noted.current = tabId;
    noteTabMemoryShown(memory.kind);
  }, [settled, memory.kind, tabId]);
  return memory;
}
