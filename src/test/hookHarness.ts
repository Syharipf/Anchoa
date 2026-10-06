import { spyOn } from "bun:test";
import * as React from "react";

type Effect = { run: React.EffectCallback; deps?: React.DependencyList; cleanup?: () => void };

/** Exercise component handlers without a DOM or an additional test dependency.
 * Only the component under test runs; child elements retain their real props/keys.
 */
export interface HookHarness<T> {
  render(runEffects?: boolean): T;
  settle(): Promise<T>;
  runTimers(): void;
  intervalDelays(): (number | undefined)[];
  focus(): void;
  blur(): void;
  replayEffects(): void;
  dispose(): void;
}

export function hookHarness<T>(component: () => T, initialStates: Record<number, unknown> = {}): HookHarness<T> {
  const slots: unknown[] = [];
  const effects: Effect[] = [];
  let cursor = 0;
  let dirty = true;
  let disposed = false;
  let output: T;
  let pendingEffects: (() => void)[] = [];
  const timers = new Map<number, () => void>();
  const intervals = new Map<number, { run: () => void; delay: number | undefined }>();
  let timerId = 0;
  const listeners = new Map<string, Set<((e?: unknown) => void)>>();
  const docListeners = new Map<string, Set<((e?: unknown) => void)>>();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  const setTimer = ((run: () => void) => {
    timers.set(++timerId, run);
    return timerId;
  }) as unknown as typeof setTimeout;
  const clearTimer = ((id: number) => timers.delete(id)) as unknown as typeof clearTimeout;
  const setRepeatingTimer = ((run: () => void, delay?: number) => {
    intervals.set(++timerId, { run, delay });
    return timerId;
  }) as unknown as typeof setInterval;
  const clearRepeatingTimer = ((id: number) => intervals.delete(id)) as unknown as typeof clearInterval;
  globalThis.setTimeout = setTimer;
  globalThis.clearTimeout = clearTimer;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setTimeout: setTimer, clearTimeout: clearTimer,
    setInterval: setRepeatingTimer, clearInterval: clearRepeatingTimer,
    addEventListener: (name: string, run: () => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(run);
    },
    removeEventListener: (name: string, run: () => void) => listeners.get(name)?.delete(run),
    dispatchEvent: (event: Event) => { listeners.get(event.type)?.forEach((run) => run(event)); return true; },
  } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    activeElement: null, getElementById: () => null,
    addEventListener: (name: string, run: (e?: unknown) => void) => {
      if (!docListeners.has(name)) docListeners.set(name, new Set());
      docListeners.get(name)!.add(run);
    },
    removeEventListener: (name: string, run: (e?: unknown) => void) => docListeners.get(name)?.delete(run),
  } });
  const sameDeps = (a?: React.DependencyList, b?: React.DependencyList) =>
    a !== undefined && b !== undefined && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const toast = () => {};
  const spies = [
    spyOn(React, "useState").mockImplementation(((initial: unknown) => {
      const index = cursor++;
      if (!(index in slots)) {
        slots[index] = index in initialStates ? initialStates[index] :
          typeof initial === "function" ? initial() : initial;
      }
      return [slots[index], (next: unknown) => {
        const value = typeof next === "function" ? next(slots[index]) : next;
        if (!Object.is(value, slots[index])) dirty = true;
        slots[index] = value;
      }];
    }) as typeof React.useState),
    spyOn(React, "useRef").mockImplementation(((initial: unknown) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    }) as typeof React.useRef),
    spyOn(React, "useMemo").mockImplementation(((factory: () => unknown, deps?: React.DependencyList) => {
      const index = cursor++;
      const previous = slots[index] as { value: unknown; deps?: React.DependencyList } | undefined;
      if (!previous || !sameDeps(previous.deps, deps)) slots[index] = { value: factory(), deps };
      return (slots[index] as { value: unknown }).value;
    }) as typeof React.useMemo),
    spyOn(React, "useCallback").mockImplementation(((fn: () => unknown, deps: React.DependencyList) =>
      React.useMemo(() => fn, deps)) as typeof React.useCallback),
    spyOn(React, "useContext").mockImplementation((() => toast) as typeof React.useContext),
    spyOn(React, "useEffect").mockImplementation((run, deps) => {
      const index = cursor++;
      const previous = effects[index];
      if (!previous || !sameDeps(previous.deps, deps)) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          const cleanup = run();
          effects[index] = { run, deps, cleanup: cleanup || undefined };
        });
      }
    }),
  ];
  function render(runEffects = true): T {
    do {
      dirty = false;
      cursor = 0;
      pendingEffects = [];
      output = component();
      if (runEffects) pendingEffects.forEach((run) => run());
    } while (dirty);
    return output;
  }
  return {
    render,
    async settle() {
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
        if (dirty) render();
      }
      return output;
    },
    runTimers() {
      const runs = [...timers.values()];
      timers.clear();
      runs.forEach((run) => run());
      [...intervals.values()].forEach(({ run }) => run());
    },
    intervalDelays() { return [...intervals.values()].map(({ delay }) => delay); },
    focus() { listeners.get("focus")?.forEach((run) => run()); },
    blur() { listeners.get("blur")?.forEach((run) => run()); },
    replayEffects() {
      effects.forEach((effect) => effect.cleanup?.());
      effects.forEach((effect) => {
        const cleanup = effect.run();
        effect.cleanup = cleanup || undefined;
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      effects.forEach((effect) => effect.cleanup?.());
      spies.forEach((spy) => spy.mockRestore());
      globalThis.setTimeout = previousSetTimeout;
      globalThis.clearTimeout = previousClearTimeout;
      for (const [name, descriptor] of [["window", previousWindow], ["document", previousDocument]] as const) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

export function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as React.ReactNode)];
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
