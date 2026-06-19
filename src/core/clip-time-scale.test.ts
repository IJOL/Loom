import { describe, it, expect } from 'vitest';
import { scaleClipTempo, resampleEnvelope, tileEnvelope } from './clip-time-scale';
import type { SessionClip } from '../session/session';

const BAR = 384; // 4/4 ticks per bar (16 steps * 24)
const clip = (over: Partial<SessionClip> = {}): SessionClip => ({
  id: 'c', lengthBars: 1, notes: [], ...over,
});

describe('resampleEnvelope', () => {
  it('stretches by repeating samples (nearest-neighbor by phase)', () => {
    expect(resampleEnvelope([0, 1], 4)).toEqual([0, 0, 1, 1]);
  });
  it('returns empty for an empty input', () => {
    expect(resampleEnvelope([], 4)).toEqual([]);
  });
});

describe('tileEnvelope', () => {
  it('cycles the curve `copies` times across the same length', () => {
    expect(tileEnvelope([0, 1, 2, 3], 2, 4)).toEqual([0, 2, 0, 2]);
  });
  it('returns empty for an empty input', () => {
    expect(tileEnvelope([], 2, 4)).toEqual([]);
  });
});

describe('scaleClipTempo — *2 (faster): compress + tile, length fixed', () => {
  it('compresses each note x0.5 and duplicates the pattern to fill the clip', () => {
    const c = clip({ lengthBars: 1, notes: [
      { start: 0,   duration: 96, midi: 60, velocity: 80 },
      { start: 192, duration: 96, midi: 62, velocity: 80 },
    ] });
    scaleClipTempo(c, 2, BAR);
    expect(c.lengthBars).toBe(1);                 // length NEVER changes on *2
    expect(c.notes.length).toBe(4);               // 2 notes → 2 copies = 4
    expect(c.notes.map((n) => n.start)).toEqual([0, 96, 192, 288]);
    expect(c.notes.map((n) => n.duration)).toEqual([48, 48, 48, 48]);
    expect(c.notes.map((n) => n.midi)).toEqual([60, 62, 60, 62]);
  });

  it('keeps the second copy inside the clip (no overflow)', () => {
    const c = clip({ lengthBars: 1, notes: [{ start: 360, duration: 24, midi: 60, velocity: 80 }] });
    scaleClipTempo(c, 2, BAR);
    const end = Math.max(...c.notes.map((n) => n.start + n.duration));
    expect(end).toBeLessThanOrEqual(BAR);
  });

  it('leaves the loop region untouched on *2 (length unchanged)', () => {
    const c = clip({ lengthBars: 1, loopEnabled: true, loopStartTick: 0, loopEndTick: BAR, notes: [] });
    scaleClipTempo(c, 2, BAR);
    expect(c.loopStartTick).toBe(0);
    expect(c.loopEndTick).toBe(BAR);
  });

  it('tiles automation to match: length unchanged (256), curve cycles twice', () => {
    // 1-bar curve = 256 samples; a rising ramp over the bar.
    const values = Array.from({ length: 256 }, (_, i) => i / 255);
    const c = clip({ lengthBars: 1, envelopes: [{ paramId: 'sub.filter.cutoff', values, enabled: true }] });
    scaleClipTempo(c, 2, BAR);
    const out = c.envelopes![0].values;
    expect(out.length).toBe(256);          // length unchanged on *2
    // The ramp now repeats twice: the second half restarts low like the first.
    expect(out[128]).toBeLessThan(out[127]); // wrap point: high → low again
    expect(out[0]).toBeCloseTo(out[128], 5); // both halves start at the same value
  });
});

describe('scaleClipTempo — /2 (slower): stretch + grow length', () => {
  it('stretches each note x2 and doubles lengthBars', () => {
    const c = clip({ lengthBars: 1, notes: [
      { start: 0,   duration: 96, midi: 60, velocity: 80 },
      { start: 192, duration: 96, midi: 62, velocity: 80 },
    ] });
    scaleClipTempo(c, 0.5, BAR);
    expect(c.lengthBars).toBe(2);                 // grows to preserve the pattern
    expect(c.notes.length).toBe(2);               // no tiling on /2
    expect(c.notes.map((n) => n.start)).toEqual([0, 384]);
    expect(c.notes.map((n) => n.duration)).toEqual([192, 192]);
  });

  it('scales the loop region x2 on /2', () => {
    const c = clip({ lengthBars: 1, loopEnabled: true, loopStartTick: 0, loopEndTick: 192, notes: [] });
    scaleClipTempo(c, 0.5, BAR);
    expect(c.loopStartTick).toBe(0);
    expect(c.loopEndTick).toBe(384);
  });

  it('stretches automation to the new (doubled) length', () => {
    const values = Array.from({ length: 256 }, (_, i) => i / 255); // 1-bar curve
    const c = clip({ lengthBars: 1, envelopes: [{ paramId: 'sub.filter.cutoff', values, enabled: true }] });
    scaleClipTempo(c, 0.5, BAR);
    expect(c.lengthBars).toBe(2);
    expect(c.envelopes![0].values.length).toBe(2 * 16 * 16); // 512
  });

  it('keeps note duration at least 1 tick', () => {
    const c = clip({ lengthBars: 1, notes: [{ start: 0, duration: 1, midi: 60, velocity: 80 }] });
    scaleClipTempo(c, 0.5, BAR);
    expect(c.notes[0].duration).toBeGreaterThanOrEqual(1);
  });
});
