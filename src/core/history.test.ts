import { describe, it, expect } from 'vitest';
import { createHistory } from './history';

describe('history — commit / undo / redo basics', () => {
  it('starts empty: canUndo and canRedo are false', () => {
    const h = createHistory<number>();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.undo(42)).toBe(null);
    expect(h.redo(42)).toBe(null);
  });

  it('commit then undo restores the committed value', () => {
    const h = createHistory<number>();
    h.commit(1);
    expect(h.canUndo()).toBe(true);
    expect(h.undo(2)).toBe(1);
  });

  it('redo reverses undo exactly', () => {
    const h = createHistory<number>();
    h.commit(1);
    const restored = h.undo(2);
    expect(restored).toBe(1);
    expect(h.canRedo()).toBe(true);
    expect(h.redo(1)).toBe(2);
    expect(h.canRedo()).toBe(false);
    expect(h.canUndo()).toBe(true);
  });

  it('new commit after undo clears the redo stack', () => {
    const h = createHistory<number>();
    h.commit(1);
    h.undo(2);
    expect(h.canRedo()).toBe(true);
    h.commit(2);
    expect(h.canRedo()).toBe(false);
    expect(h.redo(3)).toBe(null);
  });

  it('clear empties both stacks', () => {
    const h = createHistory<number>();
    h.commit(1);
    h.commit(2);
    h.undo(3);
    h.clear();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });
});
