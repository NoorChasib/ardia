import { listTasks, type EngineTask } from "../../platform/performance";

export const FIRST_SAMPLE_MS = 2200;
export const SAMPLER_KEPT_MS = 12000;

let samplingSince = 0;
let lastRead = 0;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function sampleTasks(): Promise<{ tasks: EngineTask[]; waited: boolean }> {
  if (Date.now() - lastRead > SAMPLER_KEPT_MS) samplingSince = Date.now();
  lastRead = Date.now();
  const tasks = await listTasks();
  const untilMeasured = samplingSince + FIRST_SAMPLE_MS - Date.now();
  if (untilMeasured <= 0) return { tasks, waited: false };
  await wait(untilMeasured);
  lastRead = Date.now();
  return { tasks: await listTasks(), waited: true };
}
