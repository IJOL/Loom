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

describe('history — maxSize', () => {
  it('drops oldest past entry when commit overflows maxSize', () => {
    const h = createHistory<number>({ maxSize: 3 });
    h.commit(1);
    h.commit(2);
    h.commit(3);
    h.commit(4); // pushes out 1
    // 4 undos: 3 should succeed (returning 4,3,2), 4th returns null
    expect(h.undo(99)).toBe(4);
    expect(h.undo(99)).toBe(3);
    expect(h.undo(99)).toBe(2);
    expect(h.undo(99)).toBe(null);
  });

  it('default maxSize is 100', () => {
    const h = createHistory<number>();
    for (let i = 0; i < 150; i++) h.commit(i);
    // Undo 100 times returns the most recent 100 (149..50)
    let last: number | null = null;
    for (let i = 0; i < 100; i++) last = h.undo(999);
    expect(last).toBe(50);
    expect(h.undo(999)).toBe(null);
  });
});
