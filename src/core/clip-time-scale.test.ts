import { describe, it, expect } from 'vitest';
import { scaleClipTempo, resampleEnvelope } from './clip-time-scale';
import type { SessionClip } from '../session/session';

const clip = (over: Partial<SessionClip> = {}): SessionClip => ({
  id: 'c', lengthBars: 2, notes: [], ...over,
});

describe('resampleEnvelope', () => {
  it('stretches by repeating samples (nearest-neighbor by phase)', () => {
    expect(resampleEnvelope([0, 1], 4)).toEqual([0, 0, 1, 1]);
  });
  it('compresses by decimating samples', () => {
    expect(resampleEnvelope([0, 0, 1, 1], 2)).toEqual([0, 1]);
  });
  it('returns empty for an empty input regardless of target length', () => {
    expect(resampleEnvelope([], 4)).toEqual([]);
  });
});

describe('scaleClipTempo', () => {
  it('*2 (tempoMult 2) halves note start/duration', () => {
    const c = clip({ notes: [{ start: 48, duration: 24, midi: 60, velocity: 80 }] });
    scaleClipTempo(c, 2);
    expect(c.notes[0]).toMatchObject({ start: 24, duration: 12 });
  });

  it('/2 (tempoMult 0.5) doubles note start/duration', () => {
    const c = clip({ notes: [{ start: 24, duration: 24, midi: 60, velocity: 80 }] });
    scaleClipTempo(c, 0.5);
    expect(c.notes[0]).toMatchObject({ start: 48, duration: 48 });
  });

  it('keeps duration at least 1 tick', () => {
    const c = clip({ notes: [{ start: 0, duration: 1, midi: 60, velocity: 80 }] });
    scaleClipTempo(c, 2);
    expect(c.notes[0].duration).toBe(1);
  });

  it('scales the loop region when present and leaves it absent otherwise', () => {
    const c = clip({ loopEnabled: true, loopStartTick: 48, loopEndTick: 96 });
    scaleClipTempo(c, 2);
    expect(c.loopStartTick).toBe(24);
    expect(c.loopEndTick).toBe(48);
    expect(c.loopEnabled).toBe(true);

    const c2 = clip();
    scaleClipTempo(c2, 0.5);
    expect(c2.loopStartTick).toBeUndefined();
    expect(c2.loopEndTick).toBeUndefined();
  });

  it('/2 doubles lengthBars; *2 halves it', () => {
    const a = clip({ lengthBars: 2 });
    scaleClipTempo(a, 0.5);
    expect(a.lengthBars).toBe(4);

    const b = clip({ lengthBars: 2 });
    scaleClipTempo(b, 2);
    expect(b.lengthBars).toBe(1);
  });

  it('1-bar *2 keeps length at 1 but still compresses the notes', () => {
    const c = clip({ lengthBars: 1, notes: [{ start: 24, duration: 24, midi: 60, velocity: 80 }] });
    scaleClipTempo(c, 2);
    expect(c.lengthBars).toBe(1);
    expect(c.notes[0]).toMatchObject({ start: 12, duration: 12 });
  });

  it('never overflows the new length for odd bar counts (no-clip invariant)', () => {
    // 3-bar clip (4/4 → 384 ticks/bar = 1152), note ending exactly at clip end.
    const c = clip({ lengthBars: 3, notes: [{ start: 1128, duration: 24, midi: 60, velocity: 80 }] });
    scaleClipTempo(c, 2);
    expect(c.lengthBars).toBe(2); // round(1.5) = 2
    const end = c.notes[0].start + c.notes[0].duration;
    expect(end).toBeLessThanOrEqual(2 * 384); // within new length ticks
  });

  it('resamples envelopes to the new expected length', () => {
    // 1-bar clip: expected values length = 1 * 16 * 16 = 256.
    const values = Array.from({ length: 256 }, (_, i) => i / 255);
    const c = clip({ lengthBars: 1, envelopes: [{ paramId: 'sub.filter.cutoff', values, enabled: true }] });
    scaleClipTempo(c, 0.5); // /2 → length doubles to 2 bars
    expect(c.lengthBars).toBe(2);
    expect(c.envelopes![0].values.length).toBe(2 * 16 * 16); // 512
    scaleClipTempo(c, 2); // *2 → back to 1 bar
    expect(c.envelopes![0].values.length).toBe(256);
  });

  it('round-trips grid-aligned notes through *2 then /2', () => {
    const c = clip({ lengthBars: 2, notes: [{ start: 48, duration: 24, midi: 60, velocity: 80 }] });
    scaleClipTempo(c, 2);   // → start 24, dur 12, lengthBars 1
    scaleClipTempo(c, 0.5); // → start 48, dur 24, lengthBars 2
    expect(c.lengthBars).toBe(2);
    expect(c.notes[0]).toMatchObject({ start: 48, duration: 24 });
  });
});
