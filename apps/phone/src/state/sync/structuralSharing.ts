type Plain = Record<string, unknown>;

const isPlain = (value: unknown): value is Plain => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

function sharedArray(previous: readonly unknown[], next: readonly unknown[]): readonly unknown[] {
  let out: unknown[] | null = previous.length === next.length ? null : [];
  for (let i = 0; i < next.length; i++) {
    const item = sharedWith(previous[i], next[i]);
    if (out === null && item !== previous[i]) out = previous.slice(0, i);
    if (out !== null) out.push(item);
  }
  return out ?? previous;
}

function sharedObject(previous: Plain, next: Plain): Plain {
  const keys = Object.keys(next);
  let out: Plain | null = keys.length === Object.keys(previous).length ? null : {};
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const value = sharedWith(previous[key], next[key]);
    if (out === null && (value !== previous[key] || !Object.prototype.hasOwnProperty.call(previous, key))) {
      out = {};
      for (let j = 0; j < i; j++) out[keys[j]!] = previous[keys[j]!];
    }
    if (out !== null) out[key] = value;
  }
  return out ?? previous;
}

export function sharedWith<T>(previous: unknown, next: T): T {
  if (Object.is(previous, next)) return previous as T;
  if (Array.isArray(next)) return (Array.isArray(previous) ? sharedArray(previous, next) : next) as T;
  if (isPlain(next) && isPlain(previous)) return sharedObject(previous, next) as T;
  return next;
}
