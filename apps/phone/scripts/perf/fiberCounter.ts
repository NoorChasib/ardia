type Fiber = {
  tag: number;
  type: unknown;
  elementType: unknown;
  child: Fiber | null;
  sibling: Fiber | null;
  alternate: Fiber | null;
  flags: number;
  memoizedProps: unknown;
};

type FiberRoot = { current: Fiber };

export type RenderTally = { commits: number; renders: Map<string, number>; mounts: number };

const PERFORMED_WORK = 1;
const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);

let tally: RenderTally | null = null;

function nameOf(fiber: Fiber): string {
  const type = (fiber.type ?? fiber.elementType) as { displayName?: string; name?: string; render?: { displayName?: string; name?: string }; type?: { displayName?: string; name?: string } } | null;
  if (!type) return "Anonymous";
  return type.displayName || type.name || type.render?.displayName || type.render?.name || type.type?.displayName || type.type?.name || "Anonymous";
}

function rendered(fiber: Fiber) {
  if (fiber.alternate === null) return true;
  return (fiber.flags & PERFORMED_WORK) === PERFORMED_WORK;
}

function walk(first: Fiber | null, into: RenderTally) {
  const stack: Fiber[] = [];
  if (first) stack.push(first);
  while (stack.length) {
    const node = stack.pop()!;
    if (node.sibling) stack.push(node.sibling);
    if (COMPONENT_TAGS.has(node.tag) && rendered(node)) {
      const name = nameOf(node);
      into.renders.set(name, (into.renders.get(name) ?? 0) + 1);
      if (node.alternate === null) into.mounts += 1;
    }
    const untouched = node.alternate !== null && node.child === node.alternate.child;
    if (node.child && !untouched) stack.push(node.child);
  }
}

function changedSubtree(root: FiberRoot, into: RenderTally) {
  const current = root.current;
  into.commits += 1;
  if (current.alternate === null || current.child !== current.alternate.child) walk(current.child, into);
}

const hook = (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: Record<string, unknown> }).__REACT_DEVTOOLS_GLOBAL_HOOK__ ?? {};
Object.assign(hook, {
  isDisabled: false,
  supportsFiber: true,
  renderers: new Map(),
  inject: () => 1,
  checkDCE: () => undefined,
  onScheduleFiberRoot: () => undefined,
  onCommitFiberRoot: (_id: number, root: FiberRoot) => {
    if (tally) changedSubtree(root, tally);
  },
  onCommitFiberUnmount: () => undefined,
  onPostCommitFiberRoot: () => undefined,
  setStrictMode: () => undefined,
});
(globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;

export function startTally() {
  tally = { commits: 0, renders: new Map(), mounts: 0 };
}

export function stopTally(): RenderTally {
  const done = tally ?? { commits: 0, renders: new Map(), mounts: 0 };
  tally = null;
  return done;
}

export function totalRenders(done: RenderTally) {
  let total = 0;
  for (const count of done.renders.values()) total += count;
  return total;
}
