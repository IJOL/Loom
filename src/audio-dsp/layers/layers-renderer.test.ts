import { describe, it, expect, beforeAll } from 'vitest';
import type { NoteSpec, ParamBag, VoiceRenderer } from '@loom/plugin-sdk';
import { registerRenderer } from '../renderer-registry';
import { LayersRenderer } from './layers-renderer';
import { emptyLayer, type LayerSpec } from './layer-spec';

/** A renderer that emits a constant, so a sum is readable by eye. Its level is
 *  its own `level` param, which is how the per-layer bag gets checked. */
function constRenderer(level: number) {
  return (_n: NoteSpec, p: ParamBag): VoiceRenderer => {
    let off = false;
    let liveSlot = -1;
    let values: Float64Array | undefined;
    return {
      renderSample: () => (off ? 0 : (values && liveSlot >= 0 ? values[liveSlot] : (p.level ?? level))),
      noteOff: () => { off = true; },
      setLiveValues(v, ix) { values = v; liveSlot = ix.slot.level ?? -1; },
      get done() { return off; },
    };
  };
}

const note = (midi: number): NoteSpec =>
  ({ midi, beginSec: 0, durationSec: 1, velocity: 1, accent: false, slide: false });
const layer = (o: Partial<LayerSpec>): LayerSpec => ({ ...emptyLayer(), engineId: 'one', ...o });

beforeAll(() => {
  registerRenderer('one', constRenderer(1));
  registerRenderer('two', constRenderer(2));
});

describe('LayersRenderer', () => {
  it('sums its layers, each scaled by its own gain', () => {
    const v = new LayersRenderer(note(64), {}, 48000, [
      layer({ engineId: 'one', gain: 1 }),
      layer({ engineId: 'two', gain: 0.5 }),
    ]);
    expect(v.renderSample(0)).toBeCloseTo(1 + 2 * 0.5);
  });

  it('does not normalise by the number of layers', () => {
    // Four at gain 1 are four times as loud. A hidden divide-by-N would make a
    // fader that reads 1.0 quietly mean 0.25.
    const four = Array.from({ length: 4 }, () => layer({ engineId: 'one', gain: 1 }));
    expect(new LayersRenderer(note(64), {}, 48000, four).renderSample(0)).toBeCloseTo(4);
  });

  it('a gain of zero contributes nothing', () => {
    const v = new LayersRenderer(note(64), {}, 48000, [
      layer({ engineId: 'one', gain: 0 }),
      layer({ engineId: 'two', gain: 1 }),
    ]);
    expect(v.renderSample(0)).toBeCloseTo(2);
  });

  it('honours the zones', () => {
    const v = new LayersRenderer(note(30), {}, 48000, [
      layer({ engineId: 'one', lo: 0, hi: 59 }),
      layer({ engineId: 'two', lo: 60, hi: 127 }),
    ]);
    expect(v.renderSample(0)).toBeCloseTo(1);
  });

  it('an index sends the note to one layer whatever its pitch', () => {
    const v = new LayersRenderer(note(30), {}, 48000, [
      layer({ engineId: 'one', lo: 0, hi: 59 }),
      layer({ engineId: 'two', lo: 60, hi: 127 }),
    ], 1);
    expect(v.renderSample(0)).toBeCloseTo(2);
  });

  it('gives each layer its OWN params', () => {
    const v = new LayersRenderer(note(64), { 'l0.level': 3, 'l1.level': 7 }, 48000, [
      layer({ engineId: 'one', gain: 1 }),
      layer({ engineId: 'one', gain: 1 }),
    ]);
    // Same engine twice, different settings — the thing one shared bag could
    // never do.
    expect(v.renderSample(0)).toBeCloseTo(10);
  });

  it('skips a layer whose engine is not installed instead of taking the lane down', () => {
    const v = new LayersRenderer(note(64), {}, 48000, [
      layer({ engineId: 'ghost' }),
      layer({ engineId: 'two' }),
    ]);
    expect(v.renderSample(0)).toBeCloseTo(2);
  });

  it('keeps every layer live for a knob turn mid-note', () => {
    const v = new LayersRenderer(note(64), {}, 48000, [
      layer({ engineId: 'one' }), layer({ engineId: 'two' }),
    ]);
    const values = new Float64Array(4);
    values[1] = 5;
    values[2] = 9;
    v.setLiveValues(values, { slot: { 'l0.level': 1, 'l1.level': 2 }, length: 4 });
    expect(v.renderSample(0)).toBeCloseTo(14);

    // The array is the LANE's, mutated in place — not a copy taken at spawn.
    values[1] = 0;
    expect(v.renderSample(0)).toBeCloseTo(9);
  });

  it('is done only when the longest layer is', () => {
    const v = new LayersRenderer(note(64), {}, 48000, [
      layer({ engineId: 'one' }), layer({ engineId: 'two' }),
    ]);
    expect(v.done).toBe(false);
    v.noteOff(0);
    expect(v.done).toBe(true);
  });

  it('a voice with no live layer is silent, not a crash', () => {
    const v = new LayersRenderer(note(64), {}, 48000, [emptyLayer()]);
    expect(v.renderSample(0)).toBe(0);
    // And it retires, rather than sitting in the pool for ever.
    expect(v.done).toBe(true);
  });
});

// A layer's GAIN is a declared continuous param (`l0.gain`), and it was the
// one value this renderer read from the rack it was built with rather than from
// the lane's live array — so it moved the next note and never the one sounding.
// Two homes for one number, and the audio used the frozen one.
//
// It matters beyond tidiness: a crossfade that fades two loops by AUDIO instead
// of by rewriting their notes IS this param moving under a held chord.
describe('a layer gain is live, like every other continuous param', () => {
  const index = (slot: Record<string, number>, length: number) => ({ slot, length });
  // The rack says 1 for both. The live array will say something else, so
  // reading one or the other gives different answers — the only way a test can
  // tell them apart.
  const two = () => new LayersRenderer(note(64), {}, 48000, [
    layer({ engineId: 'one', gain: 1 }),
    layer({ engineId: 'one', gain: 1 }),
  ]);
  const IX = index({ 'l0.gain': 0, 'l1.gain': 1 }, 2);

  it('reads the live array, not the rack it was built with', () => {
    const v = two();
    v.setLiveValues(new Float64Array([0.25, 0]), IX);
    // The rack would give 1 + 1 = 2.
    expect(v.renderSample(0)).toBeCloseTo(0.25);
  });

  it('follows it under a note that is already sounding', () => {
    const v = two();
    const values = new Float64Array([1, 0]);
    v.setLiveValues(values, IX);
    expect(v.renderSample(0)).toBeCloseTo(1);
    values[0] = 0;
    values[1] = 1;
    expect(v.renderSample(0.1)).toBeCloseTo(1);
    values[0] = 0.5;
    values[1] = 0.5;
    expect(v.renderSample(0.2)).toBeCloseTo(1);
  });

  it('falls back to the rack when the lane declares no such param', () => {
    // A lane whose engine is not LAYERS never numbers `l0.gain`, and a
    // renderer reading slot -1 out of the array would render silence.
    const v = new LayersRenderer(note(64), {}, 48000, [layer({ engineId: 'one', gain: 0.5 })]);
    v.setLiveValues(new Float64Array([7]), index({ nothing: 0 }, 1));
    expect(v.renderSample(0)).toBeCloseTo(0.5);
  });

  it('and before setLiveValues is called at all', () => {
    expect(two().renderSample(0)).toBeCloseTo(2);
  });
});
