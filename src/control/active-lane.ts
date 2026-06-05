// src/control/active-lane.ts
export interface ActiveLaneStore {
  get(): string | null;
  set(laneId: string | null): void;
  subscribe(cb: (laneId: string | null) => void): () => void;
}

export function createActiveLaneStore(): ActiveLaneStore {
  let current: string | null = null;
  const subs = new Set<(laneId: string | null) => void>();
  return {
    get: () => current,
    set(laneId) {
      if (laneId === current) return;     // guard: dedupe → prevents UI↔APC feedback loops
      current = laneId;
      for (const cb of subs) cb(current);
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
