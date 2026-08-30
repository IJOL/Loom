// src/performance/loop-capture.test.ts
import { describe, it, expect } from 'vitest';
import {
  nextBarBoundarySec, lastBarBoundarySec,
  LoopCaptureController, type CaptureSession, type CaptureTake, type LoopCaptureDeps,
} from './loop-capture';

describe('bar-boundary arithmetic', () => {
  // anchor 10, barSec 2 → boundaries at 10, 12, 14, …
  it('nextBarBoundarySec rounds up to the next boundary', () => {
    expect(nextBarBoundarySec(10.5, 10, 2)).toBe(12);
    expect(nextBarBoundarySec(13.999, 10, 2)).toBe(14);
  });

  it('nextBarBoundarySec on an exact boundary returns it (press ON the bar starts now)', () => {
    expect(nextBarBoundarySec(12, 10, 2)).toBe(12);
  });

  it('nextBarBoundarySec never returns a boundary before the anchor', () => {
    expect(nextBarBoundarySec(9.2, 10, 2)).toBe(10);
  });

  it('lastBarBoundarySec rounds down to the last boundary at or before now', () => {
    expect(lastBarBoundarySec(13.999, 10, 2)).toBe(12);
    expect(lastBarBoundarySec(14, 10, 2)).toBe(14);
  });

  it('boundaries are consistent: last <= now <= next, both on the anchor grid', () => {
    const now = 17.31, anchor = 10, bar = 2;
    const lo = lastBarBoundarySec(now, anchor, bar), hi = nextBarBoundarySec(now, anchor, bar);
    expect(lo).toBeLessThanOrEqual(now);
    expect(hi).toBeGreaterThanOrEqual(now);
    expect((hi - lo) / bar).toBeLessThanOrEqual(1);
  });
});

function makeRig(opts: { playing?: boolean } = {}) {
  let now = 10;                        // anchor 10, barSec 2 → bars at 10,12,14…
  let anchor = 10;
  let playing = opts.playing ?? true;
  const windows: [number, number][] = [];
  const states: string[] = [];
  const delivered: { startSongSec: number }[] = [];
  let doneCb: ((t: CaptureTake) => void) | null = null;
  let cancelled = 0;
  const session: CaptureSession = {
    setWindow: (s, e) => windows.push([s, e]),
    cancel: () => { cancelled++; },
  };
  const deps: LoopCaptureDeps = {
    now: () => now,
    barSec: () => 2,
    anchorCtx: () => anchor,
    isPlaying: () => playing,
    startTransport: () => { playing = true; },
    openSession: async (onDone) => { doneCb = onDone; return session; },
    deliver: (_t, startSongSec) => delivered.push({ startSongSec }),
    onState: (s) => states.push(s),
    onError: () => {},
  };
  const ctl = new LoopCaptureController(deps);
  return {
    ctl, windows, states, delivered,
    setNow: (t: number) => { now = t; },
    setAnchor: (a: number) => { anchor = a; },
    fireDone: () => doneCb?.({ left: new Float32Array(4), right: new Float32Array(4), sampleRate: 48000 }),
    cancelCount: () => cancelled,
  };
}

describe('LoopCaptureController', () => {
  it('toggle from idle opens a session, posts an open-ended window at the next bar, and waits', async () => {
    const r = makeRig();
    r.setNow(10.5);
    await r.ctl.toggle();
    expect(r.states).toEqual(['waiting']);
    expect(r.windows).toEqual([[12, Infinity]]);
  });

  it('pump flips waiting→recording once the bar boundary passes', async () => {
    const r = makeRig();
    r.setNow(10.5);
    await r.ctl.toggle();
    r.ctl.pump();                       // still 10.5 — nothing
    expect(r.ctl.getState()).toBe('waiting');
    r.setNow(12.01);
    r.ctl.pump();
    expect(r.ctl.getState()).toBe('recording');
  });

  it('toggle while recording posts the bar-end cut and finalizes; done delivers at the start bar', async () => {
    const r = makeRig();
    r.setNow(10.5);
    await r.ctl.toggle();               // starts at ctx 12 (song sec 2)
    r.setNow(15.3); r.ctl.pump();       // recording, mid bar 14→16
    await r.ctl.toggle();               // cut at 16
    expect(r.windows[1]).toEqual([12, 16]);
    expect(r.ctl.getState()).toBe('finalizing');
    r.fireDone();
    expect(r.delivered).toEqual([{ startSongSec: 2 }]);
    expect(r.ctl.getState()).toBe('idle');
  });

  it('toggle while waiting cancels (no take, session torn down)', async () => {
    const r = makeRig();
    r.setNow(10.5);
    await r.ctl.toggle();
    await r.ctl.toggle();
    expect(r.ctl.getState()).toBe('idle');
    expect(r.cancelCount()).toBe(1);
    expect(r.delivered.length).toBe(0);
  });

  it('cancel (Escape) aborts a recording without delivering', async () => {
    const r = makeRig();
    r.setNow(10.5);
    await r.ctl.toggle();
    r.setNow(13); r.ctl.pump();
    r.ctl.cancel();
    expect(r.ctl.getState()).toBe('idle');
    expect(r.cancelCount()).toBe(1);
    r.fireDone();                       // a late done must be ignored
    expect(r.delivered.length).toBe(0);
  });

  it('transport stop finalizes at the last COMPLETED bar', async () => {
    const r = makeRig();
    r.setNow(10.5);
    await r.ctl.toggle();               // start ctx 12
    r.setNow(15.7); r.ctl.pump();       // one full bar (12–14) + part of the next
    r.ctl.onTransportStop();
    expect(r.windows[1]).toEqual([12, 14]);
    expect(r.ctl.getState()).toBe('finalizing');
  });

  it('transport stop with zero completed bars cancels', async () => {
    const r = makeRig();
    r.setNow(10.5);
    await r.ctl.toggle();               // start ctx 12
    r.setNow(13.2); r.ctl.pump();       // inside the first bar
    r.ctl.onTransportStop();
    expect(r.ctl.getState()).toBe('idle');
    expect(r.cancelCount()).toBe(1);
  });

  it('starts the transport first when it is stopped', async () => {
    const r = makeRig({ playing: false });
    r.setNow(10);                       // anchor equals now once started
    await r.ctl.toggle();
    expect(r.ctl.getState()).toBe('waiting');
    expect(r.windows[0][0]).toBe(10);   // bar 1 — the anchor itself
  });

  it('the cut stays on the START grid even when the live anchor drifts (A-B loop wrap)', async () => {
    const r = makeRig();
    r.setNow(10.5);
    await r.ctl.toggle();               // start ctx 12, grid frozen at anchor 10
    r.setNow(15.3); r.ctl.pump();
    // an A-B wrap re-anchors the live play state with scheduling jitter
    r.setAnchor(14.028);
    await r.ctl.toggle();
    expect(r.windows[1]).toEqual([12, 16]); // NOT 16.028 — whole bars, always
  });

  it('leaving the view cancels waiting but not recording', async () => {
    const r = makeRig();
    r.setNow(10.5);
    await r.ctl.toggle();
    r.ctl.onViewLeft();
    expect(r.ctl.getState()).toBe('idle');
    // and a recording one survives:
    r.setNow(10.5);
    await r.ctl.toggle();
    r.setNow(12.5); r.ctl.pump();
    r.ctl.onViewLeft();
    expect(r.ctl.getState()).toBe('recording');
  });
});
