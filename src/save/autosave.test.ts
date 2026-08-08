import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAutosave } from './autosave';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function harness(over: { enabled?: () => boolean } = {}) {
  const written: unknown[] = [];
  let n = 0;
  let resolveWrite: (() => void) | null = null;
  const auto = createAutosave({
    enabled: over.enabled ?? (() => true),
    buildState: () => ({ n: ++n }),
    write: (s) => {
      written.push(s);
      return resolveWrite ? new Promise<void>((r) => { resolveWrite = () => { r(); }; }) : Promise.resolve();
    },
    delayMs: 100,
  });
  return { auto, written, hold: () => { resolveWrite = () => {}; }, release: () => resolveWrite?.() };
}

describe('createAutosave', () => {
  it('waits for the app to go quiet before writing', () => {
    const h = harness();
    h.auto.request();
    expect(h.written).toHaveLength(0);
    vi.advanceTimersByTime(100);
    expect(h.written).toHaveLength(1);
  });

  it('collapses a burst into ONE write', () => {
    // The events worth reacting to arrive in bursts. Serialising the session
    // per keystroke and throwing it away is the thing to avoid.
    const h = harness();
    for (let i = 0; i < 20; i++) { h.auto.request(); vi.advanceTimersByTime(10); }
    vi.advanceTimersByTime(100);
    expect(h.written).toHaveLength(1);
  });

  it('builds the state at FIRE time, not per request', () => {
    const h = harness();
    h.auto.request();
    h.auto.request();
    h.auto.request();
    vi.advanceTimersByTime(100);
    // The counter would read 3 if each request had built one.
    expect(h.written).toEqual([{ n: 1 }]);
  });

  it('does nothing at all while switched off', () => {
    const h = harness({ enabled: () => false });
    h.auto.request();
    vi.advanceTimersByTime(1000);
    expect(h.written).toHaveLength(0);
  });

  it('declines a pending write if it is switched off before it fires', () => {
    // Read at fire time, so the settings UI never has to reach in and cancel.
    let on = true;
    const h = harness({ enabled: () => on });
    h.auto.request();
    on = false;
    vi.advanceTimersByTime(1000);
    expect(h.written).toHaveLength(0);
  });

  it('flushes immediately, without the wait', async () => {
    const h = harness();
    await h.auto.flush();
    expect(h.written).toHaveLength(1);
  });

  it('cancel drops what was pending', () => {
    const h = harness();
    h.auto.request();
    h.auto.cancel();
    vi.advanceTimersByTime(1000);
    expect(h.written).toHaveLength(0);
  });

  it('never runs two writes at once — they share one slot', async () => {
    const h = harness();
    h.hold();
    void h.auto.flush();          // starts, and does not finish
    void h.auto.flush();          // must not start a second
    expect(h.written).toHaveLength(1);
  });

  it('re-runs once after a write that was asked to repeat mid-flight', async () => {
    // So the recovery copy ends up holding the LATEST state, not the one that
    // happened to be mid-write.
    const h = harness();
    h.hold();
    void h.auto.flush();
    void h.auto.flush();
    h.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.written.length).toBeGreaterThanOrEqual(2);
  });

  it('reports a failed write instead of throwing at whatever triggered it', async () => {
    const onError = vi.fn();
    const auto = createAutosave({
      enabled: () => true,
      buildState: () => ({}),
      write: () => Promise.reject(new Error('quota')),
      onError,
      delayMs: 10,
    });
    await auto.flush();
    expect(onError).toHaveBeenCalledOnce();
  });
});
