// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    h.set(1);
    document.dispatchEvent(new Event('pointerdown', { bubbles: true })); // nested move-ish
    h.set(2);
    document.dispatchEvent(new Event('pointerup', { bubbles: true }));
    document.dispatchEvent(new Event('pointerup', { bubbles: true }));
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
});
