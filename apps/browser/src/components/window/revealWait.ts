type Schedule<H> = (run: () => void, ms: number) => H;

export type RevealWait = { start(ms: number, run: () => void): boolean; cancel(): boolean; pending(): boolean };

export function revealWait<H = ReturnType<typeof setTimeout>>(
  schedule: Schedule<H> = setTimeout as unknown as Schedule<H>,
  cancel: (handle: H) => void = clearTimeout as unknown as (handle: H) => void,
): RevealWait {
  let handle: H | undefined;
  let waiting = false;
  return {
    start(ms, run) {
      if (waiting) return false;
      if (ms <= 0) {
        run();
        return true;
      }
      waiting = true;
      handle = schedule(() => {
        waiting = false;
        run();
      }, ms);
      return true;
    },
    cancel() {
      if (!waiting) return false;
      waiting = false;
      cancel(handle as H);
      return true;
    },
    pending: () => waiting,
  };
}
