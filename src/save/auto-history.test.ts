import { describe, it, expect, vi } from 'vitest';
import { createHistory } from '../core/history';
import { createAutoHistory, type AutoHistory } from './auto-history';
import type { SavedStateV3 } from './saved-state-v3';

// A tiny fake "state": just a counter wrapped to look like SavedStateV3 for the
// purposes of snapshot equality (JSON.stringify). We only need a serialisable
// object that changes value, so cast through unknown.
function makeHarness() {
  let live = { n: 0 };
  const history = createHistory<SavedStateV3>({ maxSize: 100 });
  const restored: SavedStateV3[] = [];
  const refreshAll = vi.fn();
  const ah = createAutoHistory({
    history,
    snapshot: () => (JSON.parse(JSON.stringify(live)) as unknown) as SavedStateV3,
    restore: (s) => { live = (JSON.parse(JSON.stringify(s)) as unknown) as { n: number }; restored.push(s); },
    refreshAll,
  });
  return {
    ah, refreshAll, restored,
    set: (n: number) => { live = { n }; },
    get: () => live.n,
  };
}

describe('AutoHistory.checkpoint', () => {
  it('commits the pre-change baseline only when state changed', () => {
    const h = makeHarness();
    h.set(1); h.ah.checkpoint();          // 0 -> 1 : commits baseline 0
    expect(h.ah.canUndo()).toBe(true);
    h.ah.checkpoint();                    // no change : no-op
    h.ah.undo();
    expect(h.get()).toBe(0);              // restored the pre-change baseline
  });

  it('no-ops when the state is unchanged', () => {
    const h = makeHarness();
    h.ah.checkpoint();
    expect(h.ah.canUndo()).toBe(false);
  });
});

describe('AutoHistory gesture coalescing', () => {
  it('collapses many intermediate states between begin/end into ONE undo', () => {
    const h = makeHarness();
    h.ah.beginGesture();
    h.set(1); h.ah.checkpoint();          // suppressed mid-gesture
    h.set(2); h.ah.checkpoint();          // suppressed
    h.set(3);
    h.ah.endGesture();                    // single commit of baseline 0
    expect(h.ah.canUndo()).toBe(true);
    h.ah.undo();
    expect(h.get()).toBe(0);
    expect(h.ah.canUndo()).toBe(false);   // only ONE step existed
  });
});

describe('AutoHistory undo/redo + baseline resync', () => {
  it('round-trips and a checkpoint right after undo is a no-op', () => {
    const h = makeHarness();
    h.set(1); h.ah.checkpoint();
    h.set(2); h.ah.checkpoint();
    h.ah.undo();                          // -> 1
    expect(h.get()).toBe(1);
    h.ah.checkpoint();                    // baseline resynced to 1 -> no spurious commit
    h.ah.redo();                          // -> 2
    expect(h.get()).toBe(2);
    expect(h.refreshAll).toHaveBeenCalledTimes(2); // 1 undo + 1 redo
  });
});

describe('AutoHistory.markClean', () => {
  it('resets baseline without committing and clears history', () => {
    const h = makeHarness();
    h.set(1); h.ah.checkpoint();
    h.set(5);
    h.ah.markClean();                     // baseline = 5, history cleared
    expect(h.ah.canUndo()).toBe(false);
    h.ah.checkpoint();
    expect(h.ah.canUndo()).toBe(false);   // 5 == baseline, nothing to commit
  });
});

describe('AutoHistory.onChange', () => {
  it('fires on commit, undo and redo; unsubscribes', () => {
    const h = makeHarness();
    const cb = vi.fn();
    const off = h.ah.onChange(cb);
    h.set(1); h.ah.checkpoint();          // commit -> fire
    h.ah.undo();                          // fire
    off();
    h.ah.redo();                          // not counted
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
