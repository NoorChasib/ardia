import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url)).replace(/\/$/, "");
export const ENGINE_STORE = join(REPO_ROOT, "apps/browser/build-ardiacore/prebuilt-linux-x86_64");
export const DEFAULT_OUT = join(REPO_ROOT, "output/linux-bench");
export const DEFAULT_LOCK = "/tmp/ardia-perflab.lock";

export function defaultContentBlocker() {
  const vendored = join(REPO_ROOT, "packages/ardiacore/vendor/ubo/ext");
  return existsSync(join(vendored, "manifest.json")) ? vendored : null;
}

export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function until(probe, { timeout, interval = 250, label = "condition", abort } = {}) {
  const deadline = Date.now() + timeout;
  let last = "";
  while (Date.now() < deadline) {
    const reason = abort?.();
    if (reason) throw new Error(`${label}: ${reason}`);
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      last = error.message;
    }
    await pause(interval);
  }
  throw new Error(`${label} not reached after ${timeout} ms${last ? ` (${last})` : ""}`);
}

export function withDeadline(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    }),
  ]);
}

export function loadAverage() {
  try {
    const [one, five, fifteen] = readFileSync("/proc/loadavg", "utf8").split(" ").map(Number);
    return { one, five, fifteen };
  } catch {
    return null;
  }
}

export function run(command, args, { timeout = 30000, env, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: env ?? process.env, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} ${args.join(" ")} timed out after ${timeout} ms`));
    }, timeout);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}: ${stderr.trim()}`));
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

export const js = (value) => JSON.stringify(value);

export function log(...parts) {
  process.stderr.write(`[bench ${new Date().toISOString().slice(11, 19)}] ${parts.join(" ")}\n`);
}

export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}
