export function connectCdp(url, { connectTimeout = 10000, callTimeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    const listeners = new Map();
    let next = 1;
    let closed = false;
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error(`CDP connect timed out: ${url}`));
    }, connectTimeout);
    const fail = (error) => {
      closed = true;
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(error);
      }
      pending.clear();
    };
    const client = {
      get closed() {
        return closed;
      },
      send(method, params = {}, { sessionId, timeout = callTimeout } = {}) {
        if (closed) return Promise.reject(new Error(`CDP closed before ${method}`));
        const id = next++;
        const message = { id, method, params };
        if (sessionId) message.sessionId = sessionId;
        return new Promise((res, rej) => {
          const t = setTimeout(() => {
            pending.delete(id);
            rej(new Error(`${method} timed out after ${timeout} ms`));
          }, timeout);
          pending.set(id, { resolve: res, reject: rej, timer: t, method });
          ws.send(JSON.stringify(message));
        });
      },
      on(event, fn) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(fn);
        return () => listeners.get(event)?.delete(fn);
      },
      close() {
        if (closed) return;
        closed = true;
        try { ws.close(); } catch {}
      },
    };
    ws.onopen = () => {
      clearTimeout(timer);
      resolve(client);
    };
    ws.onerror = (event) => {
      clearTimeout(timer);
      if (!closed) reject(new Error(`CDP websocket error: ${event.message ?? url}`));
      fail(new Error("CDP websocket error"));
    };
    ws.onclose = () => fail(new Error("CDP websocket closed"));
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const entry = pending.get(message.id);
        if (!entry) return;
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message} ${message.error.data ?? ""}`.trim()));
        else entry.resolve(message.result);
        return;
      }
      for (const fn of listeners.get(message.method) ?? []) {
        try {
          fn(message.params, message.sessionId);
        } catch {}
      }
    };
  });
}

export async function evaluate(client, expression, { sessionId, timeout = 30000, userGesture = true } = {}) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture }, { sessionId, timeout });
  if (result.exceptionDetails) {
    const d = result.exceptionDetails;
    throw new Error(d.exception?.description ?? d.text ?? "evaluation failed");
  }
  return result.result.value;
}

export class Session {
  constructor(browser, sessionId, targetId) {
    this.browser = browser;
    this.sessionId = sessionId;
    this.targetId = targetId;
  }

  send(method, params = {}, options = {}) {
    return this.browser.send(method, params, { ...options, sessionId: this.sessionId });
  }

  eval(expression, options = {}) {
    return evaluate(this.browser, expression, { ...options, sessionId: this.sessionId });
  }

  async detach() {
    await this.browser.send("Target.detachFromTarget", { sessionId: this.sessionId }, { timeout: 5000 }).catch(() => {});
  }
}

export async function attach(browser, targetId, timeout = 10000) {
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true }, { timeout });
  return new Session(browser, sessionId, targetId);
}

export async function pageTargets(browser) {
  const { targetInfos } = await browser.send("Target.getTargets", {}, { timeout: 10000 });
  return targetInfos;
}
