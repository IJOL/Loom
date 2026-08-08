// Does a note actually reach the layer its loop names?
//
// Reported from the browser: "el sonido no cambia, cambia solo el loop" — the
// crossfade swapped which pattern played while both ends came out of the same
// instrument. Every isolated piece of that chain had a test and the chain as a
// whole did not, which is the same shape of hole as the predicate-vs-source bug.
//
// Measured, not inspected: two layers whose renderers are trivially
// distinguishable by their output, and an assertion about the SAMPLES.

import { describe, it, expect, beforeAll } from 'vitest';
import { LayersRenderer } from './layers-renderer';
import { readRack } from './layer-spec';
import { registerRenderer } from '../renderer-registry';
import type { NoteSpec } from '@loom/plugin-sdk';

// Two "engines" that are constant sources. Real DSP would work too and would
// tell us less: a constant makes "which one rendered this sample" a fact rather
// than a spectral argument.
const A_LEVEL = 0.25;
const B_LEVEL = 0.75;

beforeAll(() => {
  registerRenderer('test-a', () => ({ renderSample: () => A_LEVEL, noteOff: () => {}, done: false }));
  registerRenderer('test-b', () => ({ renderSample: () => B_LEVEL, noteOff: () => {}, done: false }));
});

const note = (midi: number, layerIndex?: number): NoteSpec => ({
  midi, beginSec: 0, durationSec: 1, velocity: 1, accent: false, slide: false, layerIndex,
});

/** Both layers span the WHOLE keyboard, which is what the rack's own default
 *  gives you: `emptyLayer()` is 0..127. That is the configuration the report
 *  came from, and the one where a broken index is invisible — the zones let
 *  every note through to both. */
const rack = readRack([
  { engineId: 'test-a', lo: 0, hi: 127, gain: 1 },
  { engineId: 'test-b', lo: 0, hi: 127, gain: 1 },
]);

const render = (n: NoteSpec) => new LayersRenderer(n, {}, 48000, rack, n.layerIndex).renderSample(0);

describe('LAYERS — a note goes to the layer its loop names', () => {
  it('sends layerIndex 0 to the FIRST layer and nothing else', () => {
    expect(render(note(60, 0))).toBeCloseTo(A_LEVEL, 6);
  });

  it('sends layerIndex 1 to the SECOND layer and nothing else', () => {
    expect(render(note(60, 1))).toBeCloseTo(B_LEVEL, 6);
  });

  it('makes the two ends of a crossfade sound DIFFERENT', () => {
    // The whole point, and the thing the browser said was missing. If this ever
    // passes by accident — both ends equal — the weave is swapping patterns and
    // playing them on one instrument.
    expect(render(note(60, 0))).not.toBeCloseTo(render(note(60, 1)), 3);
  });

  it('falls back to the ZONES when no index rides the note', () => {
    // Which, with the default full-keyboard zones, means BOTH layers — and that
    // is exactly what "the sound does not change" sounds like. Pinned here so
    // the fallback stays a deliberate rule rather than the accident it looks
    // like from the outside.
    expect(render(note(60))).toBeCloseTo(A_LEVEL + B_LEVEL, 6);
  });

  it('sums without dividing by the number of live layers', () => {
    // Two layers at gain 1 are twice as loud, on purpose: a hidden divide-by-N
    // would make a fader that visibly reads 1.0 quietly mean 0.5.
    expect(render(note(60))).toBeGreaterThan(Math.max(A_LEVEL, B_LEVEL));
  });

  it('plays NOTHING for an index past the end of the rack', () => {
    // Silence is a bug you find; a note that quietly plays on the wrong
    // instrument is one you ship.
    expect(render(note(60, 3))).toBe(0);
  });
});
