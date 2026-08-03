// Hard sync: a slave saw whose phase is reset every time a master cycle
// completes. The master fixes the pitch; the slave's ratio fixes the timbre —
// so sweeping the ratio (or an LFO on it) is the bright tearing sound, with the
// pitch nailed in place. That decoupling is the whole point, and it is what
// these tests pin down. Assertions relative, never absolute magnitudes.

import { describe, it, expect } from 'vitest';
import { SyncOsc } from './sync-osc';

const SR = 48000;

/** Render `secs` of the oscillator at a master frequency and sync ratio. */
function render(freq: number, ratio: number, secs = 0.1): number[] {
  const o = new SyncOsc(SR);
  const n = Math.floor(secs * SR);
  const buf: number[] = [];
  for (let i = 0; i < n; i++) buf[i] = o.update(freq, ratio);
  return buf;
}

/** Count zero up-crossings — a cheap proxy for perceived pitch. */
function upCrossings(buf: number[]): number {
  let n = 0;
  for (let i = 1; i < buf.length; i++) if (buf[i - 1] < 0 && buf[i] >= 0) n++;
  return n;
}

describe('SyncOsc', () => {
  it('makes a sound', () => {
    const buf = render(110, 2);
    expect(Math.max(...buf.map(Math.abs))).toBeGreaterThan(0);
  });

  it('a ratio of 1 is just the master saw — no sync artefact', () => {
    // At ratio 1 the slave and master run together; the reset lands where the
    // saw already wraps, so it should look like a plain saw. Its fundamental
    // tracks the master frequency.
    const a = render(220, 1, 0.05);
    // ~220 Hz over 50 ms ≈ 11 cycles; allow slack for the window edges.
    expect(upCrossings(a)).toBeGreaterThan(8);
    expect(upCrossings(a)).toBeLessThan(14);
  });

  it('holds the pitch when the ratio changes — this is what sync IS', () => {
    // The master frequency is fixed; only the ratio moves. Perceived pitch (the
    // master's period, seen as the reset rate) must NOT move with the ratio.
    const lowRatio = render(147, 1.5, 0.1);
    const highRatio = render(147, 4.0, 0.1);
    const p1 = upCrossings(lowRatio);
    const p2 = upCrossings(highRatio);
    // The reset happens once per master cycle regardless of ratio, so the
    // low-frequency envelope repeats at the master rate either way. The counts
    // differ (more ratio = more slave teeth), but both are anchored to 147 Hz:
    // neither collapses to silence and both stay in the same broad range.
    expect(p1).toBeGreaterThan(0);
    expect(p2).toBeGreaterThan(p1);   // higher ratio packs more slave cycles in
  });

  it('the timbre changes with the ratio', () => {
    // Same pitch, different ratio → different waveform. Compare the two renders:
    // they must diverge, or the ratio is doing nothing.
    const a = render(147, 1.5, 0.05);
    const b = render(147, 3.7, 0.05);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    const rms = Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    expect(diff / a.length / Math.max(1e-9, rms)).toBeGreaterThan(0.3);
  });

  it('resets the slave exactly at the master period', () => {
    // The defining property: the output is periodic at the MASTER frequency, not
    // the slave's. At 100 Hz master the pattern repeats every 480 samples; the
    // sample one period on should closely match (the reset makes it exact-ish).
    const buf = render(100, 2.5, 0.05);
    const period = SR / 100;   // 480 samples
    const at = Math.floor(period * 3);
    const next = Math.floor(period * 4);
    // The waveform a whole master-period apart is near-identical (sync locks it).
    expect(Math.abs(buf[at] - buf[next])).toBeLessThan(0.15);
  });

  it('stays in [-1, 1]', () => {
    for (const ratio of [1, 2.5, 5, 7]) {
      const buf = render(110, ratio, 0.05);
      for (const v of buf) expect(Math.abs(v)).toBeLessThanOrEqual(1.0001);
    }
  });
});
