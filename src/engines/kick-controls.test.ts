// The kick's new SNAP / SDEC / TONE / DRIVE knobs, as CONTROLS rather than DSP:
// they must exist in the engine's param vocabulary (which is what the voice rack
// paints and what the automation/modulation destination registry enumerates),
// carry the right ranges, and default to the OFF value.
//
// This is the half that a DSP test cannot see: a renderer can read a param the
// engine never declares, and the knob simply is not there.

import { describe, it, expect } from 'vitest';
import { DRUM_PARAMS } from './drums-worklet-engine';
import { DrumsWorkletEngine } from './drums-worklet-engine';
import { KICK_TONE_OPEN } from '../audio-dsp/drums/voices';

const byId = (id: string) => DRUM_PARAMS.find((p) => p.id === id);

const NEW_LEAVES = ['snap', 'snapDecay', 'thud', 'boom', 'body', 'bodyCentre', 'bodyLength', 'tone', 'drive'];

/** Karst's factory kick exposes exactly these ten boundary ports. This is the
 *  list the whole exercise was measured against, so it lives in the test rather
 *  than in a commit message: each one names the leaf that answers it here. */
const KARST_KICK_PORTS: Record<string, string> = {
  Pitch: 'tune',            // plus startFreq/endFreq, which is the same control split in three
  Length: 'decay',
  Trigger: '',              // the hit itself — not a param on either side
  Snap: 'snap',
  Thud: 'thud',
  Boom: 'boom',
  Tone: 'tone',
  Body: 'body',
  'Body Centre': 'bodyCentre',
  'Body Length': 'bodyLength',
};

describe('the kick exposes its new controls', () => {
  it('declares every one of them, as continuous knobs', () => {
    for (const leaf of NEW_LEAVES) {
      const p = byId(`kick.${leaf}`);
      expect(p, `kick.${leaf} is not in DRUM_PARAMS — no knob, no automation`).toBeDefined();
      expect(p!.kind).toBe('continuous');
      expect(p!.label.length).toBeGreaterThan(0);
    }
  });

  it('answers every boundary port of the kick it was measured against', () => {
    for (const [port, leaf] of Object.entries(KARST_KICK_PORTS)) {
      if (!leaf) continue;
      expect(byId(`kick.${leaf}`), `nothing here answers Karst's "${port}"`).toBeDefined();
    }
  });

  it('defaults every amount to OFF, so no kit changed', () => {
    for (const leaf of ['snap', 'thud', 'boom', 'body', 'drive']) {
      expect(byId(`kick.${leaf}`)!.default, `kick.${leaf} is on by default`).toBe(0);
    }
    // TONE "off" is the filter wide open, which the DSP treats as a bypass.
    expect(byId('kick.tone')!.default).toBe(KICK_TONE_OPEN);
  });

  it('ties the TONE knob top to the same constant the DSP bypasses at', () => {
    // If these two drift apart the filter can never be fully bypassed, and every
    // default kick quietly acquires a 4-pole lowpass.
    expect(byId('kick.tone')!.max).toBe(KICK_TONE_OPEN);
  });

  it('gives them usable ranges', () => {
    for (const leaf of ['snap', 'thud', 'boom', 'body', 'drive']) {
      expect(byId(`kick.${leaf}`)!.max, `kick.${leaf} is not a 0..1 amount`).toBe(1);
    }
    for (const leaf of ['snapDecay', 'bodyLength', 'bodyCentre']) {
      const p = byId(`kick.${leaf}`)!;
      expect(p.min, `kick.${leaf} min`).toBeGreaterThan(0);
      expect(p.max, `kick.${leaf} max`).toBeGreaterThan(p.min);
    }
    expect(byId('kick.tone')!.min).toBeLessThan(KICK_TONE_OPEN);
  });

  it('puts the amounts in the front row and the shaping under ▸advanced', () => {
    // The rack paints curatedSynth up front and sweeps every other synth leaf
    // into the collapsed block, so this list is where the two tiers are decided.
    // tone/snap were already there for the snare — the kick joins them for free.
    const { curatedSynth } = new DrumsWorkletEngine().getRackLayout();
    for (const leaf of ['tone', 'snap', 'thud', 'boom', 'body']) {
      expect(curatedSynth, `${leaf} should be in the front row`).toContain(leaf);
    }
    for (const leaf of ['drive', 'snapDecay', 'bodyCentre', 'bodyLength']) {
      expect(curatedSynth, `${leaf} should be under ▸advanced`).not.toContain(leaf);
    }
  });
});
