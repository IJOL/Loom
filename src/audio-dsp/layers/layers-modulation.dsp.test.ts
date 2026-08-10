// Does a LAYER hear its own ENVELOPE?
//
// The sibling file proved a slot hears its own params. This one is about what
// params could never carry: `amp` and `filter.env` are not knobs, they are the
// per-voice envelopes an engine finds by name — and a lane numbers one of each.
// So a subtractive lane converted to layered arrived with no amplitude envelope
// (flat gain) and no filter envelope (a shut filter), which measured at the
// master as RMS 0.044 → 0.022 and sounded like a different instrument.
//
// Samples, not plumbing: the test renderer OUTPUTS the envelope reaching its own
// `amp`, so "did this slot get its own envelope" is a number you can compare.

import { describe, it, expect, beforeAll } from 'vitest';
import { LayersRenderer } from './layers-renderer';
import { readRack, layerModTargets } from './layer-spec';
import { buildParamIndex } from '../param-index';
import { registerRenderer } from '../renderer-registry';
import { ModEnvHost, slotOf } from '@loom/plugin-sdk';
import type { ModEnvSpec, NoteSpec, ParamIndex, VoiceModOffsets } from '@loom/plugin-sdk';

/** What a slot with no envelope plays: unity, exactly as subtractive's own
 *  `ae = 1` fallback does. It is deliberately DIFFERENT from every sustain the
 *  tests ask for, so "no envelope arrived" can never read as "the right one
 *  did". */
const NO_ENVELOPE = 1;

beforeAll(() => {
  // An instrument whose entire output is the amplitude envelope aimed at it.
  registerRenderer('test-env', (note: NoteSpec) => {
    const env = new ModEnvHost();
    let ampSlot = -1;
    const gateEnd = note.beginSec + note.durationSec;
    return {
      renderSample: (t: number, mo?: VoiceModOffsets) => {
        if (ampSlot < 0) return NO_ENVELOPE;
        const e = env.combine(t, t <= gateEnd ? 1 : 0, mo);
        return e[ampSlot];
      },
      noteOff: () => {},
      done: false,
      setModEnvelopes: (mods: ModEnvSpec[], index: ParamIndex) => {
        env.setModEnvelopes(mods, index);
        // Under the slot's OWN name. If the translation were missing this stays
        // -1 and the layer plays flat — the exact failure being fixed.
        ampSlot = slotOf(index, 'amp');
      },
      getAdsrOffsets: () => env.getAdsrOffsets(),
    };
  });
});

const note = (): NoteSpec => ({
  midi: 60, beginSec: 0, durationSec: 4, velocity: 1, accent: false, slide: false,
});

/** The lane's numbering: the two gains it declares, plus every slot's
 *  envelopes. */
const LANE_INDEX = () => buildParamIndex(['l0.gain', 'l1.gain'], layerModTargets());

const rack = (g0: number, g1: number) => readRack([
  { engineId: 'test-env', lo: 0, hi: 127, gain: g0 },
  { engineId: 'test-env', lo: 0, hi: 127, gain: g1 },
]);

/** An envelope that settles on `sustain` almost immediately, aimed at `target`. */
const env = (target: string, sustain: number): ModEnvSpec => ({
  attackSec: 0.001, decaySec: 0.001, sustain, releaseSec: 0.1,
  depthByParam: { [target]: 1 },
} as unknown as ModEnvSpec);

/** Render a voice past its attack and decay, so what comes back is the sustain
 *  the envelope was asked for.
 *
 *  Four calls, not two: Adsr is a state machine that advances ONE stage per
 *  update, so the first opens the gate, the second ends the attack, the third
 *  ends the decay, and only the fourth is on the sustain. */
function settled(r: LayersRenderer): number {
  for (const t of [0, 0.01, 0.02]) r.renderSample(t);
  return r.renderSample(0.5);
}

describe('an envelope reaches the slot it was aimed at', () => {
  it('plays slot 0 through the envelope named for slot 0', () => {
    // The number to beat: without the translation this comes back NO_ENVELOPE,
    // which is the flat gain a converted lane used to play.
    const r = new LayersRenderer(note(), {}, 48000, rack(1, 0), undefined);
    r.setModEnvelopes([env('l0.amp', 0.5)], LANE_INDEX());
    expect(settled(r)).toBeCloseTo(0.5, 2);
  });

  it('leaves the OTHER slot without one', () => {
    // A lane-level envelope would reach both. This is the assertion that says
    // it does not.
    const r = new LayersRenderer(note(), {}, 48000, rack(0, 1), undefined);
    r.setModEnvelopes([env('l0.amp', 0.5)], LANE_INDEX());
    expect(settled(r)).toBeCloseTo(NO_ENVELOPE, 6);
  });

  it('does not let the lane s OWN amp reach a slot', () => {
    // `l0.amp` ends with `.amp`, and a slot that could see the lane's target
    // would be modulated by something outside its box.
    const r = new LayersRenderer(note(), {}, 48000, rack(1, 0), undefined);
    r.setModEnvelopes([env('amp', 0.5)], LANE_INDEX());
    expect(settled(r)).toBeCloseTo(NO_ENVELOPE, 6);
  });
});

describe('two slots, two different envelopes', () => {
  // The property carrying one envelope at the LANE's level could never have,
  // and the reason that shortcut was written and backed out.

  it('sounds different from each other on the same note', () => {
    const mods = [env('l0.amp', 0.75), env('l1.amp', 0.25)];
    const at = (g0: number, g1: number) => {
      const r = new LayersRenderer(note(), {}, 48000, rack(g0, g1), undefined);
      r.setModEnvelopes(mods, LANE_INDEX());
      return settled(r);
    };
    expect(at(1, 0)).toBeCloseTo(0.75, 2);
    expect(at(0, 1)).toBeCloseTo(0.25, 2);
  });

  it('sums to both instruments when both are up', () => {
    const r = new LayersRenderer(note(), {}, 48000, rack(1, 1), undefined);
    r.setModEnvelopes([env('l0.amp', 0.75), env('l1.amp', 0.25)], LANE_INDEX());
    expect(settled(r)).toBeCloseTo(0.75 + 0.25, 2);
  });
});

describe('the knob rings see a layer s envelope', () => {
  it('reports every slot s offsets under the LANE s numbering', () => {
    // Telemetry, read ~30 times a second to draw the rings. Each layer's array
    // is already addressed by the lane's slots, so this is a sum rather than a
    // re-index — and a ring that stayed at zero would say a layer's envelope
    // was inert when it is not.
    const ix = LANE_INDEX();
    const r = new LayersRenderer(note(), {}, 48000, rack(1, 1), undefined);
    r.setModEnvelopes([env('l0.amp', 0.75), env('l1.amp', 0.25)], ix);
    settled(r);
    const a = r.getAdsrOffsets();
    expect(a[ix.slot['l0.amp']]).toBeCloseTo(0.75, 2);
    expect(a[ix.slot['l1.amp']]).toBeCloseTo(0.25, 2);
    expect(a[ix.slot['amp']]).toBe(0);
  });

  it('answers an empty set rather than throwing when nothing modulates', () => {
    const r = new LayersRenderer(note(), {}, 48000, rack(1, 1), undefined);
    expect(r.getAdsrOffsets().every((v) => v === 0)).toBe(true);
  });
});
