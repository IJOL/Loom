import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBrokenCut, breakPad, cutoffNorm, CYCLE_TICKS, LENGTH_BARS, BPM } from './broken-cut-map.mjs';
import { velocityForGain, FULL_VELOCITY } from './strudel-map-common.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const haps = JSON.parse(readFileSync(join(HERE, 'data', 'broken-cut-haps.json'), 'utf8'));
const laneById = (d, id) => d.lanes.find((l) => l.id === id);

describe('broken cut mapper', () => {
  it('treats a cycle as a beat, which is what the one-kick-per-cycle pulse says', () => {
    expect(CYCLE_TICKS).toBe(96);
    expect(LENGTH_BARS).toBe(16);
    expect(BPM).toBe(75);
  });

  it('keeps every event', () => {
    const d = buildBrokenCut(haps);
    const total = d.lanes.reduce((s, l) => s + l.clips[0].notes.length, 0);
    expect(total).toBe(haps.events.length);
    expect(laneById(d, 'saw-1').clips[0].notes).toHaveLength(236);
    expect(laneById(d, 'drums-1').clips[0].notes).toHaveLength(342); // 94 bd + 245 break + 3 one-shots
  });

  it('puts every note on an integer tick inside the clip', () => {
    const d = buildBrokenCut(haps);
    const end = LENGTH_BARS * 384;
    for (const l of d.lanes) {
      for (const n of l.clips[0].notes) {
        expect(Number.isInteger(n.start)).toBe(true);
        expect(n.start).toBeGreaterThanOrEqual(0);
        expect(n.start).toBeLessThan(end);
        expect(n.duration).toBeGreaterThan(0);
      }
    }
  });

  it('spreads the break over its eight rendered slices', () => {
    const d = buildBrokenCut(haps);
    const pads = laneById(d, 'drums-1').clips[0].notes.map((n) => n.midi);
    const breakPads = [...new Set(pads.filter((p) => p >= 60))].sort((a, b) => a - b);
    expect(breakPads).toEqual([60, 61, 62, 63, 64, 65, 66, 67]);
    // The four chops of the base speed, in order.
    expect(breakPad({ begin: 0, speed: 0.5 })).toBe(60);
    expect(breakPad({ begin: 0.75, speed: 0.5 })).toBe(63);
    // The 5% variant lives on the second four.
    expect(breakPad({ begin: 0, speed: 0.525 })).toBe(64);
    expect(breakPad({ begin: 0.75, speed: 0.525 })).toBe(67);
  });

  it('gives the break and the one-shots their monophonic cut groups', () => {
    const d = buildBrokenCut(haps);
    const pads = laneById(d, 'drums-1').engineState.sampler.padParams;
    for (let n = 60; n < 68; n++) {
      expect(pads[n].chokeGroup).toBe(1);   // cut(1)
      expect(pads[n].level).toBe(1.5);      // .gain(1.5), too loud for velocity
    }
    expect(pads[37].chokeGroup).toBe(2);    // whirl  — cut(2)
    expect(pads[38].chokeGroup).toBe(2);    // attack — cut(2)
    expect(pads[36].chokeGroup).toBe(0);    // the kick chokes nothing
  });

  it('follows the perlin cutoff through the filter envelope, in knob units', () => {
    const d = buildBrokenCut(haps);
    const envs = laneById(d, 'saw-1').clips[0].envelopes;
    const cut = envs.find((e) => e.paramId === 'saw-1.filter.cutoff');
    const amt = envs.find((e) => e.paramId === 'saw-1.filter.envAmount');
    for (const e of [cut, amt]) {
      expect(e.values).toHaveLength(LENGTH_BARS * 16 * 16);
      expect(Math.min(...e.values)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...e.values)).toBeLessThanOrEqual(1);
    }
    // The patch sweeps 480..1178.7 Hz; 60*220^x inverted gives these.
    expect(Math.min(...cut.values)).toBeCloseTo(cutoffNorm(480), 3);
    expect(Math.max(...cut.values)).toBeCloseTo(cutoffNorm(1178.7), 2);
    // The curve has to actually move.
    const span = Math.max(...cut.values) - Math.min(...cut.values);
    expect(span).toBeGreaterThan(0.05);
    // It is NOT smooth everywhere, and that is the patch, not the mapping:
    // `reset` restarts the pattern — and with it where perlin is sampled — so
    // the source itself steps 610 Hz -> 1084 Hz across a sixteenth at cycle 34.
    // What must hold is that the curve tracks its source, so spot-check that
    // the value at a quiet cycle matches the events there.
    const at = (cycle) => cut.values[Math.round((cycle / 64) * cut.values.length)];
    const sourceAt = (cycle) => {
      const near = haps.events.filter((e) => e.value.s === 'sawtooth' && Math.abs(e.begin - cycle) < 1e-9);
      return near.reduce((s, e) => s + e.value.cutoff, 0) / near.length;
    };
    expect(at(20)).toBeCloseTo(cutoffNorm(sourceAt(20)), 2);
    expect(at(44)).toBeCloseTo(cutoffNorm(sourceAt(44)), 2);
  });

  it('never writes a velocity that would trip the accent', () => {
    const d = buildBrokenCut(haps);
    for (const l of d.lanes) for (const n of l.clips[0].notes) expect(n.velocity).toBeLessThan(100);
    expect(FULL_VELOCITY).toBe(99);
    expect(velocityForGain(0.5)).toBeLessThan(FULL_VELOCITY);
  });
});
