import { describe, it, expect, vi } from 'vitest';
import { withUndo } from './history-wiring';
import { createHistory } from '../core/history';
import type { SavedStateV3 } from './saved-state-v3';

describe('withUndo (neutralised)', () => {
  it('runs fn and does NOT commit to history', () => {
    const history = createHistory<SavedStateV3>();
    const snapshot = vi.fn(() => ({} as SavedStateV3));
    const restore = vi.fn();
    const fn = vi.fn(() => 42);
    const r = withUndo({ history, snapshot, restore }, fn);
    expect(r).toBe(42);
    expect(fn).toHaveBeenCalledOnce();
    expect(history.canUndo()).toBe(false);   // nothing committed
    expect(snapshot).not.toHaveBeenCalled(); // no snapshot taken
  });
});
