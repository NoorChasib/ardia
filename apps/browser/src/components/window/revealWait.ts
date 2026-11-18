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

export const EDGE_PROBE_MS = 40;

export type ProbeReply = { reveal(): void; retreat(waitEnded: boolean): void };

export type EdgeProbe = {
  track(): void;
  confirm(go: () => void): boolean;
  answer(inBand: boolean, lingering: boolean, reply: ProbeReply): boolean;
  stop(): void;
  tracking(): boolean;
};

export function edgeProbe<H = ReturnType<typeof setInterval>>(
  request: () => boolean,
  every: Schedule<H> = setInterval as unknown as Schedule<H>,
  stopEvery: (handle: H) => void = clearInterval as unknown as (handle: H) => void,
): EdgeProbe {
  let timer: H | undefined;
  let polling = false;
  let asked = false;
  let confirming: (() => void) | null = null;
  const ask = () => {
    asked = request() || asked;
    return asked;
  };
  const stop = () => {
    if (polling) stopEvery(timer as H);
    polling = false;
    asked = false;
    confirming = null;
  };
  return {
    track() {
      if (polling) return;
      polling = true;
      timer = every(ask, EDGE_PROBE_MS);
    },
    confirm(go) {
      confirming = go;
      if (ask()) return true;
      confirming = null;
      return false;
    },
    answer(inBand, lingering, reply) {
      if (!asked) return false;
      asked = false;
      const go = confirming;
      confirming = null;
      if (inBand) (go ?? reply.reveal)();
      else reply.retreat(!!go);
      if (!lingering) stop();
      return true;
    },
    stop,
    tracking: () => polling,
  };
}
