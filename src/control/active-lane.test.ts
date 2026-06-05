// src/control/active-lane.test.ts
import { describe, it, expect } from 'vitest';
import { createActiveLaneStore } from './active-lane';

describe('active-lane store', () => {
  it('notifies subscribers on change and dedupes no-ops', () => {
    const s = createActiveLaneStore();
    const seen: (string | null)[] = [];
    s.subscribe((id) => seen.push(id));
    s.set('lane-a');
    s.set('lane-a');        // no-op, must not notify again
    s.set('lane-b');
    expect(seen).toEqual(['lane-a', 'lane-b']);
    expect(s.get()).toBe('lane-b');
  });
  it('unsubscribe stops notifications', () => {
    const s = createActiveLaneStore();
    const seen: (string | null)[] = [];
    const off = s.subscribe((id) => seen.push(id));
    s.set('x');
    off();
    s.set('y');
    expect(seen).toEqual(['x']);
  });
});
