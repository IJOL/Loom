// Generic snapshot-based history with past/future stacks. Pure: no DOM, no IO.

export interface HistoryController<T> {
  commit(prev: T): void;
  beginGesture(prev: T): void;
  commitGesture(): void;
  cancelGesture(): void;
  undo(current: T): T | null;
  redo(current: T): T | null;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
}

export interface HistoryOptions {
  /** Max past entries. Older entries are discarded on overflow. Default 100. */
  maxSize?: number;
}

export function createHistory<T>(opts: HistoryOptions = {}): HistoryController<T> {
  const maxSize = opts.maxSize ?? 100;
  const past: T[] = [];
  const future: T[] = [];
  let pendingGesture: T | null = null;

  return {
    commit(prev) {
      past.push(prev);
      if (past.length > maxSize) past.shift();
      future.length = 0;
    },
    beginGesture(prev) {
      if (pendingGesture !== null) return;
      pendingGesture = prev;
    },
    commitGesture() {
      if (pendingGesture === null) return;
      past.push(pendingGesture);
      if (past.length > maxSize) past.shift();
      future.length = 0;
      pendingGesture = null;
    },
    cancelGesture() {
      pendingGesture = null;
    },
    undo(current) {
      pendingGesture = null;
      const prev = past.pop();
      if (prev === undefined) return null;
      future.push(current);
      return prev;
    },
    redo(current) {
      const next = future.pop();
      if (next === undefined) return null;
      past.push(current);
      if (past.length > maxSize) past.shift();
      return next;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    clear() {
      past.length = 0;
      future.length = 0;
      pendingGesture = null;
    },
  };
}
