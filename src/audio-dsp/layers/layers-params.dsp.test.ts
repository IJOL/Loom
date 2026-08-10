// Does a LAYER hear its OWN preset?
//
// Reported from the app: "cambio los presets y el sonido siempre es el mismo".
// The write was measured landing on the engine (layers-rack-preset.test.ts), so
// the question left is whether a value written as `l0.x` reaches the renderer in
// slot 0 as `x` — and whether slot 1 is left alone.
//
// A renderer that RETURNS one of its params, so "did this layer get its own
// value" is an assertion about samples rather than an argument about plumbing.
// Its sibling file proves which layer a note reaches; this one proves what that
// layer was told.

import { describe, it, expect, beforeAll } from 'vitest';
import { LayersRenderer } from './layers-renderer';
import { readRack, type LayerSpec } from './layer-spec';
import { registerRenderer } from '../renderer-registry';
import type { NoteSpec, ParamBag, ParamIndex } from '@loom/plugin-sdk';

/** Renders its own `tone` param, flat, for ever. The default is deliberately a
 *  value neither slot asks for, so "everybody got the default" cannot be
 *  mistaken for "everybody got their own". */
const DEFAULT_TONE = -1;

beforeAll(() => {
  registerRenderer('test-tone', (_note, params: ParamBag) => {
    const fixed = typeof params.tone === 'number' ? params.tone : DEFAULT_TONE;
    let live: Float64Array | undefined;
    let slot = -1;
    return {
      renderSample: () => (live && slot >= 0 ? live[slot] : fixed),
      noteOff: () => {},
      done: false,
      setLiveValues: (values: Float64Array, index: ParamIndex) => {
        live = values;
        slot = index.slot.tone ?? -1;
      },
    };
  });
});

const note = (layerIndex?: number): NoteSpec => ({
  midi: 60, beginSec: 0, durationSec: 1, velocity: 1, accent: false, slide: false, layerIndex,
});

/** Two full-range slots of the SAME engine — the arrangement "convert to
 *  layered" produces, and the one the sound fader balances. */
const rack = (g0 = 1, g1 = 1) => readRack([
  { engineId: 'test-tone', lo: 0, hi: 127, gain: g0 },
  { engineId: 'test-tone', lo: 0, hi: 127, gain: g1 },
]);

/** The lane's bag: each slot's params wearing its own prefix. */
const BAG: ParamBag = { 'l0.tone': 0.25, 'l1.tone': 0.75 };

const renderAt = (layerIndex: number | undefined, bag: ParamBag = BAG, g0 = 1, g1 = 1) =>
  new LayersRenderer(note(layerIndex), bag, 48000, rack(g0, g1), layerIndex).renderSample(0);

describe('each layer hears its own params', () => {
  it('gives slot 0 the value written as l0.', () => {
    // The reported failure, stated as a number: if this comes back DEFAULT_TONE
    // the preset never reached the instrument and every layer plays factory.
    expect(renderAt(0)).toBeCloseTo(0.25, 6);
  });

  it('gives slot 1 the value written as l1.', () => {
    expect(renderAt(1)).toBeCloseTo(0.75, 6);
  });

  it('makes two slots of the SAME engine sound different', () => {
    // Two layers of one engine share every param NAME. If the prefix did not
    // separate them, converting a lane would give you the same instrument twice
    // and no preset could ever change that.
    expect(renderAt(0)).not.toBeCloseTo(renderAt(1), 3);
  });

  it('leaves a slot on its DEFAULT when the bag says nothing about it', () => {
    // Absent is not zero: a slot nobody has recalled a preset into plays what
    // its engine ships with.
    expect(renderAt(0, { 'l1.tone': 0.75 })).toBeCloseTo(DEFAULT_TONE, 6);
  });
});

describe('with no index, a note reaches BOTH layers — and the gains balance it', () => {
  // This is the SOUND fader's whole mechanism: no layerIndex means the zones
  // decide, two full-range zones mean every note sounds on both instruments,
  // and the two gains say how much of each you hear.

  it('sums both instruments when neither is turned down', () => {
    expect(renderAt(undefined)).toBeCloseTo(0.25 + 0.75, 6);
  });

  it('is exactly the first instrument at one end of the fader', () => {
    expect(renderAt(undefined, BAG, 1, 0)).toBeCloseTo(0.25, 6);
  });

  it('is exactly the second at the other end', () => {
    expect(renderAt(undefined, BAG, 0, 1)).toBeCloseTo(0.75, 6);
  });

  it('is a real blend in between, and not either one alone', () => {
    const mid = renderAt(undefined, BAG, 0.707, 0.707);
    expect(mid).toBeGreaterThan(0.25 * 0.707);
    expect(mid).toBeLessThan(0.25 + 0.75);
  });
});

describe('a live gain reaches a note already sounding', () => {
  it('follows the lane s values array rather than the rack it was built with', () => {
    // A fader that only moved the NEXT note is what a crossfade cannot be made
    // of: the whole gesture happens under a held chord.
    const r = new LayersRenderer(note(undefined), BAG, 48000, rack(1, 1), undefined);
    const values = new Float64Array([1, 0]);
    const index: ParamIndex = { slot: { 'l0.gain': 0, 'l1.gain': 1 }, length: 2 };
    r.setLiveValues(values, index);
    expect(r.renderSample(0)).toBeCloseTo(0.25, 6);

    // The array is shared, not copied — moving the fader moves this note.
    values[0] = 0;
    values[1] = 1;
    expect(r.renderSample(0)).toBeCloseTo(0.75, 6);
  });

  it('still hands each layer its OWN param slots alongside the gains', () => {
    // subIndex translates the lane's index per slot; getting that wrong is the
    // same failure as subBag, only for values that move.
    const r = new LayersRenderer(note(0), {}, 48000, rack(1, 1), 0);
    const values = new Float64Array([0.4, 1]);
    const index: ParamIndex = { slot: { 'l0.tone': 0, 'l0.gain': 1 }, length: 2 };
    r.setLiveValues(values, index);
    expect(r.renderSample(0)).toBeCloseTo(0.4, 6);
  });
});

describe('a slot plays at its OWN engine s balance', () => {
  // A lane carries ONE output trim and LAYERS declares 1, so every engine
  // inside a slot played raw: subtractive asks for 0.25 and a converted lane
  // came out four times as loud as the same patch on a lane of its own.
  // Measured at the master before it was measured here.

  it('scales a layer by the trim its engine asked for', () => {
    const quiet = readRack([{ engineId: 'test-tone', lo: 0, hi: 127, gain: 1, trim: 0.25 }]);
    const raw = readRack([{ engineId: 'test-tone', lo: 0, hi: 127, gain: 1 }]);
    const at = (r: LayerSpec[]) => new LayersRenderer(note(0), BAG, 48000, r, 0).renderSample(0);
    expect(at(quiet)).toBeCloseTo(at(raw) * 0.25, 6);
  });

  it('treats an absent trim as 1, so an older rack still sounds', () => {
    const rack0 = readRack([{ engineId: 'test-tone', lo: 0, hi: 127, gain: 1 }]);
    expect(new LayersRenderer(note(0), BAG, 48000, rack0, 0).renderSample(0))
      .toBeCloseTo(0.25, 6);
  });

  it('applies each slot s own, not one for the rack', () => {
    // Two engines with different balances in one rack is the ordinary case the
    // single lane-level trim could never express.
    const mixed = readRack([
      { engineId: 'test-tone', lo: 0, hi: 127, gain: 1, trim: 1 },
      { engineId: 'test-tone', lo: 0, hi: 127, gain: 1, trim: 0.5 },
    ]);
    const both = new LayersRenderer(note(undefined), BAG, 48000, mixed, undefined).renderSample(0);
    expect(both).toBeCloseTo(0.25 * 1 + 0.75 * 0.5, 6);
  });
});
