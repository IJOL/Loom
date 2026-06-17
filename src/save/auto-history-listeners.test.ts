// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createHistory } from '../core/history';
import { createAutoHistory } from './auto-history';
import type { SavedStateV3 } from './saved-state-v3';

function harness() {
  let live = { n: 0 };
  const history = createHistory<SavedStateV3>({ maxSize: 100 });
  const ah = createAutoHistory({
    history,
    snapshot: () => (JSON.parse(JSON.stringify(live)) as unknown) as SavedStateV3,
    restore: (s) => { live = (JSON.parse(JSON.stringify(s)) as unknown) as { n: number }; },
    refreshAll: vi.fn(),
  });
  const uninstall = ah.installGlobalListeners(document);
  return { ah, uninstall, set: (n: number) => { live = { n }; }, get: () => live.n };
}
// pointerup defers endGesture via queueMicrotask so the checkpoint runs after the
// full pointerup dispatch but before the next macrotask. Use a microtask tick.
const tick = () => new Promise<void>((r) => queueMicrotask(r));

describe('global listeners', () => {
  it('a pointer gesture (down→up) over a mutation collapses to one undo', async () => {
    const h = harness();
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    h.set(1);
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2 })); // nested move-ish
    h.set(2);
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    await tick();
    expect(h.ah.canUndo()).toBe(true);
    h.ah.undo();
    expect(h.get()).toBe(0);
    expect(h.ah.canUndo()).toBe(false);
    h.uninstall();
  });

  it('a discrete keyup commits a checkpoint', async () => {
    const h = harness();
    h.set(5);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'x', bubbles: true }));
    await tick();
    expect(h.ah.canUndo()).toBe(true);
    h.uninstall();
  });

  it('Ctrl+Z keyup does NOT create a checkpoint', async () => {
    const h = harness();
    h.set(5);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'z', ctrlKey: true, bubbles: true }));
    await tick();
    expect(h.ah.canUndo()).toBe(false);
    h.uninstall();
  });

  // Fix A: pointercancel (browser steals pointer) must NOT leave gestureDepth stuck.
  // A gesture that ends in pointercancel must still commit a checkpoint on the next
  // clean interaction (depth didn't stay stuck at 1).
  it('Fix A — pointercancel ends the gesture; subsequent interaction can still undo', async () => {
    const h = harness();
    // Gesture 1: ends in pointercancel (no pointerup)
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    h.set(1);
    document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
    await tick(); // let microtask-endGesture run
    // Gesture 2: clean pointer interaction with a mutation
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2 }));
    h.set(2);
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2 }));
    await tick();
    // Gesture 2's mutation must be capturable via undo
    expect(h.ah.canUndo()).toBe(true);
    h.uninstall();
  });

  // Fix B: self-heal resets a leaked gestureDepth increment so the very next
  // pointer interaction can still create an undo checkpoint.
  it('Fix B — leaked beginGesture is self-healed on next pointerdown', async () => {
    const h = harness();
    // Simulate a control that calls beginGesture but never endGesture
    // (e.g. a pointer-capture widget that misses its pointercancel).
    h.ah.beginGesture(); // leaked: no matching endGesture
    // Fresh pointer interaction — should self-heal the stale depth and commit
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 3 }));
    h.set(42);
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 3 }));
    await tick();
    expect(h.ah.canUndo()).toBe(true);
    h.uninstall();
  });
});
